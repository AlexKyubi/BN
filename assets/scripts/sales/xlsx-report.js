const encoder = new TextEncoder();

function xml(value) {
    return String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[char]));
}

function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function u16(value) { return [value & 255, (value >>> 8) & 255]; }
function u32(value) { return [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]; }

function zip(entries) {
    const chunks = [];
    const directory = [];
    let offset = 0;
    for (const [name, content] of entries) {
        const nameBytes = encoder.encode(name);
        const data = encoder.encode(content);
        const crc = crc32(data);
        const local = new Uint8Array([0x50,0x4b,0x03,0x04,...u16(20),...u16(0),...u16(0),...u16(0),...u16(0),...u32(crc),...u32(data.length),...u32(data.length),...u16(nameBytes.length),...u16(0),...nameBytes,...data]);
        chunks.push(local);
        directory.push(new Uint8Array([0x50,0x4b,0x01,0x02,...u16(20),...u16(20),...u16(0),...u16(0),...u16(0),...u16(0),...u32(crc),...u32(data.length),...u32(data.length),...u16(nameBytes.length),...u16(0),...u16(0),...u16(0),...u16(0),...u32(0),...u32(offset),...nameBytes]));
        offset += local.length;
    }
    const directorySize = directory.reduce((sum, item) => sum + item.length, 0);
    const end = new Uint8Array([0x50,0x4b,0x05,0x06,...u16(0),...u16(0),...u16(entries.length),...u16(entries.length),...u32(directorySize),...u32(offset),...u16(0)]);
    return new Blob([...chunks, ...directory, end], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function columnName(index) {
    let value = index + 1;
    let name = "";
    while (value) { value -= 1; name = String.fromCharCode(65 + (value % 26)) + name; value = Math.floor(value / 26); }
    return name;
}

function excelDateSerial(value) {
    return Math.floor(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / 86400000) + 25569;
}

function sheetXml(rows, { summary = false } = {}) {
    const totalRowIndex = rows.length - 1;
    const body = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => {
        const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
        let style = 0;
        if (rowIndex === 0) style = 1;
        else if (!summary && rowIndex === totalRowIndex) style = [7, 8].includes(columnIndex) ? 6 : 5;
        else if (value instanceof Date) style = 2;
        else if (!summary && columnIndex === 6) style = 3;
        else if ((!summary && [5, 7, 8].includes(columnIndex)) || (summary && columnIndex === 1 && [6, 7].includes(rowIndex))) style = 4;
        const styleAttribute = style ? ` s="${style}"` : "";
        if (value instanceof Date && !Number.isNaN(value.getTime())) {
            return `<c r="${ref}"${styleAttribute}><v>${excelDateSerial(value)}</v></c>`;
        }
        return typeof value === "number" && Number.isFinite(value)
            ? `<c r="${ref}"${styleAttribute}><v>${value}</v></c>`
            : `<c r="${ref}" t="inlineStr"${styleAttribute}><is><t>${xml(value)}</t></is></c>`;
    }).join("")}</row>`).join("");
    const widths = summary ? [32, 34] : [13, 24, 18, 30, 12, 18, 15, 24, 22];
    const columns = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("");
    const detailLastRow = Math.max(1, rows.length - 1);
    const view = summary ? '<sheetView workbookViewId="0"/>' : '<sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView>';
    const filter = summary ? "" : `<autoFilter ref="A1:I${detailLastRow}"/>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews>${view}</sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${columns}</cols><sheetData>${body}</sheetData>${filter}</worksheet>`;
}

function safeSheetName(value, used) {
    const base = String(value).replace(/[\\/*?:[\]]/g, " ").trim().slice(0, 31) || "Продажи";
    let name = base;
    let index = 2;
    while (used.has(name)) { name = `${base.slice(0, 27)} ${index}`; index += 1; }
    used.add(name);
    return name;
}

function monthTitle(key) {
    const [year, month] = key.split("-").map(Number);
    return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
}

export function createSalesWorkbook(sales, userName = "") {
    const currentYear = new Date().getFullYear();
    const active = sales.filter((sale) => {
        const soldAt = new Date(sale.soldAt);
        return !sale.returned && !Number.isNaN(soldAt.getTime()) && soldAt.getFullYear() === currentYear;
    }).sort((a, b) => Date.parse(a.soldAt) - Date.parse(b.soldAt));
    const groups = new Map();
    for (const sale of active) {
        if (!groups.has(sale.month)) groups.set(sale.month, []);
        groups.get(sale.month).push(sale);
    }
    const headers = ["Дата продажи", "Категория", "Артикул", "Модель", "Количество", "Цена продажи, KZT", "Процент отчисления", "Сумма, KZT", "Сумма отчислений, KZT"];
    const used = new Set(["Итоги"]);
    const sheets = [{ name: "Итоги", summary: true, rows: [
        ["Отчёт Bonus Navigator", "Значение"],
        ["Сотрудник", userName || "Не указан"],
        ["Период хранения", `С 1 января ${currentYear} года`],
        ["Сформирован", new Date().toLocaleString("ru-RU")],
        ["Количество операций", active.length],
        ["Продано единиц", active.reduce((sum, sale) => sum + sale.quantity, 0)],
        ["Сумма продаж, KZT", active.reduce((sum, sale) => sum + sale.price * sale.quantity, 0)],
        ["Сумма отчислений, KZT", active.reduce((sum, sale) => sum + sale.commission, 0)],
        ["Детализация", "Отдельные листы по месяцам"],
    ] }];
    for (const [month, monthSales] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
        const quantityTotal = monthSales.reduce((sum, sale) => sum + sale.quantity, 0);
        const salesTotal = monthSales.reduce((sum, sale) => sum + sale.price * sale.quantity, 0);
        const commissionTotal = monthSales.reduce((sum, sale) => sum + sale.commission, 0);
        sheets.push({ name: safeSheetName(monthTitle(month), used), rows: [
            headers,
            ...monthSales.map((sale) => [new Date(sale.soldAt), sale.category, sale.article, sale.title, sale.quantity, sale.price, sale.percent / 100, sale.price * sale.quantity, sale.commission]),
            ["Итого за месяц", "", "", "", quantityTotal, "", "", salesTotal, commissionTotal],
        ] });
    }
    if (sheets.length === 1) sheets.push({ name: safeSheetName(monthTitle(`${currentYear}-${String(new Date().getMonth() + 1).padStart(2, "0")}`), used), rows: [headers, ["Итого за месяц", "", "", "", 0, "", "", 0, 0]] });
    const workbookSheets = sheets.map((sheet, index) => `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
    const relationships = sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("");
    const overrides = sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
    const entries = [
        ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${overrides}</Types>`],
        ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
        ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>`],
        ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
        ["xl/styles.xml", `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="dd.mm.yyyy"/><numFmt numFmtId="165" formatCode="#,##0.00"/><numFmt numFmtId="166" formatCode="0.00%"/></numFmts><fonts count="3"><font/><font><b/><color rgb="FFFFFFFF"/></font><font><b/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2D7DFF"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCE9FF"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="2" fillId="3" borderId="0" applyFont="1" applyFill="1"/><xf numFmtId="165" fontId="2" fillId="3" borderId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/></cellXfs></styleSheet>`],
        ...sheets.map((sheet, index) => [`xl/worksheets/sheet${index + 1}.xml`, sheetXml(sheet.rows, { summary: Boolean(sheet.summary) })]),
    ];
    return zip(entries);
}
