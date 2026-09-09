import { loadSavedUserName } from "../auth/device-auth.js";
import { state } from "../state.js";
import { ACTIVE_MONTH_INDEX_STORAGE_KEY, ACTIVE_MONTH_LABEL_STORAGE_KEY, HIDE_NO_STOCK_STORAGE_KEY, HIDE_ZERO_PRICE_STORAGE_KEY } from "../config.js";
import { buildRegionCityModel, fillProfileRegionSelect, getSelectedCityContext, loadProfileSelection, loadRegionRows, saveProfileSelection, syncProfileCitySelect } from "../regions/regions.js";
import { downloadRegionStockReport } from "../stock/stock-api.js";
import { askReportPassword, initReportPasswordModal } from "../ui/password-prompt.js";
import { createSalesWorkbook } from "./xlsx-report.js";
import { downloadBlob, shareOrDownload } from "./file-share.js";
import { exportSalesBackup, getAllSales, importSalesBackup, saveSale } from "./sales-store.js";
import { initVersionManager } from "../update/version-manager.js";

const $ = (id) => document.getElementById(id);
const money = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const monthFormatter = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" });
const monthShortFormatter = new Intl.DateTimeFormat("ru-RU", { month: "long" });
let sales = [];
const today = new Date();
let selectedMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

function formatMoney(value) { return `${money.format(Number(value) || 0)} ₸`; }
function monthDate(key) { const [year, month] = key.split("-").map(Number); return new Date(year, month - 1, 1); }
function shiftMonth(delta) { const date = monthDate(selectedMonth); date.setMonth(date.getMonth() + delta); selectedMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; render(); }
function activeSales(month = selectedMonth) { return sales.filter((sale) => sale.month === month && !sale.returned); }
function escapeText(value) { return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function setStatus(message, error = false) { const node = $("dashboardStatus"); if (node) { node.textContent = message; node.style.color = error ? "#ff8f8f" : "#8ff0b0"; } }

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
    const query = ($("salesSearch")?.value || "").trim().toLowerCase();
    const visible = sales.filter((sale) => !query || sale.article.toLowerCase().includes(query) || sale.title.toLowerCase().includes(query) || new Date(sale.soldAt).toLocaleDateString("ru-RU").includes(query)).sort((a, b) => Date.parse(b.soldAt) - Date.parse(a.soldAt));
    $("allSales").innerHTML = visible.length ? visible.map(saleMarkup).join("") : `<p class="panel-subtitle" style="padding:18px 0">Продажи не найдены.</p>`;
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
    $("monthShortTitle").textContent = monthShortFormatter.format(monthDate(selectedMonth));
    $("commissionTotal").textContent = formatMoney(commission);
    $("salesTotal").textContent = formatMoney(salesTotal);
    $("unitsTotal").textContent = money.format(units);
    $("operationsTotal").textContent = `${monthSales.length} операций`;
    $("averageCommission").textContent = formatMoney(units ? commission / units : 0);
    $("monthComparison").textContent = previousCommission ? `${commission >= previousCommission ? "↑" : "↓"} ${Math.abs(Math.round((commission - previousCommission) / previousCommission * 100))}% к прошлому месяцу` : "Нет данных для сравнения";
    renderChart(monthSales);
    renderCategories(monthSales);
    const recent = monthSales.sort((a, b) => Date.parse(b.soldAt) - Date.parse(a.soldAt)).slice(0, 5);
    $("recentSales").innerHTML = recent.length ? recent.map(saleMarkup).join("") : `<p class="panel-subtitle" style="padding:14px 0">В этом месяце продаж пока нет.</p>`;
    renderSalesList();
}

