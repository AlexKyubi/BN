import { loadSavedUserName } from "../auth/device-auth.js";
import { state } from "../state.js";
import { ACTIVE_MONTH_INDEX_STORAGE_KEY, ACTIVE_MONTH_LABEL_STORAGE_KEY, DASHBOARD_FAST_RETURN_KEY, DASHBOARD_RETURN_MARKER_KEY, HIDE_NO_STOCK_STORAGE_KEY, HIDE_ZERO_PRICE_STORAGE_KEY } from "../config.js";
import { buildRegionCityModel, fillProfileRegionSelect, getSelectedCityContext, loadProfileSelection, loadRegionRows, saveProfileSelection, syncProfileCitySelect } from "../regions/regions.js";
import { downloadRegionStockReport, fetchRegionStockSnapshot } from "../stock/stock-api.js";
import { askReportPassword, initReportPasswordModal } from "../ui/password-prompt.js";
import { createSalesWorkbook } from "./xlsx-report.js";
import { shareOrDownload } from "./file-share.js";
import { deleteSale, exportSalesBackup, getAllSales, importSalesBackup, saveSale } from "./sales-store.js";
import { initVersionManager } from "../update/version-manager.js";
import { initThemeManager } from "../theme/theme-manager.js";
import { normalizeCatalogSearchInput } from "../utils.js";

const $ = (id) => document.getElementById(id);
const money = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const monthFormatter = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" });
const monthShortFormatter = new Intl.DateTimeFormat("ru-RU", { month: "long" });
let sales = [];
let regionSyncSequence = 0;
let catalogRegionChanged = false;
let deleteConfirmationUntil = 0;
let deleteConfirmationTimer = 0;
const today = new Date();
const CURRENT_MONTH = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
const DASHBOARD_MONTH_STORAGE_KEY = "bn_dashboard_month_v1";
const DASHBOARD_PAGE_STORAGE_KEY = "bn_dashboard_page_v1";
const SALES_ARTICLE_FILTER_KEY = "bn_sales_article_filter_v1";
const SALES_DATE_FROM_FILTER_KEY = "bn_sales_date_from_filter_v1";
const SALES_DATE_TO_FILTER_KEY = "bn_sales_date_to_filter_v1";
const EARLIEST_MONTH = `${today.getFullYear()}-01`;
const RETENTION_START_DATE = `${today.getFullYear()}-01-01`;
const CURRENT_LOCAL_DATE = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

function readLocalValue(key) {
    try { return localStorage.getItem(key) || ""; } catch { return ""; }
}

function writeLocalValue(key, value) {
    try { localStorage.setItem(key, String(value || "")); } catch (error) { console.warn(`Не удалось сохранить ${key}:`, error); }
}

function validMonth(value) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || "")); }
function validDashboardMonth(value) { return validMonth(value) && value >= EARLIEST_MONTH && value <= CURRENT_MONTH; }
let selectedMonth = validDashboardMonth(readLocalValue(DASHBOARD_MONTH_STORAGE_KEY)) ? readLocalValue(DASHBOARD_MONTH_STORAGE_KEY) : CURRENT_MONTH;

function formatMoney(value) { return `${money.format(Number(value) || 0)} ₸`; }
function monthDate(key) { const [year, month] = key.split("-").map(Number); return new Date(year, month - 1, 1); }
function shiftMonth(delta) { const date = monthDate(selectedMonth); date.setMonth(date.getMonth() + delta); const next = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; if (!validDashboardMonth(next)) return; selectedMonth = next; writeLocalValue(DASHBOARD_MONTH_STORAGE_KEY, selectedMonth); render(); }
function activeSales(month = selectedMonth) { return sales.filter((sale) => sale.month === month && !sale.returned); }
function escapeText(value) { return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function setStatus(message, error = false) { const node = $("dashboardStatus"); if (node) { node.textContent = message; node.style.color = error ? "#ff8f8f" : "#8ff0b0"; } }

function setProfileSyncStatus(message, tone = "") {
    const node = $("profileSyncStatus");
    if (!node) return;
    node.textContent = message || "";
    node.classList.remove("syncing", "ok", "error");
    if (tone) node.classList.add(tone);
}

function userInitials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    return (parts.slice(0, 2).map((part) => part[0]).join("") || "П").toLocaleUpperCase("ru-RU");
}

