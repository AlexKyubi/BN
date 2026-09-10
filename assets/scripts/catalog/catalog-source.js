import { dom } from "../dom.js";
import { state } from "../state.js";
import { DEFAULT_MONTH_COLUMN_INDEX } from "../config.js";
import { detectMonthColumns } from "../utils.js";
import { fetchCatalog } from "../stock/stock-api.js";
import { buildItem } from "./catalog-items.js";
import { syncMonthSelector } from "../ui/drawers.js";
import { createCategoryList, renderCards, updateStarsButtons } from "../ui/grid.js";

/** Проверяет серверный каталог и не пропускает повреждённые/дублирующиеся карточки в UI. */
function normalizeCatalogProducts(products) {
    const seen = new Set();
    const normalized = [];
    let discarded = 0;
    for (const product of products) {
        const article = String(product?.article || "").trim();
        const title = String(product?.title || "").trim();
        if (!/^\d+$/.test(article) || !title || seen.has(article)) {
            discarded += 1;
            continue;
        }
        seen.add(article);
        normalized.push({
            article,
            title,
            category: String(product?.category || "Без категории").trim() || "Без категории",
            commissionRow: Array.isArray(product?.commissionRow) ? product.commissionRow : [],
        });
    }
    return { products: normalized, discarded };
}

/** Удаляет из сессионного кеша остатки товаров, которых больше нет в каталоге. */
function pruneStockCacheToCatalog() {
    const allowedArticles = new Set(state.catalogProducts.map((product) => String(product?.article || "").trim()));
    Object.values(state.stockCache?.regions || {}).forEach((entry) => {
        if (!entry?.items || typeof entry.items !== "object") return;
        Object.keys(entry.items).forEach((article) => {
            if (!allowedArticles.has(article)) delete entry.items[article];
        });
    });
}

/** Пересобирает карточки из канонического каталога при смене месяца. */
export function rebuildItemsFromCatalog({ render = true } = {}) {
    if (!state.catalogProducts.length) return;
    state.items = state.catalogProducts.map((product) => buildItem(product, state.activeMonthColumn));
    state.loadError = null;
    const categoryNames = [...new Set(state.items.map((item) => item.category))]
        .sort((a, b) => a.localeCompare(b, "ru"));
    if (state.activeCategory !== "all" && !categoryNames.includes(state.activeCategory)) state.activeCategory = "all";
    createCategoryList(categoryNames);
    updateStarsButtons();
    if (render) renderCards();
}

/** Загружает с защищённого backend полный справочник и уже сопоставленные проценты. */
export async function loadProducts({ render = true } = {}) {
    state.loadError = null;
    state.loadWarning = null;
    dom.resultCount.textContent = "Загрузка товаров...";
    try {
        const payload = await fetchCatalog();
        const normalized = normalizeCatalogProducts(payload.products);
        if (!normalized.products.length) throw new Error("Справочник товаров пуст или повреждён.");
        state.catalogProducts = normalized.products;
        state.catalogVersion = payload.version;
        pruneStockCacheToCatalog();
        if (normalized.discarded) {
            state.loadWarning = `Пропущено повреждённых записей каталога: ${normalized.discarded}.`;
        }
        state.monthColumns = detectMonthColumns(payload.headers, DEFAULT_MONTH_COLUMN_INDEX);
        const fallbackMonth = state.monthColumns.some((month) => month.index === DEFAULT_MONTH_COLUMN_INDEX)
            ? DEFAULT_MONTH_COLUMN_INDEX : (state.monthColumns[0]?.index ?? -1);
        const pendingValid = state.pendingQuickReturnMonthColumn !== null
            && state.monthColumns.some((month) => month.index === state.pendingQuickReturnMonthColumn);
        state.activeMonthColumn = pendingValid ? state.pendingQuickReturnMonthColumn : fallbackMonth;
        state.pendingQuickReturnMonthColumn = null;
        syncMonthSelector();
        rebuildItemsFromCatalog({ render });
        return true;
    } catch (error) {
        const message = error instanceof Error ? error.message : "Не удалось загрузить справочник товаров.";
        if (state.catalogProducts.length) {
            state.loadWarning = `Показан сохранённый каталог. ${message}`;
            rebuildItemsFromCatalog({ render });
            return true;
        }
        state.loadError = message;
        state.items = [];
        dom.grid.textContent = message;
        dom.resultCount.textContent = "Ошибка загрузки товаров";
        dom.activeFilters.textContent = message;
        return false;
    }
}
