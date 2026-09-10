import { dom } from "../dom.js";
import { state } from "../state.js";
import { formatMoneyKzt } from "../stock/stock-api.js";
import { createSaleId, saveSale } from "./sales-store.js";

let pendingItem = null;

function localDateValue(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function selectedSaleDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!match) return null;
    const now = new Date();
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day, now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day
        || year !== now.getFullYear() || date.getTime() > now.getTime()) {
        return null;
    }
    return date;
}

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
    const now = new Date();
    dom.saleDate.min = `${now.getFullYear()}-01-01`;
    dom.saleDate.max = localDateValue(now);
    dom.saleDate.value = localDateValue(now);
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
        const soldAt = selectedSaleDate(dom.saleDate?.value);
        const price = Number(dom.salePrice.value);
        const quantity = Math.trunc(Number(dom.saleQuantity.value));
        if (!soldAt || !Number.isFinite(price) || price < 0 || !Number.isInteger(quantity) || quantity < 1) {
            dom.saleStatus.textContent = "Проверьте дату, цену и количество.";
            return;
        }
        const now = new Date().toISOString();
        const submit = dom.saleForm.querySelector('[type="submit"]');
        if (submit) submit.disabled = true;
        try {
            await saveSale({ id: createSaleId(), article: pendingItem.article, title: pendingItem.title, category: pendingItem.category, price, quantity, percent: Number(pendingItem.percent) || 0, soldAt: soldAt.toISOString(), rateMonthLabel: currentRateMonthLabel(), createdAt: now, updatedAt: now, returned: false });
            closeSaleDialog();
        } catch (error) {
            console.error("Не удалось сохранить продажу:", error);
            dom.saleStatus.textContent = error.message || "Не удалось сохранить продажу.";
        } finally {
            if (submit) submit.disabled = false;
        }
    });
}