function saleMarkup(sale) {
    const date = new Date(sale.soldAt);
    return `<article class="sale-row${sale.returned ? " returned" : ""}" data-sale-id="${escapeText(sale.id)}"><time class="sale-time">${date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })}<br>${date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</time><div class="sale-main"><strong>${escapeText(sale.title)}</strong><span>Артикул #${escapeText(sale.article)} · ${escapeText(sale.category)}</span></div><div class="sale-result"><strong>${sale.returned ? "Возвращена" : `+${formatMoney(sale.commission)}`}</strong><span>${formatMoney(sale.price)} × ${sale.quantity}</span></div></article>`;
}

function renderChart(monthSales) {
    const totals = new Map();
    for (const sale of monthSales) { const day = new Date(sale.soldAt).getDate(); totals.set(day, (totals.get(day) || 0) + sale.commission); }
    const daysInMonth = new Date(monthDate(selectedMonth).getFullYear(), monthDate(selectedMonth).getMonth() + 1, 0).getDate();
    const max = Math.max(1, ...totals.values());
    const sampled = Array.from({ length: daysInMonth }, (_, i) => i + 1).filter((day) => day === 1 || day === daysInMonth || day % Math.max(1, Math.ceil(daysInMonth / 9)) === 0);
    $("salesChart").innerHTML = sampled.map((day) => `<div class="chart-column"><div class="bar" style="height:${Math.max(5, ((totals.get(day) || 0) / max) * 100)}%"></div><span>${day}</span></div>`).join("");
}

function renderCategories(monthSales) {
    const totals = new Map();
    for (const sale of monthSales) totals.set(sale.category, (totals.get(sale.category) || 0) + sale.commission);
    const total = [...totals.values()].reduce((sum, value) => sum + value, 0);
    const rows = [...totals].sort((a, b) => b[1] - a[1]);
    $("categoryAnalytics").innerHTML = rows.length ? rows.map(([category, value]) => { const percent = total ? Math.round(value / total * 100) : 0; return `<div class="category-row"><div class="category-top"><span>${escapeText(category)}</span><strong>${formatMoney(value)} · ${percent}%</strong></div><div class="progress"><span style="width:${percent}%"></span></div></div>`; }).join("") : `<p class="panel-subtitle">В этом месяце продаж пока нет.</p>`;
}

function renderSalesList() {
    const articleQuery = normalizeCatalogSearchInput($("salesArticleSearch")?.value || "");
    const dateFrom = $("salesDateFrom")?.value || "";
    const dateTo = $("salesDateTo")?.value || "";
    const visible = sales.filter((sale) => {
        const date = new Date(sale.soldAt);
        const localDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        return (!articleQuery || sale.article.toLocaleUpperCase("en-US").includes(articleQuery))
            && (!dateFrom || localDate >= dateFrom)
            && (!dateTo || localDate <= dateTo);
    }).sort((a, b) => Date.parse(b.soldAt) - Date.parse(a.soldAt));
    $("allSales").innerHTML = visible.length ? visible.map(saleMarkup).join("") : `<p class="panel-subtitle" style="padding:18px 0">Продажи не найдены.</p>`;
    const activeVisible = visible.filter((sale) => !sale.returned);
    const total = activeVisible.reduce((sum, sale) => sum + sale.price * sale.quantity, 0);
    let periodLabel = "за выбранный период";
    if (dateFrom && dateTo) {
        periodLabel = dateFrom === dateTo
            ? `за ${new Date(`${dateFrom}T00:00:00`).toLocaleDateString("ru-RU")}`
            : `с ${new Date(`${dateFrom}T00:00:00`).toLocaleDateString("ru-RU")} по ${new Date(`${dateTo}T00:00:00`).toLocaleDateString("ru-RU")}`;
    }
    $("salesPeriodLabel").textContent = `Сумма продаж ${periodLabel}`;
    $("salesPeriodTotal").textContent = formatMoney(total);
    $("salesPeriodOperations").textContent = `${activeVisible.length} операций`;
}

