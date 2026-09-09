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

function sheetXml(rows) {
    const body = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => {
        const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
        return typeof value === "number" && Number.isFinite(value)
            ? `<c r="${ref}"${rowIndex === 0 ? ' s="1"' : ""}><v>${value}</v></c>`
            : `<c r="${ref}" t="inlineStr"${rowIndex === 0 ? ' s="1"' : ""}><is><t>${xml(value)}</t></is></c>`;
    }).join("")}</row>`).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="12" width="18" customWidth="1"/></cols><sheetData>${body}</sheetData><autoFilter ref="A1:L${Math.max(1, rows.length)}"/></worksheet>`;
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
    const active = sales.filter((sale) => !sale.returned).sort((a, b) => Date.parse(a.soldAt) - Date.parse(b.soldAt));
    const groups = new Map();
    for (const sale of active) {
        if (!groups.has(sale.month)) groups.set(sale.month, []);
        groups.get(sale.month).push(sale);
    }
    const used = new Set(["Итоги"]);
    const sheets = [{ name: "Итоги", rows: [
        ["Отчёт Bonus Navigator", "Значение"],
        ["Сотрудник", userName || "Не указан"],
        ["Сформирован", new Date().toLocaleString("ru-RU")],
        ["Количество операций", active.length],
        ["Продано единиц", active.reduce((sum, sale) => sum + sale.quantity, 0)],
        ["Сумма продаж, KZT", active.reduce((sum, sale) => sum + sale.price * sale.quantity, 0)],
        ["Начисление, KZT", active.reduce((sum, sale) => sum + sale.commission, 0)],
    ] }];
    for (const [month, monthSales] of [...groups].sort((a, b) => b[0].localeCompare(a[0]))) {
        sheets.push({ name: safeSheetName(monthTitle(month), used), rows: [
            ["Дата", "Время", "Артикул", "Товар", "Категория", "Цена, KZT", "Количество", "Сумма, KZT", "Процент", "Начисление, KZT", "Месяц ставки"],
            ...monthSales.map((sale) => {
                const date = new Date(sale.soldAt);
                return [date.toLocaleDateString("ru-RU"), date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }), sale.article, sale.title, sale.category, sale.price, sale.quantity, sale.price * sale.quantity, sale.percent, sale.commission, sale.rateMonthLabel];
            }),
        ] });
    }
    const workbookSheets = sheets.map((sheet, index) => `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
    const relationships = sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("");
    const overrides = sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
    const entries = [
        ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${overrides}</Types>`],
        ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
        ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>`],
        ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
        ["xl/styles.xml", `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font/><font><b/><color rgb="FFFFFFFF"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2D7DFF"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>`],
        ...sheets.map((sheet, index) => [`xl/worksheets/sheet${index + 1}.xml`, sheetXml(sheet.rows)]),
    ];
    return zip(entries);
}
