import { dom } from "../dom.js";
import { state } from "../state.js";
import { getSelectedCityContext, getSelectedRegionValue, saveProfileSelection } from "../regions/regions.js";
import { setProfileStatus } from "../profile/profile-status.js";
import { renderCards } from "../ui/grid.js";
import { getActiveMonthLabel } from "../ui/drawers.js";
import { askReportPassword } from "../ui/password-prompt.js";
import { downloadRegionStockReport, fetchRegionStockSnapshot, normalizeStockRecord } from "./stock-api.js";
import {
    ensureCurrentRegionEntry,
    getCurrentRegionSyncToken,
    saveStockCache,
    setCurrentRegionSyncToken,
    updateRegionUpdatedAtLabel,
} from "./stock-cache.js";

/**
 * Синхронизация остатков текущего региона с сервером (дельта/полная) и её вызов из UI.
 */

/**
 * Синхронизирует остатки текущего региона с сервером (полностью или дельтой) и обновляет UI.
 * options.forceFull — игнорировать sync-токен и запросить всё заново.
 * options.silent — не показывать промежуточные статусы в личном кабинете.
 */
export async function syncCurrentRegionStock(options = {}) {
    const region = getSelectedRegionValue();
    const { cityId } = getSelectedCityContext();

    if (!region || !cityId) {
        return;
    }

    const regionEntry = ensureCurrentRegionEntry();
    if (!regionEntry) {
        return;
    }

    const forceFull = Boolean(options?.forceFull);
    const silent = Boolean(options?.silent);
    const sinceToken = forceFull ? null : getCurrentRegionSyncToken(region, cityId);

    if (!silent) {
        setProfileStatus("Синхронизация с сервером...", "");
    }

    const payload = await fetchRegionStockSnapshot(cityId, sinceToken);
    const rows = Array.isArray(payload?.items) ? payload.items : [];
    rows.forEach((row) => {
        const article = String(row?.article || "").trim();
        if (!article) {
            return;
        }
        regionEntry.items[article] = normalizeStockRecord(row, regionEntry.cityName);
    });

    if (Number.isFinite(Number(payload?.syncToken))) {
        setCurrentRegionSyncToken(region, cityId, Number(payload.syncToken));
    }

    regionEntry.updatedAt = Date.now();
    saveStockCache();
    updateRegionUpdatedAtLabel();
    renderCards();

    if (!silent) {
        setProfileStatus("Данные региона синхронизированы с сервером.", "ok");
    }
}

/** Принудительно обновляет остатки всего каталога для выбранного региона (кнопка "Обновить"). */
export async function refreshStockForAllItems() {
    if (!state.items.length) {
        setProfileStatus("Товары ещё не загружены.", "error");
        return;
    }

    const region = getSelectedRegionValue();
    const { cityId } = getSelectedCityContext();

    if (!region) {
        setProfileStatus("Выберите регион.", "error");
        return;
    }

    if (!cityId) {
        setProfileStatus("Выберите магазин (город).", "error");
        return;
    }

    if (!dom.refreshStockBtn) {
        return;
    }

    saveProfileSelection(region, cityId);
    dom.refreshStockBtn.disabled = true;
    try {
        await syncCurrentRegionStock({ forceFull: true, silent: false });
    } catch (error) {
        console.warn("Ошибка синхронизации остатков:", error);
        setProfileStatus(`Ошибка синхронизации: ${error.message || error}`, "error");
    } finally {
        dom.refreshStockBtn.disabled = false;
    }
}

/** Запрашивает у сервера XLSX-отчёт по остаткам выбранного региона и скачивает его (кнопка "Загрузить остатки"). */
export async function downloadCurrentRegionStockReport() {
    const region = getSelectedRegionValue();
    const { cityId } = getSelectedCityContext();

    if (!region || !cityId) {
        setProfileStatus("Выберите регион и магазин.", "error");
        return;
    }

    if (!dom.downloadStockReportBtn) {
        return;
    }

    const password = await askReportPassword();
    if (password === null) {
        return;
    }

    saveProfileSelection(region, cityId);
    dom.downloadStockReportBtn.disabled = true;
    const previousTitle = dom.downloadStockReportBtn.title;
    dom.downloadStockReportBtn.title = "Формирование...";
    setProfileStatus("Формируем файл остатков...", "");

    try {
        await downloadRegionStockReport(cityId, {
            password,
            monthColumn: state.activeMonthColumn,
            monthLabel: getActiveMonthLabel(),
        });
        setProfileStatus("Файл остатков скачан.", "ok");
    } catch (error) {
        console.warn("Ошибка загрузки отчёта по остаткам:", error);
        setProfileStatus(`Не удалось сформировать отчёт: ${error.message || error}`, "error");
    } finally {
        dom.downloadStockReportBtn.disabled = false;
        dom.downloadStockReportBtn.title = previousTitle;
    }
}
