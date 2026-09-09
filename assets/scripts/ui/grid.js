import { dom } from "../dom.js";
import { state } from "../state.js";
import { CATEGORY_ALL } from "../config.js";
import { buildSulpakCharacteristicsUrl } from "../catalog/catalog-items.js";
import { getSelectedCityContext, getSelectedRegionValue } from "../regions/regions.js";
import { setProfileStatus } from "../profile/profile-status.js";
import { fetchStockForArticle, formatMoneyKzt } from "../stock/stock-api.js";
import { ensureCurrentRegionEntry, getStockRecordByArticle, saveStockCache, updateRegionUpdatedAtLabel } from "../stock/stock-cache.js";
import { showStockInfoModal } from "../stock/stock-info-modal.js";
import { saveQuickReturnState } from "../quick-return.js";
import { openViewerWithImage } from "./viewer.js";
import { closeCategoryDrawer } from "./drawers.js";
import { openSaleDialog } from "../sales/sale-dialog.js";

/**
 * Сетка карточек товаров: рендер, фильтрация, категории и звёзды рейтинга.
 */

/** Перерисовывает список категорий в выдвижной панели с учётом фильтра по подстроке. */
function renderCategoryList(filter = "") {
    dom.categoryList.innerHTML = "";
    const normalizedFilter = filter.toString().trim().toLowerCase();

    const visibleCategories = [CATEGORY_ALL, ...state.categories].filter((category) =>
        category.toLowerCase().includes(normalizedFilter)
    );

    visibleCategories.forEach((category) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "category-item";
        item.dataset.category = category;
        item.textContent = category === CATEGORY_ALL ? "Все" : category;
        item.classList.toggle("active", state.activeCategory === category);
        dom.categoryList.append(item);
    });
}

/** Сохраняет новый список категорий в состоянии и перерисовывает панель категорий. */
export function createCategoryList(uniqueCategories) {
    state.categories = uniqueCategories;
    renderCategoryList();
}

/** Подсвечивает активную категорию среди кнопок панели категорий. */
function updateCategoryActiveState() {
    const buttons = dom.categoryList.querySelectorAll(".category-item");
    buttons.forEach((button) => {
        const category = button.dataset.category;
        button.classList.toggle("active", state.activeCategory === category);
    });
}

