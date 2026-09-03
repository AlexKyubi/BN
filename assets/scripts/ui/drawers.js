import { dom } from "../dom.js";
import { state } from "../state.js";
import { DEFAULT_MONTH_COLUMN_INDEX } from "../config.js";
import { formatMonthBadgeText } from "../utils.js";

/**
 * Выдвижные панели категорий/месяцев и список доступных месяцев (колонок рейтинга).
 */

/** Возвращает подпись активной колонки месяца (или пустую строку). */
export function getActiveMonthLabel() {
    const activeMonth = state.monthColumns.find((month) => month.index === state.activeMonthColumn);
    return activeMonth ? activeMonth.label : "";
}

/** Перестраивает список месяцев в выдвижной панели и обновляет бейдж активного месяца. */
export function syncMonthSelector() {
    if (!dom.monthList) {
        return;
    }

    dom.monthList.innerHTML = "";

    if (!state.monthColumns.length) {
        const empty = document.createElement("div");
        empty.className = "empty-text";
        empty.textContent = "Месяцы не найдены";
        dom.monthList.append(empty);
        if (dom.monthToggle) {
            dom.monthToggle.disabled = true;
        }
        return;
    }

    if (!state.monthColumns.some((month) => month.index === state.activeMonthColumn)) {
        const hasDefaultMonth = state.monthColumns.some((month) => month.index === DEFAULT_MONTH_COLUMN_INDEX);
        state.activeMonthColumn = hasDefaultMonth
            ? DEFAULT_MONTH_COLUMN_INDEX
            : state.monthColumns[0].index;
    }

    state.monthColumns.forEach((month) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "category-item month-item";
        button.dataset.monthIndex = String(month.index);
        button.textContent = month.label;
        button.classList.toggle("active", month.index === state.activeMonthColumn);
        dom.monthList.append(button);
    });

    if (dom.monthToggle) {
        dom.monthToggle.disabled = false;
        const activeMonthLabel = getActiveMonthLabel();
        dom.monthToggle.title = activeMonthLabel
            ? `Выбран месяц: ${activeMonthLabel}`
            : "Выбрать месяц";
    }

    if (dom.monthBadge) {
        const badgeText = formatMonthBadgeText(getActiveMonthLabel());
        dom.monthBadge.textContent = badgeText;
        dom.monthBadge.classList.toggle("hidden", !badgeText);
    }
}

/** Открывает панель категорий (закрывая панель месяцев). */
export function openCategoryDrawer() {
    closeMonthDrawer();
    dom.categoryDrawer.classList.remove("hidden");
    dom.categoryDrawer.setAttribute("aria-hidden", "false");
    document.body.classList.add("drawer-open");
}

/** Закрывает панель категорий. */
export function closeCategoryDrawer() {
    dom.categoryDrawer.classList.add("hidden");
    dom.categoryDrawer.setAttribute("aria-hidden", "true");
    if (dom.monthDrawer?.classList.contains("hidden")) {
        document.body.classList.remove("drawer-open");
    }
}

/** Открывает панель месяцев (закрывая панель категорий). */
export function openMonthDrawer() {
    closeCategoryDrawer();
    dom.monthDrawer.classList.remove("hidden");
    dom.monthDrawer.setAttribute("aria-hidden", "false");
    document.body.classList.add("drawer-open");
}

/** Закрывает панель месяцев. */
export function closeMonthDrawer() {
    dom.monthDrawer.classList.add("hidden");
    dom.monthDrawer.setAttribute("aria-hidden", "true");
    if (dom.categoryDrawer?.classList.contains("hidden")) {
        document.body.classList.remove("drawer-open");
    }
}
