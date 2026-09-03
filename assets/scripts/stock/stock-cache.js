import { dom } from "../dom.js";
import { state } from "../state.js";
import { getSelectedCityContext, getSelectedRegionValue } from "../regions/regions.js";
import { formatStockUpdatedAt } from "./stock-api.js";

/**
 * Клиентский in-memory кеш остатков по региону (без обращений к серверу — см. stock-sync.js).
 */

/** Клиентский кеш больше не хранится на диске — источник истины сервер/SQLite, это заглушка для симметрии API. */
export function loadStockCache() {
    return { regions: {} };
}

/** Заглушка сохранения: кеш живёт только в памяти вкладки (сессионно). */
export function saveStockCache() {
    // Источник истины - сервер и SQLite. На клиенте держим только сессионный in-memory кеш.
}

/** Строит ключ кеша для пары регион+город. */
export function buildRegionCacheKey(regionName, cityId) {
    const safeRegion = String(regionName || "").trim();
    const safeCityId = String(cityId || "").trim();
    return `${safeRegion}::${safeCityId}`;
}

/** Возвращает запись кеша текущего выбранного региона/города (или null). */
export function getCurrentRegionEntry() {
    const regionName = getSelectedRegionValue();
    const cityId = String(dom.profileCity?.value || "").trim();
    if (!regionName || !cityId) {
        return null;
    }

    const key = buildRegionCacheKey(regionName, cityId);
    const entry = state.stockCache?.regions?.[key];
    if (!entry || typeof entry !== "object") {
        return null;
    }

    return entry;
}

/** Возвращает (создавая при необходимости) запись кеша для текущего региона/города. */
export function ensureCurrentRegionEntry() {
    const regionName = getSelectedRegionValue();
    const cityId = String(dom.profileCity?.value || "").trim();
    const cityName = getSelectedCityContext().cityName;

    if (!regionName || !cityId) {
        return null;
    }

    if (!state.stockCache || typeof state.stockCache !== "object") {
        state.stockCache = { regions: {} };
    }

    if (!state.stockCache.regions || typeof state.stockCache.regions !== "object") {
        state.stockCache.regions = {};
    }

    const key = buildRegionCacheKey(regionName, cityId);
    if (!state.stockCache.regions[key] || typeof state.stockCache.regions[key] !== "object") {
        state.stockCache.regions[key] = {
            regionName,
            cityId,
            cityName,
            updatedAt: 0,
            items: {},
        };
    }

    state.stockCache.regions[key].regionName = regionName;
    state.stockCache.regions[key].cityId = cityId;
    state.stockCache.regions[key].cityName = cityName;
    if (!state.stockCache.regions[key].items || typeof state.stockCache.regions[key].items !== "object") {
        state.stockCache.regions[key].items = {};
    }

    return state.stockCache.regions[key];
}

/** Возвращает кешированную запись об остатках по артикулу для текущего региона. */
export function getStockRecordByArticle(article) {
    const key = String(article || "").trim();
    if (!key) {
        return null;
    }

    const currentRegionEntry = getCurrentRegionEntry();
    const value = currentRegionEntry?.items?.[key];
    if (!value || typeof value !== "object") {
        return null;
    }

    return value;
}

/** Обновляет подпись "последнее обновление по региону" в личном кабинете. */
export function updateRegionUpdatedAtLabel() {
    if (!dom.profileRegionUpdatedAt) {
        return;
    }

    const entry = getCurrentRegionEntry();
    const text = entry?.updatedAt
        ? formatStockUpdatedAt(entry.updatedAt)
        : "-";
    dom.profileRegionUpdatedAt.textContent = `Последнее обновление по региону: ${text}`;
}

/** Возвращает сохранённый sync-токен региона (для дельта-синхронизации). */
export function getCurrentRegionSyncToken(regionName, cityId) {
    const key = buildRegionCacheKey(regionName, cityId);
    return Number(state.stockSyncTokens[key] || 0);
}

/** Сохраняет sync-токен региона, полученный от сервера. */
export function setCurrentRegionSyncToken(regionName, cityId, token) {
    const key = buildRegionCacheKey(regionName, cityId);
    const nextToken = Number(token);
    state.stockSyncTokens[key] = Number.isFinite(nextToken) && nextToken > 0 ? nextToken : 0;
}
