import { constants } from "./state.js";
import { escapeHtml } from "./utils.js";

export function buildStockUrl({ cityId, article, languageId, userId = "" }) {
    const configuredBase = String(constants.STOCK_CONFIG.proxyBase || constants.DEFAULT_PROXY_BASE).trim();
    const normalizedBase = configuredBase.endsWith("/") ? configuredBase.slice(0, -1) : configuredBase;
    const url = new URL(`${normalizedBase}${constants.STOCK_PATH}`, window.location.origin);
    url.searchParams.set("cityId", String(cityId));
    url.searchParams.set("article", String(article));
    url.searchParams.set("languageId", String(languageId));
    const safeUserId = String(userId || "").trim();
    if (safeUserId) {
        url.searchParams.set("userId", safeUserId);
    }
    return url.toString();
}

export async function parseResponseBody(response) {
    const text = await response.text();
    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch (error) {
        return { raw: text };
    }
}

export function normalizeStockRecord(payload, fallbackCityName = "") {
    const stores = Array.isArray(payload?.stores)
        ? payload.stores.map((store) => ({
            storageId: String(store?.storageId || "").trim(),
            address: String(store?.address || "").trim(),
            availability: String(store?.availability || "").trim(),
        }))
        : [];

    const countFromField = Number(payload?.count);
    const count = Number.isFinite(countFromField) ? countFromField : stores.length;
    const priceValue = Number(payload?.price);
    const price = Number.isFinite(priceValue) ? priceValue : null;

    const updatedAtValue = Number(payload?.updatedAt);
    const updatedAt = Number.isFinite(updatedAtValue) && updatedAtValue > 0
        ? (updatedAtValue > 1e12 ? updatedAtValue : updatedAtValue * 1000)
        : Date.now();

    return {
        price,
        count,
        stores,
        cityTitle: String(payload?.cityTitle || fallbackCityName || "").trim(),
        updatedAt,
        _serverMeta: payload?.meta && typeof payload.meta === "object" ? payload.meta : null,
    };
}

export async function fetchStockForArticle(cityId, cityName, article, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), constants.STOCK_FETCH_TIMEOUT_MS);

    const requestUrl = buildStockUrl({
        cityId,
        article,
        languageId: constants.LANGUAGE_ID,
        userId: options?.userId || "",
    });
    let response;
    try {
        response = await fetch(requestUrl, {
            method: "GET",
            headers: { Accept: "application/json" },
            signal: controller.signal,
        });
    } catch (error) {
        if (error && error.name === "AbortError") {
            throw new Error(`timeout_${constants.STOCK_FETCH_TIMEOUT_MS}ms`);
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }

    const payload = await parseResponseBody(response);
    if (!response.ok) {
        const message = payload?.error || payload?.message || `HTTP ${response.status}`;
        throw new Error(String(message));
    }

    return normalizeStockRecord(payload, cityName);
}

export function formatMoneyKzt(value) {
    if (!Number.isFinite(Number(value))) {
        return "-";
    }

    return `${Number(value).toLocaleString("ru-RU")} KZT`;
}

export function formatStockUpdatedAt(timestamp) {
    if (!Number.isFinite(Number(timestamp))) {
        return "-";
    }

    return new Date(Number(timestamp)).toLocaleString("ru-RU");
}

export function createStoreInfoHtml(stores) {
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