function renderMonthlyInsights(monthSales) {
    const dailySales = new Map();
    for (const sale of monthSales) {
        const date = new Date(sale.soldAt);
        const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
        dailySales.set(key, (dailySales.get(key) || 0) + sale.price * sale.quantity);
    }
    const best = [...dailySales].sort((a, b) => b[1] - a[1])[0];
    const bestDate = best ? new Date(...best[0].split("-").map(Number)) : null;
    const salesTotal = monthSales.reduce((sum, sale) => sum + sale.price * sale.quantity, 0);
    const largestCommission = Math.max(0, ...monthSales.map((sale) => Number(sale.commission) || 0));
    const returned = sales.filter((sale) => sale.month === selectedMonth && sale.returned).length;
    $("bestSalesDay").textContent = bestDate ? `${bestDate.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" })} · ${formatMoney(best[1])}` : "—";
    $("averageSaleValue").textContent = formatMoney(monthSales.length ? salesTotal / monthSales.length : 0);
    $("largestCommission").textContent = formatMoney(largestCommission);
    $("returnsTotal").textContent = money.format(returned);
}

function handleSalesDateFilter(changedId) {
    const from = $("salesDateFrom");
    const to = $("salesDateTo");
    if (from.value && to.value && from.value > to.value) {
        if (changedId === "salesDateFrom") to.value = from.value;
        else from.value = to.value;
    }
    writeLocalValue(SALES_DATE_FROM_FILTER_KEY, from.value);
    writeLocalValue(SALES_DATE_TO_FILTER_KEY, to.value);
    renderSalesList();
}

function render() {
    const monthSales = activeSales();
    const salesTotal = monthSales.reduce((sum, sale) => sum + sale.price * sale.quantity, 0);
    const commission = monthSales.reduce((sum, sale) => sum + sale.commission, 0);
    const units = monthSales.reduce((sum, sale) => sum + sale.quantity, 0);
    const previous = monthDate(selectedMonth); previous.setMonth(previous.getMonth() - 1);
    const previousKey = `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, "0")}`;
    const previousCommission = activeSales(previousKey).reduce((sum, sale) => sum + sale.commission, 0);
    const title = monthFormatter.format(monthDate(selectedMonth));
    $("periodTitle").textContent = title[0].toUpperCase() + title.slice(1);
    $("previousMonth").disabled = selectedMonth <= EARLIEST_MONTH;
    $("nextMonth").disabled = selectedMonth >= CURRENT_MONTH;
    $("monthShortTitle").textContent = monthShortFormatter.format(monthDate(selectedMonth));
    $("insightsPeriod").textContent = `За ${title.toLocaleLowerCase("ru-RU")}`;
    $("commissionTotal").textContent = formatMoney(commission);
    $("salesTotal").textContent = formatMoney(salesTotal);
    $("unitsTotal").textContent = money.format(units);
    $("operationsTotal").textContent = `${monthSales.length} операций`;
    $("averageCommission").textContent = formatMoney(units ? commission / units : 0);
    $("monthComparison").textContent = previousCommission ? `${commission >= previousCommission ? "↑" : "↓"} ${Math.abs(Math.round((commission - previousCommission) / previousCommission * 100))}% к прошлому месяцу` : "Нет данных для сравнения";
    renderChart(monthSales);
    renderCategories(monthSales);
    renderMonthlyInsights(monthSales);
    renderSalesList();
}

