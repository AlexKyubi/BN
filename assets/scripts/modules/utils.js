export function normalizeHeader(value) {
    return (value || "").trim().toLowerCase();
}

export function normalizeHeaderName(value) {
    return (value || "")
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9а-яё]+/gi, "");
}

export function escapeRegExp(string) {
    return String(string).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

export function normalizeFullName(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

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

export function isValidGoogleSheetCsvUrl(value) {
    return Boolean(normalizeGoogleSheetCsvUrl(value));
}

export function normalizeArticleSearchInput(value) {
    return String(value || "").replace(/\D+/g, "");
}

export function findColumnIndex(headers, possibleNames) {
    const normalizedHeaders = headers.map(normalizeHeaderName);

    for (const name of possibleNames) {
        const normalizedName = normalizeHeaderName(name);
        const exactIndex = normalizedHeaders.indexOf(normalizedName);
        if (exactIndex !== -1) {
            return exactIndex;
        }

        if (normalizedName.length === 1) {
            continue;
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

        if (char === ',') {
            row.push(cell);
            cell = "";
            continue;
        }

        if (char === '\r') {
            continue;
        }

        if (char === '\n') {
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

export function parseRating(value) {
    const normalized = (value || "").toString().trim().replace(",", "").replace("%", "");
    const parsed = Number(normalized);

    if (Number.isNaN(parsed)) {
        return 0;
    }

    if (parsed > 5) {
        return Math.min(5, Math.max(1, Math.round(parsed / 20)));
    }

    return Math.min(5, Math.max(1, Math.round(parsed)));
}

export function parsePercent(value) {
    if (value == null) return null;
    const raw = String(value).trim();
    if (!raw) return null;

    const hasPercent = raw.includes('%');
    const normalized = raw.replace('%', '').replace(',', '.').trim();
    const n = Number(normalized);
    if (Number.isNaN(n)) return null;

    if (n >= 0 && n <= 100) {
        return Math.round(n);
    }

    if (n > 0 && n <= 1) {
        return Math.round(n * 100);
    }

    return null;
}

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