/** Создаёт DOM-карточку товара из шаблона #cardTemplate. */
function createCard(item) {
    const clone = dom.template.content.cloneNode(true);
    const card = clone.querySelector(".card");
    const image = clone.querySelector(".photo");
    const titleEl = clone.querySelector(".card-title");
    const priceEl = clone.querySelector(".card-price");
    const articleEl = clone.querySelector(".card-article");
    const stockInfoEl = clone.querySelector(".card-stock-info");
    const saleButton = clone.querySelector(".card-sale-btn");
    const modelEl = clone.querySelector(".card-model");
    const starsEl = clone.querySelector(".card-stars");
    const stockRecord = getStockRecordByArticle(item.article);

    // Считаем количество отображаемых звёзд: приоритет явному проценту (колонка E), иначе — полю stars.
    let display = 0;
    if (typeof item.percent === "number") {
        display = Math.max(0, Math.min(5, Math.round(item.percent)));
    } else {
        const raw = Number(item.stars) || 0;
        if (raw > 5) {
            display = Math.round(Math.min(100, raw) / 20);
        } else if (raw > 0 && raw <= 1) {
            display = Math.round(raw * 5);
        } else {
            display = Math.round(raw);
        }
        display = Math.max(0, Math.min(5, display));
    }

    card.classList.add(`stars${display}`);
    const filledStars = "★".repeat(display);
    const hollowStars = "☆".repeat(5 - display);
    starsEl.innerHTML = `<span class="stars-text">${filledStars}</span><span class="stars-hollow">${hollowStars}</span>`;

    // SVG-заглушка для товаров без фото или с ошибкой загрузки изображения.
    const placeholderSvg = encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800">'
        + '<rect width="100%" height="100%" fill="#0f1724"/>'
        + '<g fill="#cbd5e1" opacity="0.9">'
        + '<rect x="80" y="180" width="640" height="420" rx="20"/>'
        + '<circle cx="200" cy="400" r="70"/>'
        + '</g>'
        + '<text x="50%" y="90%" fill="#8b9bb0" font-size="36" font-family="Inter, Arial, sans-serif" text-anchor="middle">Нет фото</text>'
        + '</svg>'
    );
    const placeholder = `data:image/svg+xml;utf8,${placeholderSvg}`;

    const photoUrl = String(stockRecord?.photoUrl || "").trim();
    image.src = photoUrl || item.image || placeholder;
    image.alt = item.title;

    image.addEventListener("error", () => {
        if (image.src !== placeholder) {
            image.src = placeholder;
        }
        image.classList.add("no-photo");
    });
    image.addEventListener("load", () => {
        image.classList.remove("no-photo");
    });

    titleEl.textContent = item.title;
    priceEl.textContent = `Цена: ${formatMoneyKzt(stockRecord?.price)}`;
    articleEl.textContent = `Артикул: #${item.article}`;

    priceEl.title = stockRecord
        ? `Остаток: ${Number.isFinite(Number(stockRecord.count)) ? Number(stockRecord.count) : 0}`
        : "Цена и остатки будут доступны после загрузки в личном кабинете";

    if (stockInfoEl) {
        const count = Number.isFinite(Number(stockRecord?.count)) ? Number(stockRecord.count) : 0;
        stockInfoEl.textContent = count > 0 ? String(count) : "i";
        stockInfoEl.title = stockRecord
            ? `Показать остатки (${count})`
            : "Нет данных по остаткам. Обновите в личном кабинете";
    }

    modelEl.textContent = item.category;

    articleEl.addEventListener("click", (event) => {
        event.stopPropagation();
    });

    articleEl.addEventListener("dblclick", (event) => {
        event.preventDefault();
        event.stopPropagation();

        const url = buildSulpakCharacteristicsUrl(item.article);
        if (!url) {
            return;
        }

        saveQuickReturnState();
        window.location.assign(url);
    });

    if (stockInfoEl) {
        stockInfoEl.addEventListener("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();

            const region = getSelectedRegionValue();
            const { cityId, cityName } = getSelectedCityContext();
            if (!region || !cityId) {
                setProfileStatus("Выберите регион и магазин в личном кабинете.", "error");
                return;
            }

            stockInfoEl.disabled = true;
            const previousText = stockInfoEl.textContent;
            stockInfoEl.textContent = "...";

            try {
                const stockRecord = await fetchStockForArticle(cityId, cityName, item.article);
                const regionEntry = ensureCurrentRegionEntry();
                if (regionEntry) {
                    regionEntry.items[item.article] = stockRecord;
                    regionEntry.updatedAt = Date.now();
                    saveStockCache();
                }
                updateRegionUpdatedAtLabel();
                renderCards();
                showStockInfoModal(item, stockRecord);
            } catch (error) {
                console.warn(`Ошибка загрузки карточки остатка для ${item.article}:`, error);
                setProfileStatus(`Не удалось загрузить остатки по товару #${item.article}.`, "error");
                showStockInfoModal(item);
            } finally {
                stockInfoEl.disabled = false;
                stockInfoEl.textContent = previousText;
            }
        });
    }

    saleButton?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openSaleDialog(item, stockRecord?.price);
    });

    card.addEventListener("click", () => {
        const viewerPhotoUrl = String(stockRecord?.photoUrl || "").trim();
        const imageUrl = viewerPhotoUrl || item.image;
        if (imageUrl) {
            openViewerWithImage(imageUrl, item.title);
        }
    });

    return clone;
}

/** Обновляет строки "Найдено товаров" и "Активные фильтры". */
function updateSummary(total) {
    const filters = [];

    if (state.activeCategory !== CATEGORY_ALL) {
        filters.push(`Категория: ${state.activeCategory}`);
    }

    if (state.activeStars) {
        filters.push(`Звезды: ${state.activeStars}%`);
    }

    if (state.searchQuery) {
        filters.push(`Поиск: «${state.searchQuery}»`);
    }

    if (state.priceSort === "desc") {
        filters.push("Цена: по убыванию");
    } else if (state.priceSort === "asc") {
        filters.push("Цена: по возрастанию");
    }

    if (state.loadWarning) {
        filters.push(state.loadWarning);
    }

    dom.resultCount.textContent = `Найдено товаров: ${total}`;
    dom.activeFilters.textContent = filters.join(" • ");
}