function showPage(name) {
    document.querySelector("body > .dashboard-shell")?.classList.toggle("hidden", name === "sales");
    $("salesPage").classList.toggle("hidden", name !== "sales");
    $("navOverview").classList.toggle("active", name !== "sales");
    $("navSales").classList.toggle("active", name === "sales");
    if (name === "sales") renderSalesList();
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function openEditor(id) {
    const sale = sales.find((item) => item.id === id);
    if (!sale) return;
    $("editSaleId").value = sale.id;
    $("editSaleDate").value = new Date(new Date(sale.soldAt).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    $("editSalePrice").value = sale.price;
    $("editSaleQuantity").value = sale.quantity;
    $("editSaleState").value = sale.returned ? "returned" : "sold";
    $("editSaleStatus").textContent = "";
    $("editSaleModal").classList.remove("hidden");
}

function closeEditor() { $("editSaleModal").classList.add("hidden"); }

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

async function buildReport(share) {
    try {
        const blob = createSalesWorkbook(sales, loadSavedUserName());
        const filename = `bonus-navigator-sales-${new Date().toISOString().slice(0, 10)}.xlsx`;
        if (share) await shareOrDownload(blob, filename, "Отчёт по продажам"); else downloadBlob(blob, filename);
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
    $("navCatalog").addEventListener("click", () => window.location.assign("index.html"));
    $("navOverview").addEventListener("click", () => showPage("overview"));
    $("navSales").addEventListener("click", () => showPage("sales"));
    $("openSalesList").addEventListener("click", () => showPage("sales"));
    $("closeSalesList").addEventListener("click", () => showPage("overview"));
    $("salesSearch").addEventListener("input", renderSalesList);
    for (const id of ["recentSales", "allSales"]) $(id).addEventListener("click", (event) => { const row = event.target.closest("[data-sale-id]"); if (row) openEditor(row.dataset.saleId); });
    $("closeEditSale").addEventListener("click", closeEditor); $("cancelEditSale").addEventListener("click", closeEditor); $("editSaleBackdrop").addEventListener("click", closeEditor);
    $("editSaleForm").addEventListener("submit", async (event) => { event.preventDefault(); const sale = sales.find((item) => item.id === $("editSaleId").value); if (!sale) return; try { await saveSale({ ...sale, soldAt: new Date($("editSaleDate").value).toISOString(), price: Number($("editSalePrice").value), quantity: Number($("editSaleQuantity").value), returned: $("editSaleState").value === "returned" }); sales = await getAllSales(); closeEditor(); render(); } catch (error) { $("editSaleStatus").textContent = error.message; } });
    $("profileRegion").addEventListener("change", () => { syncProfileCitySelect(); saveProfileSelection($("profileRegion").value, $("profileCity").value); });
    $("profileCity").addEventListener("change", () => saveProfileSelection($("profileRegion").value, $("profileCity").value));
    $("hideZeroPrice").addEventListener("change", () => { try { localStorage.setItem(HIDE_ZERO_PRICE_STORAGE_KEY, $("hideZeroPrice").checked ? "1" : "0"); } catch (error) { console.warn("Не удалось сохранить фильтр цены:", error); } });
    $("hideNoStock").addEventListener("change", () => { try { localStorage.setItem(HIDE_NO_STOCK_STORAGE_KEY, $("hideNoStock").checked ? "1" : "0"); } catch (error) { console.warn("Не удалось сохранить фильтр остатков:", error); } });
    $("downloadStockReportBtn").addEventListener("click", () => void downloadStockReport());
    $("shareReport").addEventListener("click", () => void buildReport(true)); $("downloadReport").addEventListener("click", () => void buildReport(false));
    $("exportData").addEventListener("click", async () => { try { const text = await exportSalesBackup(); await shareOrDownload(new Blob([text], { type: "application/json" }), `bonus-navigator-backup-${new Date().toISOString().slice(0, 10)}.json`, "Резервная копия продаж"); setStatus("Экспорт данных готов."); } catch (error) { setStatus(error.message, true); } });
    $("importData").addEventListener("click", () => $("importFile").click());
    $("importFile").addEventListener("change", async () => { const file = $("importFile").files?.[0]; if (!file) return; try { if (file.size > 10 * 1024 * 1024) throw new Error("Файл резервной копии больше 10 МБ."); const result = await importSalesBackup(await file.text()); sales = await getAllSales(); render(); setStatus(`Импортировано записей: ${result.imported}.`); } catch (error) { setStatus(error.message, true); } finally { $("importFile").value = ""; } });
}

async function init() {
    try { sales = await getAllSales(); } catch (error) { console.error(error); setStatus("Локальное хранилище продаж недоступно.", true); }
    $("dashboardUser").textContent = loadSavedUserName() || "Пользователь";
    try { $("hideZeroPrice").checked = localStorage.getItem(HIDE_ZERO_PRICE_STORAGE_KEY) === "1"; $("hideNoStock").checked = localStorage.getItem(HIDE_NO_STOCK_STORAGE_KEY) === "1"; } catch (error) { console.warn("Не удалось прочитать фильтры каталога:", error); }
    initReportPasswordModal(); bindEvents(); render(); initVersionManager(); void initRegions();
}

void init();
