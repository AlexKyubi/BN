import { dom } from "../dom.js";
import { state } from "../state.js";
import {
    ARTICLE_COLUMN_INDEX,
    CSV_CACHE_KEY,
    CSV_CACHE_TTL,
    DEFAULT_MONTH_COLUMN_INDEX,
    LOCAL_CSV_PATH,
} from "../config.js";
import { detectMonthColumns, extractArticleFromText, findColumnIndex, parseCsv } from "../utils.js";
import { getEffectiveSheetUrl } from "../auth/device-auth.js";
import { buildItem } from "./catalog-items.js";
import { syncMonthSelector } from "../ui/drawers.js";
import { createCategoryList, renderCards, updateStarsButtons } from "../ui/grid.js";

/**
 * Загрузка каталога из CSV (Google Sheets/кеш/локальный fallback) и пересборка товаров из строк.
 */

/** Публичные CORS-прокси, используемые как запасной вариант загрузки CSV. */
function getProxyUrls(url) {
    return [
        `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
        `https://corsproxy.io/?${encodeURIComponent(url)}`,
        `https://thingproxy.freeboard.io/fetch/${encodeURIComponent(url)}`,
    ];
}

/** Загружает CSV по прямой ссылке, а при неудаче — через список CORS-прокси. */
async function fetchCsvText(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Не удалось загрузить CSV напрямую: ${response.status}`);
        }
        return await response.text();
    } catch (error) {
        console.warn("Прямая загрузка CSV не прошла, пробую CORS-прокси:", error);
    }

    const proxyUrls = getProxyUrls(url);
    let lastError = null;

    for (const proxyUrl of proxyUrls) {
        try {
            const proxyResponse = await fetch(proxyUrl);
            if (!proxyResponse.ok) {
                throw new Error(`Не удалось загрузить CSV через прокси ${proxyUrl}: ${proxyResponse.status}`);
            }
            return await proxyResponse.text();
        } catch (proxyError) {
            console.warn(proxyError);
            lastError = proxyError;
        }
    }

    throw lastError || new Error("Не удалось загрузить CSV через доступные прокси.");
}

/** Загружает локальный резервный CSV (public/products.csv). */
async function fetchLocalCsv() {
    try {
        const response = await fetch(LOCAL_CSV_PATH);
        if (!response.ok) {
            throw new Error(`Не удалось загрузить локальный CSV: ${response.status}`);
        }
        return await response.text();
    } catch (error) {
        console.warn("Не удалось загрузить локальный CSV:", error);
        return null;
    }
}

/** Сохраняет текст CSV в localStorage с отметкой времени. */
function saveCsvCache(text) {
    const cacheEntry = {
        content: text,
        timestamp: Date.now(),
    };

    try {
        localStorage.setItem(CSV_CACHE_KEY, JSON.stringify(cacheEntry));
    } catch (error) {
        console.warn("Не удалось сохранить кеш CSV:", error);
    }
}

/** Читает закешированный CSV, если он ещё не истёк (CSV_CACHE_TTL). */
function loadCsvCache() {
    try {
        const raw = localStorage.getItem(CSV_CACHE_KEY);
        if (!raw) {
            return null;
        }

        const entry = JSON.parse(raw);
        if (!entry || typeof entry !== "object") {
            return null;
        }

        if (Date.now() - entry.timestamp > CSV_CACHE_TTL) {
            return null;
        }

        return typeof entry.content === "string" ? entry.content : null;
    } catch (error) {
        console.warn("Не удалось загрузить кеш CSV:", error);
        return null;
    }
}

/** Пересобирает items из уже загруженных строк CSV с учётом активной колонки месяца/рейтинга. */
export function rebuildItemsFromSourceRows({ render = true } = {}) {
    if (!state.sourceRows.length || !state.sourceBaseIndices) {
        return;
    }

    const warnings = [...state.sourceWarnings];
    const ratingIndex = state.activeMonthColumn;

    if (ratingIndex === -1) {
        warnings.push("Колонки месяцев (с E) не найдены. Все товары будут без звёзд.");
    }

    state.items = state.sourceRows.slice(1)
        .map((row) => buildItem(row, { ...state.sourceBaseIndices, rating: ratingIndex }))
        .filter(Boolean);

    if (!state.items.length) {
        const message = warnings.length
            ? `CSV загружен, но не найдено данных товаров. ${warnings.join(" ")}`
            : "CSV загружен, но товары не найдены. Проверьте данные в файле.";
        state.loadError = message;
        dom.grid.textContent = message;
        dom.resultCount.textContent = "Ошибка загрузки товаров";
        dom.activeFilters.textContent = message;
        return;
    }

    state.loadError = null;
    state.loadWarning = warnings.length ? warnings.join(" ") : null;

    const categoryNames = [...new Set(state.items.map((item) => item.category))]
        .sort((a, b) => a.localeCompare(b, "ru"));
    if (state.activeCategory !== "all" && !categoryNames.includes(state.activeCategory)) {
        state.activeCategory = "all";
    }
    createCategoryList(categoryNames);
    updateStarsButtons();
    if (render) renderCards();
}

/** Разбирает уже полученный CSV и применяет его к состоянию каталога. */
function applyCatalogText(raw, { render = true } = {}) {
    if (!raw) {
        const message = "Не удалось загрузить CSV. Проверьте ссылку Google Sheets, подключение к интернету или добавьте fallback-файл public/products.csv.";
        state.loadError = message;
        dom.grid.textContent = message;
        dom.resultCount.textContent = "Ошибка загрузки товаров";
        dom.activeFilters.textContent = message;
        state.items = [];
        return false;
    }

    const rows = parseCsv(raw).filter((row) => row.length > 0);
    if (!rows.length) {
        const message = "CSV пустой или не удалось разобрать данные.";
        state.loadError = message;
        dom.grid.textContent = message;
        dom.resultCount.textContent = "Ошибка загрузки товаров";
        dom.activeFilters.textContent = message;
        state.items = [];
        return false;
    }

    const headers = rows[0] || [];
    const baseIndices = {
        title: findColumnIndex(headers, ["sulpak article+name", "sulpak article + name", "sulpak article name", "sulpak article", "name", "product name"]),
        article: ARTICLE_COLUMN_INDEX,
        category: findColumnIndex(headers, ["category", "категория", "brand"]),
    };

    const warnings = [];
    if (!rows.slice(1).some((row) => extractArticleFromText(row?.[ARTICLE_COLUMN_INDEX]))) {
        const message = "В колонке C не найдены артикулы. Проверьте данные CSV.";
        state.loadError = message;
        dom.grid.textContent = message;
        dom.resultCount.textContent = "Ошибка загрузки товаров";
        dom.activeFilters.textContent = message;
        state.items = [];
        return false;
    }

    if (baseIndices.title === -1) {
        warnings.push("Колонка 'Sulpak Article+name' не найдена. Названия будут заменены на артикулы.");
    }

    if (baseIndices.category === -1) {
        warnings.push("Колонка категории не найдена. Все товары будут сгруппированы как 'Без категории'.");
    }

    state.sourceRows = rows;
    state.sourceBaseIndices = baseIndices;
    state.sourceWarnings = warnings;

    state.monthColumns = detectMonthColumns(headers, DEFAULT_MONTH_COLUMN_INDEX);
    const defaultMonthColumn = state.monthColumns.some((month) => month.index === DEFAULT_MONTH_COLUMN_INDEX)
        ? DEFAULT_MONTH_COLUMN_INDEX
        : (state.monthColumns[0]?.index ?? -1);

    const hasPendingMonth = state.pendingQuickReturnMonthColumn !== null
        && state.monthColumns.some((month) => month.index === state.pendingQuickReturnMonthColumn);

    state.activeMonthColumn = hasPendingMonth
        ? state.pendingQuickReturnMonthColumn
        : defaultMonthColumn;

    state.pendingQuickReturnMonthColumn = null;
    syncMonthSelector();

    rebuildItemsFromSourceRows({ render });
    return Boolean(state.items.length);
}

/**
 * Загружает CSV каталога. Валидный локальный кеш применяется сразу, пока сеть
 * проверяет свежую версию; поэтому первая карточка не ждёт Google Sheets.
 */
export async function loadProducts({ render = true } = {}) {
    state.loadError = null;
    state.loadWarning = null;
    const cached = loadCsvCache();
    let cacheApplied = false;

    if (cached) {
        cacheApplied = applyCatalogText(cached, { render });
    } else {
        dom.resultCount.textContent = "Загрузка товаров...";
        dom.activeFilters.textContent = "";
    }

    let raw = null;
    const sheetUrl = getEffectiveSheetUrl();

    if (sheetUrl) {
        try {
            raw = await fetchCsvText(sheetUrl);
            saveCsvCache(raw);
        } catch (fetchError) {
            console.warn("Ошибка при загрузке удалённого CSV:", fetchError);
            if (cacheApplied) return true;
        }
    } else {
        console.warn("Ссылка Google Sheets не задана, использую кеш/локальный fallback.");
    }

    if (!raw && !cacheApplied) {
        raw = await fetchLocalCsv();
        if (raw) saveCsvCache(raw);
    }

    if (!raw) {
        return cacheApplied || applyCatalogText(null, { render });
    }

    // При совпадении сеть лишь подтверждает кеш: строки не разбираем повторно.
    if (cacheApplied && raw === cached) {
        // Финальная отрисовка подхватывает остатки, которые могли прийти параллельно.
        if (render) renderCards();
        return true;
    }

    return applyCatalogText(raw, { render });
}
