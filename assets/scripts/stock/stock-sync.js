import { getSelectedCityContext, getSelectedRegionValue } from "../regions/regions.js";
import { setProfileStatus } from "../profile/profile-status.js";
import { renderCards } from "../ui/grid.js";
import { fetchRegionStockSnapshot, normalizeStockRecord } from "./stock-api.js";
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
 * options.render — перерисовать карточки после синхронизации (по умолчанию true).
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
    if (options?.render !== false) {
        renderCards();
    }

    if (!silent) {
        setProfileStatus("Данные региона синхронизированы с сервером.", "ok");
    }
}
