import { dom } from "../dom.js";
import { escapeHtml } from "../utils.js";
import { formatMoneyKzt, formatStockUpdatedAt } from "./stock-api.js";
import { getStockRecordByArticle } from "./stock-cache.js";

/**
 * Модальное окно с подробной информацией об остатках по товару.
 */

/** Строит HTML списка магазинов с наличием товара. */
function createStoreInfoHtml(stores) {
    if (!Array.isArray(stores) || !stores.length) {
        return "<p class=\"stock-info-empty\">Точки с остатками не найдены.</p>";
    }

    const items = stores.map((store) => {
        const address = escapeHtml(store.address || "Без адреса");
        const availability = escapeHtml(store.availability || "Нет данных");
        return `<li><strong>${address}</strong><span>${availability}</span></li>`;
    }).join("");

    return `<ul class=\"stock-info-list\">${items}</ul>`;
}

/** Показывает модальное окно с деталями остатков по товару. */
export function showStockInfoModal(item, stockRecord = null) {
    const currentRecord = stockRecord || getStockRecordByArticle(item?.article);
    if (!dom.stockInfoModal || !dom.stockInfoBody) {
        return;
    }

    const city = currentRecord?.cityTitle || "-";
    const count = Number.isFinite(Number(currentRecord?.count)) ? Number(currentRecord.count) : 0;
    const price = formatMoneyKzt(currentRecord?.price);
    const updatedAt = formatStockUpdatedAt(currentRecord?.updatedAt);

    dom.stockInfoBody.innerHTML = `
        <p><strong>Товар:</strong> #${escapeHtml(item?.article || "-")}</p>
        <p><strong>Название:</strong> ${escapeHtml(item?.title || "-")}</p>
        <p><strong>Город:</strong> ${escapeHtml(city)}</p>
        <p><strong>Цена:</strong> ${escapeHtml(price)}</p>
        <p><strong>Остаток:</strong> ${escapeHtml(String(count))}</p>
        <p><strong>Обновлено:</strong> ${escapeHtml(updatedAt)}</p>
        ${createStoreInfoHtml(currentRecord?.stores || [])}
    `;

    dom.stockInfoModal.classList.remove("hidden");
    dom.stockInfoModal.removeAttribute("inert");
    dom.stockInfoModal.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => dom.closeStockInfoModal?.focus());
}

/** Закрывает модальное окно с деталями остатков. */
export function closeStockInfoModal() {
    if (!dom.stockInfoModal) {
        return;
    }

    if (dom.stockInfoModal.contains(document.activeElement)) {
        document.activeElement.blur();
    }
    dom.stockInfoModal.setAttribute("aria-hidden", "true");
    dom.stockInfoModal.setAttribute("inert", "");
    dom.stockInfoModal.classList.add("hidden");
}
