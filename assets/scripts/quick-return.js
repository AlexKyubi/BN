import { state } from "./state.js";
import { dom } from "./dom.js";
import { CATALOG_UI_STATE_STORAGE_KEY, CATEGORY_ALL, QUICK_RETURN_STATE_KEY, QUICK_RETURN_TTL } from "./config.js";
import { normalizeCatalogSearchInput } from "./utils.js";

/**
 * Сохранение и восстановление состояния списка при быстром возврате из кабинета или со страницы товара.
 */

function createUiState(includeScroll = false) {
    const result = {
        activeCategory: state.activeCategory,
        activeStars: state.activeStars,
        searchQuery: state.searchQuery,
        activeMonthColumn: state.activeMonthColumn,
        priceSort: state.priceSort,
    };
    if (includeScroll) result.scrollY = window.scrollY || 0;
    return result;
}

/** Сохраняет фильтры и выбранный месяц между перезапусками браузера. */
export function saveCatalogUiState() {
    try {
        localStorage.setItem(CATALOG_UI_STATE_STORAGE_KEY, JSON.stringify(createUiState(false)));
    } catch (error) {
        console.warn("Не удалось сохранить настройки каталога:", error);
    }
}

/** Восстанавливает постоянные фильтры до загрузки товаров. */
export function hydrateCatalogUiState() {
    try {
        const payload = JSON.parse(localStorage.getItem(CATALOG_UI_STATE_STORAGE_KEY) || "null");
        if (!payload || typeof payload !== "object") return false;
        state.activeCategory = String(payload.activeCategory || CATEGORY_ALL).slice(0, 150);
        state.activeStars = Math.min(5, Math.max(0, Math.trunc(Number(payload.activeStars) || 0)));
        state.searchQuery = normalizeCatalogSearchInput(payload.searchQuery || "");
        state.priceSort = ["asc", "desc"].includes(payload.priceSort) ? payload.priceSort : "none";
        state.pendingQuickReturnMonthColumn = Number.isInteger(Number(payload.activeMonthColumn))
            ? Number(payload.activeMonthColumn)
            : null;
        if (dom.search) dom.search.value = state.searchQuery;
        return true;
    } catch (error) {
        console.warn("Не удалось восстановить настройки каталога:", error);
        return false;
    }
}

/** Сохраняет текущее состояние каталога и прокрутки перед уходом со страницы. */
export function saveQuickReturnState() {
    const uiState = createUiState(true);

    const payload = {
        timestamp: Date.now(),
        uiState,
        items: state.items,
        categories: state.categories,
        monthColumns: state.monthColumns,
        sourceRows: state.sourceRows,
        sourceBaseIndices: state.sourceBaseIndices,
        sourceWarnings: state.sourceWarnings,
        stockCache: state.stockCache,
        stockSyncTokens: state.stockSyncTokens,
    };

    saveCatalogUiState();
    try {
        sessionStorage.setItem(QUICK_RETURN_STATE_KEY, JSON.stringify(payload));
    } catch (error) {
        console.warn("Не удалось сохранить состояние быстрого возврата:", error);
    }
}

/** Проверяет наличие свежего полноценного снимка, не меняя состояние приложения. */
export function hasUsableQuickReturnState() {
    try {
        const raw = sessionStorage.getItem(QUICK_RETURN_STATE_KEY);
        if (!raw) return false;
        const payload = JSON.parse(raw);
        return Boolean(
            payload
            && typeof payload === "object"
            && Number.isFinite(Number(payload.timestamp))
            && Date.now() - Number(payload.timestamp) <= QUICK_RETURN_TTL
            && Array.isArray(payload.items)
            && payload.items.length
            && Array.isArray(payload.sourceRows)
            && payload.sourceRows.length
        );
    } catch (error) {
        console.warn("Не удалось проверить состояние быстрого возврата:", error);
        return false;
    }
}

/**
 * Восстанавливает состояние каталога из sessionStorage, если оно не устарело.
 * Возвращает true, если состояние было восстановлено (тогда вызывающий код должен перерисовать UI).
 */
export function hydrateQuickReturnState() {
    let payload;
    try {
        const raw = sessionStorage.getItem(QUICK_RETURN_STATE_KEY);
        if (!raw) {
            return false;
        }
        payload = JSON.parse(raw);
    } catch (error) {
        console.warn("Не удалось прочитать состояние быстрого возврата:", error);
        return false;
    }

    if (!payload || typeof payload !== "object") {
        return false;
    }

    if (!payload.timestamp || Date.now() - payload.timestamp > QUICK_RETURN_TTL) {
        return false;
    }

    if (Array.isArray(payload.items) && payload.items.length) {
        state.items = payload.items;
    }

    if (Array.isArray(payload.categories) && payload.categories.length) {
        state.categories = payload.categories;
    }

    if (Array.isArray(payload.monthColumns)) state.monthColumns = payload.monthColumns;
    if (Array.isArray(payload.sourceRows)) state.sourceRows = payload.sourceRows;
    if (payload.sourceBaseIndices && typeof payload.sourceBaseIndices === "object") state.sourceBaseIndices = payload.sourceBaseIndices;
    if (Array.isArray(payload.sourceWarnings)) state.sourceWarnings = payload.sourceWarnings;
    if (payload.stockCache?.regions && typeof payload.stockCache.regions === "object") state.stockCache = payload.stockCache;
    if (payload.stockSyncTokens && typeof payload.stockSyncTokens === "object") state.stockSyncTokens = payload.stockSyncTokens;

    const uiState = payload.uiState && typeof payload.uiState === "object"
        ? payload.uiState
        : {};

    state.activeCategory = uiState.activeCategory || state.activeCategory;
    state.activeStars = Number(uiState.activeStars || 0);
    state.searchQuery = normalizeCatalogSearchInput(uiState.searchQuery || "");
    state.priceSort = ["asc", "desc"].includes(uiState.priceSort) ? uiState.priceSort : "none";
    state.pendingQuickReturnMonthColumn = Number.isFinite(Number(uiState.activeMonthColumn))
        ? Number(uiState.activeMonthColumn)
        : null;
    if (state.pendingQuickReturnMonthColumn !== null) {
        state.activeMonthColumn = state.pendingQuickReturnMonthColumn;
    }
    dom.search.value = state.searchQuery;

    if (Number.isFinite(uiState.scrollY) && uiState.scrollY > 0) {
        requestAnimationFrame(() => {
            window.scrollTo({ top: uiState.scrollY, behavior: "auto" });
        });
    }

    return true;
}
