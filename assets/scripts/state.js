import { CATEGORY_ALL } from "./config.js";

/**
 * Общее изменяемое состояние приложения (единый объект, на который ссылаются все модули).
 */
export const state = {
    items: [],
    categories: [],
    activeCategory: CATEGORY_ALL,
    activeStars: 0,
    searchQuery: "",
    loadError: null,
    loadWarning: null,
    appStarted: false,
    monthColumns: [],
    activeMonthColumn: -1,
    pendingQuickReturnMonthColumn: null,
    catalogProducts: [],
    catalogVersion: "",
    regionsModel: null,
    stockCache: { regions: {} },
    stockSyncTokens: {},
    hideNoStock: false,
    // Сортировка по цене: "none" | "desc" | "asc".
    priceSort: "none",
};
