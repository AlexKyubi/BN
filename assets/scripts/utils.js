/**
 * Мелкие переиспользуемые хелперы: строки, регэкспы, CSV-парсинг, разбор чисел/процентов.
 */

/** Нормализует имя заголовка для нестрогого сравнения (без пробелов/спецсимволов). */
export function normalizeHeaderName(value) {
    return (value || "")
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9а-яё]+/gi, "");
}

/** Экранирует спецсимволы regex, чтобы использовать произвольную строку как литерал в паттерне. */
export function escapeRegExp(string) {
    return String(string).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Экранирует HTML-спецсимволы перед вставкой значения в innerHTML. */
export function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

/** Схлопывает повторяющиеся пробелы и обрезает края (для ФИО). */
export function normalizeFullName(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

/** Оставляет только цифры (для поиска/сравнения по артикулу). */
export function normalizeArticleSearchInput(value) {
    return String(value || "").replace(/\D+/g, "");
}

/** Оставляет латинские буквы, цифры и дефис для поиска по артикулу или модели. */
export function normalizeCatalogSearchInput(value) {
    return String(value || "").toLocaleUpperCase("en-US").replace(/[^A-Z0-9-]+/g, "");
}

/** Извлекает артикул (5+ цифр подряд) из произвольного текста. */
export function extractArticleFromText(value) {
    const raw = String(value || "").trim();
    if (!raw) {
        return "";
    }

    const normalizedOnlyDigits = normalizeArticleSearchInput(raw);
    if (normalizedOnlyDigits.length >= 5) {
        return normalizedOnlyDigits;
    }

    const match = raw.match(/\b(\d{5,})\b/);
    return match ? String(match[1]).trim() : "";
}

/** Приводит произвольную ссылку на Google Sheets к каноническому виду экспорта в CSV. */
export function normalizeGoogleSheetCsvUrl(value) {
    const input = String(value || "").trim();
    if (!input) {
        return "";
    }

    let url;
    try {
        url = new URL(input);
    } catch (error) {
        return "";
    }

    if (url.protocol !== "https:" || url.hostname !== "docs.google.com") {
        return "";
    }

    const match = url.pathname.match(/^\/spreadsheets\/d\/([^/]+)\//i);
    if (!match || !match[1]) {
        return "";
    }

    const sheetId = match[1];
    const hashGidMatch = (url.hash || "").match(/gid=(\d+)/i);
    const gid = (url.searchParams.get("gid") || (hashGidMatch ? hashGidMatch[1] : "")).trim();
    const gidPart = /^\d+$/.test(gid) ? `&gid=${gid}` : "";

    return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv${gidPart}`;
}

/** Ищет индекс колонки по списку возможных названий (точное совпадение, затем нестрогое). */
export function findColumnIndex(headers, possibleNames) {
    const normalizedHeaders = headers.map(normalizeHeaderName);

    for (const name of possibleNames) {
        const normalizedName = normalizeHeaderName(name);
        const exactIndex = normalizedHeaders.indexOf(normalizedName);
        if (exactIndex !== -1) {
            return exactIndex;
        }

        if (normalizedName.length === 1) {
            continue; // односимвольные заголовки не должны матчиться по подстроке
        }

        const fuzzyIndex = normalizedHeaders.findIndex((header) =>
            header.includes(normalizedName) || normalizedName.includes(header)
        );

        if (fuzzyIndex !== -1) {
            return fuzzyIndex;
        }
    }

    return -1;
}

/** Собирает список "колонок месяцев" начиная с defaultMonthColumnIndex до конца заголовков. */
export function detectMonthColumns(headers, defaultMonthColumnIndex = 4) {
    const months = [];

    for (let col = defaultMonthColumnIndex; col < headers.length; col += 1) {
        const label = headers[col] == null ? "" : String(headers[col]);
        if (!label.length) {
            continue;
        }

        months.push({ index: col, label });
    }

    return months;
}

/** Сокращает заголовок месяца до короткого текста для бейджа (первые 3 символа первого слова). */
export function formatMonthBadgeText(label) {
    const raw = String(label || "").trim();
    if (!raw) {
        return "";
    }

    const normalized = raw
        .replace(/^bonus\s+/i, "")
        .replace(/^update\s+/i, "")
        .replace(/\s+/g, " ")
        .trim();

    if (!normalized) {
        return "";
    }

    const token = normalized.split(" ")[0] || normalized;
    return token.slice(0, 3);
}

/** Простой построчный CSV-парсер с поддержкой кавычек и экранирования. */
export function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let insideQuote = false;

    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        if (insideQuote) {
            if (char === '"') {
                if (text[i + 1] === '"') {
                    cell += '"';
                    i += 1;
                } else {
                    insideQuote = false;
                }
            } else {
                cell += char;
            }
            continue;
        }

        if (char === '"') {
            insideQuote = true;
            continue;
        }

        if (char === ",") {
            row.push(cell);
            cell = "";
            continue;
        }

        if (char === "\r") {
            continue;
        }

        if (char === "\n") {
            row.push(cell);
            rows.push(row);
            row = [];
            cell = "";
            continue;
        }

        cell += char;
    }

    if (cell.length || row.length) {
        row.push(cell);
        rows.push(row);
    }

    return rows;
}

/** Разбирает значение рейтинга (звёзды 1-5 или проценты 0-100) в число звёзд. */
export function parseRating(value) {
    const normalized = (value || "").toString().trim().replace(",", ".").replace("%", "");
    const parsed = Number(normalized);

    if (Number.isNaN(parsed)) {
        return 0;
    }

    if (parsed > 5) {
        return Math.min(5, Math.max(1, Math.round(parsed / 20)));
    }

    return Math.min(5, Math.max(1, Math.round(parsed)));
}

/** Разбирает значение процента (0-100 напрямую или дробь 0-1, умноженная на 100). */
export function parsePercent(value) {
    if (value == null) {
        return null;
    }

    const raw = String(value).trim();
    if (!raw) {
        return null;
    }

    const hasPercentSign = raw.includes("%");
    const normalized = raw.replace("%", "").replace(",", ".").trim();
    const n = Number(normalized);
    if (Number.isNaN(n)) {
        return null;
    }

    if (hasPercentSign && n >= 0 && n <= 100) {
        return Math.round(n);
    }

    if (n > 0 && n <= 1) {
        return Math.round(n * 100);
    }

    if (n >= 0 && n <= 100) {
        return Math.round(n);
    }

    return null;
}

/** Разбирает тело fetch-ответа как JSON, а при неудаче возвращает { raw: текст }. */
export async function parseResponseBody(response) {
    const text = await response.text();
    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch {
        return { raw: text };
    }
}
