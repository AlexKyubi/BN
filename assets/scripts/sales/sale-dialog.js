import { dom } from "../dom.js";
import { state } from "../state.js";
import { formatMoneyKzt } from "../stock/stock-api.js";
import { createSaleId, saveSale } from "./sales-store.js";

let pendingItem = null;

function currentRateMonthLabel() {
    return state.monthColumns.find((month) => month.index === state.activeMonthColumn)?.label || "";
}

function updateCalculation() {
    if (!pendingItem || !dom.saleCalculation) return;
    const price = Math.max(0, Number(dom.salePrice?.value) || 0);
    const quantity = Math.max(1, Math.trunc(Number(dom.saleQuantity?.value) || 1));
    const percent = Math.max(0, Number(pendingItem.percent) || 0);
    dom.saleCalculation.textContent = `Начисление: ${formatMoneyKzt(Math.round(price * quantity * percent) / 100)} (${percent}%)`;
}

export function openSaleDialog(item, price) {
    if (!dom.saleModal || !item) return;
    pendingItem = item;
    dom.saleProductTitle.textContent = item.title;
    dom.saleProductArticle.textContent = `Артикул #${item.article} · ${currentRateMonthLabel() || "текущий месяц"}`;
    dom.salePrice.value = Number.isFinite(Number(price)) ? Math.max(0, Number(price)) : 0;
    dom.saleQuantity.value = 1;
    dom.saleStatus.textContent = "";
    updateCalculation();
    dom.saleModal.classList.remove("hidden");
    requestAnimationFrame(() => dom.saleQuantity?.focus());
}

function closeSaleDialog() {
    dom.saleModal?.classList.add("hidden");
    pendingItem = null;
}

export function initSaleDialog() {
    if (!dom.saleForm) return;
    dom.salePrice?.addEventListener("input", updateCalculation);
    dom.saleQuantity?.addEventListener("input", updateCalculation);
    dom.closeSaleModal?.addEventListener("click", closeSaleDialog);
    dom.cancelSaleModal?.addEventListener("click", closeSaleDialog);
    dom.saleBackdrop?.addEventListener("click", closeSaleDialog);
    dom.saleForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!pendingItem) return;
        const price = Number(dom.salePrice.value);
        const quantity = Math.trunc(Number(dom.saleQuantity.value));
        if (!Number.isFinite(price) || price < 0 || !Number.isInteger(quantity) || quantity < 1) {
            dom.saleStatus.textContent = "Проверьте цену и количество.";
            return;
        }
        const now = new Date().toISOString();
        const submit = dom.saleForm.querySelector('[type="submit"]');
        if (submit) submit.disabled = true;
        try {
            await saveSale({ id: createSaleId(), article: pendingItem.article, title: pendingItem.title, category: pendingItem.category, price, quantity, percent: Number(pendingItem.percent) || 0, soldAt: now, rateMonthLabel: currentRateMonthLabel(), createdAt: now, updatedAt: now, returned: false });
            closeSaleDialog();
        } catch (error) {
            console.error("Не удалось сохранить продажу:", error);
            dom.saleStatus.textContent = error.message || "Не удалось сохранить продажу.";
        } finally {
            if (submit) submit.disabled = false;
        }
    });
}