function showPage(name) {
    const pageName = name === "sales" ? "sales" : "overview";
    writeLocalValue(DASHBOARD_PAGE_STORAGE_KEY, pageName);
    document.querySelector("body > .dashboard-shell")?.classList.toggle("hidden", pageName === "sales");
    $("salesPage").classList.toggle("hidden", pageName !== "sales");
    $("navOverview").classList.toggle("active", pageName !== "sales");
    $("navSales").classList.toggle("active", pageName === "sales");
    if (pageName === "sales") renderSalesList();
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function returnToCatalog() {
    let shouldGoBack = false;
    try {
        shouldGoBack = sessionStorage.getItem(DASHBOARD_RETURN_MARKER_KEY) === "1" && window.history.length > 1;
        sessionStorage.removeItem(DASHBOARD_RETURN_MARKER_KEY);
        if (catalogRegionChanged) sessionStorage.removeItem(DASHBOARD_FAST_RETURN_KEY);
    } catch (error) {
        console.warn("Не удалось прочитать маршрут возврата:", error);
    }
    // После смены региона нужен новый экземпляр каталога: BFCache сохранил бы DOM
    // и остатки предыдущего региона. Обычная загрузка получит снимок новой SQLite-записи.
    if (catalogRegionChanged) {
        window.location.assign("index.html");
        return;
    }
    if (shouldGoBack) {
        try {
            sessionStorage.setItem(DASHBOARD_FAST_RETURN_KEY, "1");
        } catch (error) {
            console.warn("Не удалось включить быстрый возврат:", error);
        }
        window.history.back();
    } else {
        window.location.assign("index.html");
    }
}

function openEditor(id) {
    const sale = sales.find((item) => item.id === id);
    if (!sale) return;
    resetDeleteConfirmation();
    $("editSaleId").value = sale.id;
    $("editSaleDate").value = new Date(new Date(sale.soldAt).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    $("editSalePrice").value = sale.price;
    $("editSaleQuantity").value = sale.quantity;
    $("editSaleState").value = sale.returned ? "returned" : "sold";
    $("editSaleStatus").textContent = "";
    $("editSaleModal").classList.remove("hidden");
}

function resetDeleteConfirmation() {
    if (deleteConfirmationTimer) window.clearTimeout(deleteConfirmationTimer);
    deleteConfirmationTimer = 0;
    deleteConfirmationUntil = 0;
    const button = $("deleteSaleBtn");
    const label = $("deleteSaleLabel");
    if (button) {
        button.classList.remove("confirming");
        button.disabled = false;
    }
    if (label) label.textContent = "Удалить";
}

function closeEditor() {
    resetDeleteConfirmation();
    $("editSaleModal").classList.add("hidden");
}

async function handleDeleteSale() {
    const status = $("editSaleStatus");
    if (Date.now() > deleteConfirmationUntil) {
        deleteConfirmationUntil = Date.now() + 5000;
        $("deleteSaleBtn").classList.add("confirming");
        $("deleteSaleLabel").textContent = "Подтвердить удаление";
        status.textContent = "Нажмите кнопку ещё раз в течение 5 секунд.";
        deleteConfirmationTimer = window.setTimeout(() => {
            resetDeleteConfirmation();
            status.textContent = "";
        }, 5000);
        return;
    }

    const button = $("deleteSaleBtn");
    if (deleteConfirmationTimer) window.clearTimeout(deleteConfirmationTimer);
    deleteConfirmationTimer = 0;
    button.disabled = true;
    try {
        const deleted = await deleteSale($("editSaleId").value);
        if (!deleted) throw new Error("Продажа уже удалена или не найдена.");
        sales = await getAllSales();
        closeEditor();
        render();
        setStatus("Продажа полностью удалена.");
    } catch (error) {
        resetDeleteConfirmation();
        status.textContent = error?.message || "Не удалось удалить продажу.";
    }
}

async function initRegions() {
    try {
        const rows = await loadRegionRows();
        state.regionsModel = buildRegionCityModel(rows);
        fillProfileRegionSelect(state.regionsModel.regionNames);
        const saved = loadProfileSelection();
        $("profileRegion").value = saved.region || state.regionsModel.regionNames[0] || "";
        syncProfileCitySelect(saved.cityId);
    } catch (error) {
        console.warn("Не удалось загрузить регионы:", error);
        const saved = loadProfileSelection();
        $("profileRegion").innerHTML = `<option>${escapeText(saved.region || "Регион недоступен")}</option>`;
        $("profileCity").innerHTML = `<option value="${escapeText(saved.cityId)}">Сохранённый магазин</option>`;
    }
}

/** Запрашивает снапшот выбранного региона; актуальность отдельных записей решает сервер. */
async function syncSelectedRegionStock() {
    const { cityId } = getSelectedCityContext();
    if (!cityId) {
        setProfileSyncStatus("Выберите магазин.", "error");
        return;
    }

    const sequence = ++regionSyncSequence;
    setProfileSyncStatus("Получаем данные региона с сервера…", "syncing");
    try {
        const payload = await fetchRegionStockSnapshot(cityId, null);
        if (sequence !== regionSyncSequence) return;
        const count = Array.isArray(payload?.items) ? payload.items.length : 0;
        setProfileSyncStatus(`Данные региона синхронизированы. Получено записей: ${count}.`, "ok");
    } catch (error) {
        if (sequence !== regionSyncSequence) return;
        console.warn("Не удалось синхронизировать выбранный регион:", error);
        setProfileSyncStatus(error?.message || "Не удалось синхронизировать данные.", "error");
    }
}

async function buildReport() {
    try {
        const blob = createSalesWorkbook(sales, loadSavedUserName());
        const filename = `bonus-navigator-sales-${new Date().toISOString().slice(0, 10)}.xlsx`;
        await shareOrDownload(blob, filename, "Отчёт по продажам");
        setStatus("Отчёт сформирован.");
    } catch (error) { console.error(error); setStatus("Не удалось сформировать отчёт.", true); }
}

async function downloadStockReport() {
    const { cityId } = getSelectedCityContext();
    if (!cityId) { setStatus("Сначала выберите регион и магазин.", true); return; }
    const password = await askReportPassword();
    if (password === null) return;
    const button = $("downloadStockReportBtn");
    button.disabled = true;
    try {
        let monthColumn = -1;
        let monthLabel = "";
        try { monthColumn = Number(localStorage.getItem(ACTIVE_MONTH_INDEX_STORAGE_KEY) || -1); monthLabel = localStorage.getItem(ACTIVE_MONTH_LABEL_STORAGE_KEY) || ""; } catch (error) { console.warn("Не удалось прочитать выбранный месяц:", error); }
        await downloadRegionStockReport(cityId, { password, monthColumn, monthLabel });
        setStatus("Отчёт по остаткам сформирован.");
    } catch (error) { console.error(error); setStatus(error.message || "Не удалось скачать отчёт по остаткам.", true); }
    finally { button.disabled = false; }
}

function bindEvents() {
    $("previousMonth").addEventListener("click", () => shiftMonth(-1));
    $("nextMonth").addEventListener("click", () => shiftMonth(1));
    document.querySelector(".dashboard-back")?.addEventListener("click", (event) => {
        event.preventDefault();
        returnToCatalog();
    });
    $("navCatalog").addEventListener("click", returnToCatalog);
    $("navOverview").addEventListener("click", () => showPage("overview"));
    $("navSales").addEventListener("click", () => showPage("sales"));
    $("closeSalesList").addEventListener("click", () => showPage("overview"));
    $("salesArticleSearch").addEventListener("input", (event) => {
        const normalized = normalizeCatalogSearchInput(event.target.value);
        if (event.target.value !== normalized) event.target.value = normalized;
        writeLocalValue(SALES_ARTICLE_FILTER_KEY, normalized);
        renderSalesList();
    });
    $("salesDateFrom").addEventListener("input", () => handleSalesDateFilter("salesDateFrom"));
    $("salesDateTo").addEventListener("input", () => handleSalesDateFilter("salesDateTo"));
    $("allSales").addEventListener("click", (event) => { const row = event.target.closest("[data-sale-id]"); if (row) openEditor(row.dataset.saleId); });
    $("closeEditSale").addEventListener("click", closeEditor); $("cancelEditSale").addEventListener("click", closeEditor); $("editSaleBackdrop").addEventListener("click", closeEditor);
    $("deleteSaleBtn").addEventListener("click", () => void handleDeleteSale());
    $("editSaleForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        const sale = sales.find((item) => item.id === $("editSaleId").value);
        if (!sale) return;
        const soldAt = new Date($("editSaleDate").value);
        const price = Number($("editSalePrice").value);
        const quantity = Number($("editSaleQuantity").value);
        if (Number.isNaN(soldAt.getTime()) || !Number.isFinite(price) || price < 0 || !Number.isInteger(quantity) || quantity < 1) {
            $("editSaleStatus").textContent = "Проверьте дату, цену и количество.";
            return;
        }
        try {
            await saveSale({ ...sale, soldAt: soldAt.toISOString(), price, quantity, returned: $("editSaleState").value === "returned" });
            sales = await getAllSales();
            closeEditor();
            render();
        } catch (error) {
            $("editSaleStatus").textContent = error?.message || "Не удалось сохранить изменения.";
        }
    });
    $("profileRegion").addEventListener("change", () => {
        catalogRegionChanged = true;
        syncProfileCitySelect();
        saveProfileSelection($("profileRegion").value, $("profileCity").value);
        void syncSelectedRegionStock();
    });
    $("profileCity").addEventListener("change", () => {
        catalogRegionChanged = true;
        saveProfileSelection($("profileRegion").value, $("profileCity").value);
        void syncSelectedRegionStock();
    });
    $("hideZeroPrice").addEventListener("change", () => { try { localStorage.setItem(HIDE_ZERO_PRICE_STORAGE_KEY, $("hideZeroPrice").checked ? "1" : "0"); } catch (error) { console.warn("Не удалось сохранить фильтр цены:", error); } });
    $("hideNoStock").addEventListener("change", () => { try { localStorage.setItem(HIDE_NO_STOCK_STORAGE_KEY, $("hideNoStock").checked ? "1" : "0"); } catch (error) { console.warn("Не удалось сохранить фильтр остатков:", error); } });
    $("downloadStockReportBtn").addEventListener("click", () => void downloadStockReport());
    $("shareReport").addEventListener("click", () => void buildReport());
    $("exportData").addEventListener("click", async () => { try { const text = await exportSalesBackup(); await shareOrDownload(new Blob([text], { type: "application/json" }), `bonus-navigator-backup-${new Date().toISOString().slice(0, 10)}.json`, "Резервная копия продаж"); setStatus("Экспорт данных готов."); } catch (error) { setStatus(error.message, true); } });
    $("importData").addEventListener("click", () => $("importFile").click());
    $("importFile").addEventListener("change", async () => { const file = $("importFile").files?.[0]; if (!file) return; try { if (file.size > 10 * 1024 * 1024) throw new Error("Файл резервной копии больше 10 МБ."); const result = await importSalesBackup(await file.text()); sales = await getAllSales(); render(); const ignored = result.ignoredOutsideRetention ? ` Пропущено записей не за ${today.getFullYear()} год: ${result.ignoredOutsideRetention}.` : ""; setStatus(`Импортировано записей: ${result.imported}.${ignored}`); } catch (error) { setStatus(error.message, true); } finally { $("importFile").value = ""; } });
}

async function init() {
    try { sales = await getAllSales(); } catch (error) { console.error(error); setStatus("Локальное хранилище продаж недоступно.", true); }
    const userName = loadSavedUserName() || "Пользователь";
    $("dashboardUser").textContent = userName;
    $("dashboardAvatar").textContent = userInitials(userName);
    $("salesArticleSearch").value = normalizeCatalogSearchInput(readLocalValue(SALES_ARTICLE_FILTER_KEY));
    const savedDateFrom = readLocalValue(SALES_DATE_FROM_FILTER_KEY);
    const savedDateTo = readLocalValue(SALES_DATE_TO_FILTER_KEY);
    $("salesDateFrom").value = /^\d{4}-\d{2}-\d{2}$/.test(savedDateFrom) ? savedDateFrom : CURRENT_LOCAL_DATE;
    $("salesDateTo").value = /^\d{4}-\d{2}-\d{2}$/.test(savedDateTo) ? savedDateTo : CURRENT_LOCAL_DATE;
    for (const input of [$("salesDateFrom"), $("salesDateTo")]) {
        input.min = RETENTION_START_DATE;
        input.max = CURRENT_LOCAL_DATE;
    }
    if ($("salesDateFrom").value < RETENTION_START_DATE || $("salesDateFrom").value > CURRENT_LOCAL_DATE) $("salesDateFrom").value = CURRENT_LOCAL_DATE;
    if ($("salesDateTo").value < RETENTION_START_DATE || $("salesDateTo").value > CURRENT_LOCAL_DATE) $("salesDateTo").value = CURRENT_LOCAL_DATE;
    if ($("salesDateFrom").value && $("salesDateTo").value && $("salesDateFrom").value > $("salesDateTo").value) $("salesDateTo").value = $("salesDateFrom").value;
    writeLocalValue(SALES_DATE_FROM_FILTER_KEY, $("salesDateFrom").value);
    writeLocalValue(SALES_DATE_TO_FILTER_KEY, $("salesDateTo").value);
    try { $("hideZeroPrice").checked = localStorage.getItem(HIDE_ZERO_PRICE_STORAGE_KEY) === "1"; $("hideNoStock").checked = localStorage.getItem(HIDE_NO_STOCK_STORAGE_KEY) === "1"; } catch (error) { console.warn("Не удалось прочитать фильтры каталога:", error); }
    initThemeManager(); initReportPasswordModal(); bindEvents(); render();
    showPage(readLocalValue(DASHBOARD_PAGE_STORAGE_KEY));
    initVersionManager(); void initRegions();
}

void init();