/** Применяет все активные фильтры (категория, звёзды, поиск, скрытие нулевой цены/отсутствия остатка). */
function filterItems() {
    return state.items.filter((item) => {
        const stockRecord = getStockRecordByArticle(item.article);

        if (state.hideZeroPrice && stockRecord && Number(stockRecord.price || 0) <= 0) {
            return false;
        }

        if (state.hideNoStock) {
            // Если данных по остаткам вообще нет, считаем товар отсутствующим и скрываем.
            if (!stockRecord) {
                return false;
            }

            if (Number(stockRecord.count || 0) <= 0) {
                return false;
            }
        }

        if (state.activeCategory !== CATEGORY_ALL && item.category !== state.activeCategory) {
            return false;
        }

        if (state.activeStars) {
            // Приоритет явному проценту (колонка E), иначе сравниваем по количеству звёзд.
            if (typeof item.percent === "number") {
                if (Number(item.percent) !== Number(state.activeStars)) {
                    return false;
                }
            } else if (Number(item.stars) !== Number(state.activeStars)) {
                return false;
            }
        }

        if (state.searchQuery) {
            const query = state.searchQuery.toLowerCase();
            return item.title.toLowerCase().includes(query)
                || item.article.toLowerCase().includes(query)
                || item.category.toLowerCase().includes(query);
        }

        return true;
    });
}

/** Сортирует список товаров по цене из карточки остатков; товары без цены всегда в конце. */
function sortItemsByPrice(items) {
    if (state.priceSort !== "asc" && state.priceSort !== "desc") {
        return items;
    }

    const direction = state.priceSort === "asc" ? 1 : -1;
    return items.slice().sort((left, right) => {
        const leftPrice = Number(getStockRecordByArticle(left.article)?.price || 0);
        const rightPrice = Number(getStockRecordByArticle(right.article)?.price || 0);

        if (leftPrice <= 0 || rightPrice <= 0) {
            return (leftPrice > 0 ? -1 : 0) - (rightPrice > 0 ? -1 : 0);
        }

        return (leftPrice - rightPrice) * direction;
    });
}

/** Обновляет подпись и активное состояние кнопки сортировки по цене. */
export function updateSortPriceButton() {
    if (!dom.sortPriceBtn) {
        return;
    }

    const titles = {
        none: "Сортировка по цене: выключена",
        desc: "Сортировка по цене: по убыванию",
        asc: "Сортировка по цене: по возрастанию",
    };

    dom.sortPriceBtn.title = titles[state.priceSort] || titles.none;
    dom.sortPriceBtn.setAttribute("aria-pressed", state.priceSort === "none" ? "false" : "true");
    dom.sortPriceBtn.classList.toggle("active", state.priceSort !== "none");
    dom.sortPriceBtn.classList.toggle("sort-asc", state.priceSort === "asc");
}

/** Полностью перерисовывает сетку карточек согласно текущим фильтрам. */
export function renderCards() {
    const matched = sortItemsByPrice(filterItems());

    dom.grid.innerHTML = "";

    if (!matched.length) {
        const emptyState = document.createElement("div");
        emptyState.className = "empty-state";

        const title = document.createElement("div");
        title.className = "empty-title";
        title.textContent = !state.items.length && state.loadError ? state.loadError : "Товаров не найдено.";

        const description = document.createElement("div");
        description.className = "empty-text";
        description.textContent = "Попробуйте изменить поиск или очистить фильтры. Если для товара нет фото, он может не отображаться.";

        emptyState.append(title, description);
        dom.grid.append(emptyState);

        updateSummary(0);
        return;
    }

    matched.forEach((item) => {
        dom.grid.append(createCard(item));
    });

    updateSummary(matched.length);
}

/** Подсвечивает выбранные звёзды в панели фильтра рейтинга. */
export function updateStarsButtons() {
    const buttons = dom.stars.querySelectorAll(".star");
    buttons.forEach((button) => {
        const value = Number(button.dataset.stars || 0);
        button.classList.toggle("active", value <= state.activeStars && state.activeStars > 0);
        button.textContent = value <= state.activeStars ? "★" : "☆";
    });
}

/** Обновляет визуальное состояние кнопок категорий (алиас для симметрии с updateStarsButtons). */
export function updateCategoryButtons() {
    updateCategoryActiveState();
}
