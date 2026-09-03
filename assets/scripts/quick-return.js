import { state } from "./state.js";
import { dom } from "./dom.js";
import { QUICK_RETURN_STATE_KEY, QUICK_RETURN_TTL } from "./config.js";
import { normalizeArticleSearchInput } from "./utils.js";

/**
 * Сохранение и восстановление состояния списка при быстром возврате (переход на страницу товара и обратно).
 */

/** Сохраняет текущее состояние каталога и прокрутки перед уходом со страницы. */
export function saveQuickReturnState() {
    const uiState = {
        activeCategory: state.activeCategory,
        activeStars: state.activeStars,
        searchQuery: state.searchQuery,
        activeMonthColumn: state.activeMonthColumn,
        scrollY: window.scrollY || 0,
    };

    const payload = {
        timestamp: Date.now(),
        uiState,
        items: state.items,
        categories: state.categories,
    };

    try {
        sessionStorage.setItem(QUICK_RETURN_STATE_KEY, JSON.stringify(payload));
    } catch (error) {
        console.warn("Не удалось сохранить состояние быстрого возврата:", error);
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

    const uiState = payload.uiState && typeof payload.uiState === "object"
        ? payload.uiState
        : {};

    state.activeCategory = uiState.activeCategory || state.activeCategory;
    state.activeStars = Number(uiState.activeStars || 0);
    state.searchQuery = normalizeArticleSearchInput(uiState.searchQuery || "");
    state.pendingQuickReturnMonthColumn = Number.isFinite(Number(uiState.activeMonthColumn))
        ? Number(uiState.activeMonthColumn)
        : null;
    dom.search.value = state.searchQuery;

    if (Number.isFinite(uiState.scrollY) && uiState.scrollY > 0) {
        requestAnimationFrame(() => {
            window.scrollTo({ top: uiState.scrollY, behavior: "auto" });
        });
    }

    return true;
}
