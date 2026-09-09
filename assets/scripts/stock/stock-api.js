import { DEFAULT_PROXY_BASE, LANGUAGE_ID, REGIONS_PATH, REGION_STOCK_PATH, REGION_STOCK_REPORT_PATH, REGION_SYNC_TIMEOUT_MS, STOCK_CONFIG, STOCK_FETCH_TIMEOUT_MS, STOCK_PATH } from "../config.js";
import { parseResponseBody } from "../utils.js";
import { clearAccessToken, loadAccessToken } from "../auth/access-token.js";

/**
 * Сетевой клиент прокси-сервера остатков: запросы карточки товара и снапшота по региону.
 */

/** Собирает заголовки запроса вместе с токеном доступа. */
function buildRequestHeaders(extra = {}) {
    return {
        Accept: "application/json",
        "X-Access-Token": loadAccessToken(),
        ...extra,
    };
}

/** Бросает ошибку по неуспешному ответу; при просроченном токене сбрасывает его, чтобы следующая загрузка перевыпустила его. */
function throwResponseError(response, payload) {
    if (response.status === 401 && payload?.error === "invalid_token") {
        clearAccessToken();
        throw new Error("Сессия истекла. Обновите страницу и войдите заново.");
    }

    const message = payload?.message || payload?.error || `HTTP ${response.status}`;
    throw new Error(String(message));
}

/** Строит URL запроса остатков по одному артикулу. */
function buildStockUrl({ cityId, article, languageId }) {
    const configuredBase = String(STOCK_CONFIG.proxyBase || DEFAULT_PROXY_BASE).trim();
    const normalizedBase = configuredBase.endsWith("/") ? configuredBase.slice(0, -1) : configuredBase;
    const url = new URL(`${normalizedBase}${STOCK_PATH}`, window.location.origin);
    url.searchParams.set("cityId", String(cityId));
    url.searchParams.set("article", String(article));
    url.searchParams.set("languageId", String(languageId));
    return url.toString();
}

/** Строит URL запроса снапшота остатков по всему региону (с поддержкой дельты через since). */
function buildRegionStockUrl({ cityId, languageId, sinceToken = null }) {
    const configuredBase = String(STOCK_CONFIG.proxyBase || DEFAULT_PROXY_BASE).trim();
    const normalizedBase = configuredBase.endsWith("/") ? configuredBase.slice(0, -1) : configuredBase;
    const url = new URL(`${normalizedBase}${REGION_STOCK_PATH}`, window.location.origin);
    url.searchParams.set("cityId", String(cityId));
    url.searchParams.set("languageId", String(languageId));
    if (Number.isFinite(Number(sinceToken)) && Number(sinceToken) > 0) {
        url.searchParams.set("since", String(Number(sinceToken)));
    }
    return url.toString();
}

/** Приводит сырой ответ сервера к внутреннему формату записи об остатках. */
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
        photoUrl: String(payload?.photoUrl || "").trim(),
        updatedAt,
    };
}

/** Запрашивает справочник регионов/городов у сервера (только для авторизованных клиентов). */
export async function fetchRegions() {
    const configuredBase = String(STOCK_CONFIG.proxyBase || DEFAULT_PROXY_BASE).trim();
    const normalizedBase = configuredBase.endsWith("/") ? configuredBase.slice(0, -1) : configuredBase;
    const url = new URL(`${normalizedBase}${REGIONS_PATH}`, window.location.origin);

    const response = await fetch(url.toString(), { method: "GET", headers: buildRequestHeaders() });
    const payload = await parseResponseBody(response);
    if (!response.ok) {
        throwResponseError(response, payload);
    }

    return Array.isArray(payload?.regions) ? payload.regions : [];
}

/** Запрашивает остатки по одному артикулу в выбранном городе. */
export async function fetchStockForArticle(cityId, cityName, article) {
    const controller = new AbortController();
    const timeoutId = STOCK_FETCH_TIMEOUT_MS > 0
        ? setTimeout(() => controller.abort(), STOCK_FETCH_TIMEOUT_MS)
        : null;

    const requestUrl = buildStockUrl({
        cityId,
        article,
        languageId: LANGUAGE_ID,
    });

    let response;
    try {
        response = await fetch(requestUrl, {
            method: "GET",
            headers: buildRequestHeaders(),
            signal: timeoutId ? controller.signal : undefined,
        });
    } catch (error) {
        if (error && error.name === "AbortError") {
            throw new Error(`timeout_${STOCK_FETCH_TIMEOUT_MS}ms`);
        }
        throw error;
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }

    const payload = await parseResponseBody(response);
    if (!response.ok) {
        throwResponseError(response, payload);
    }

    return normalizeStockRecord(payload, cityName);
}

/** Запрашивает снапшот остатков по всему региону (полный или дельту с since). */
export async function fetchRegionStockSnapshot(cityId, sinceToken = null) {
    const controller = new AbortController();
    const timeoutId = REGION_SYNC_TIMEOUT_MS > 0
        ? setTimeout(() => controller.abort(), REGION_SYNC_TIMEOUT_MS)
        : null;
    const requestUrl = buildRegionStockUrl({ cityId, languageId: LANGUAGE_ID, sinceToken });

    let response;
    try {
        response = await fetch(requestUrl, {
            method: "GET",
            headers: buildRequestHeaders(),
            signal: timeoutId ? controller.signal : undefined,
        });
    } catch (error) {
        if (error && error.name === "AbortError") {
            throw new Error(`timeout_${REGION_SYNC_TIMEOUT_MS}ms`);
        }
        throw error;
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }

    const payload = await parseResponseBody(response);
    if (!response.ok) {
        throwResponseError(response, payload);
    }

    return payload;
}

/** Форматирует цену в тенге для отображения (или "-", если значение некорректно). */
export function formatMoneyKzt(value) {
    if (!Number.isFinite(Number(value))) {
        return "-";
    }

    return `${Number(value).toLocaleString("ru-RU")} KZT`;
}

/** Форматирует дату последнего обновления остатков для отображения. */
export function formatStockUpdatedAt(timestamp) {
    if (!Number.isFinite(Number(timestamp))) {
        return "-";
    }

    return new Date(Number(timestamp)).toLocaleString("ru-RU");
}

/** Извлекает имя файла из заголовка Content-Disposition ответа сервера. */
function extractFilenameFromContentDisposition(headerValue, fallback) {
    const raw = String(headerValue || "");
    const utf8Match = raw.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match) {
        try {
            return decodeURIComponent(utf8Match[1]);
        } catch (error) {
            // игнорируем некорректный процент-энкодинг и падаем на запасной вариант ниже
        }
    }

    const asciiMatch = raw.match(/filename="?([^";]+)"?/i);
    return asciiMatch ? asciiMatch[1] : fallback;
}

/** Запрашивает у сервера XLSX-отчёт по остаткам региона и инициирует скачивание файла в браузере. */
export async function downloadRegionStockReport(cityId, { password = "", monthColumn = -1, monthLabel = "" } = {}) {
    const configuredBase = String(STOCK_CONFIG.proxyBase || DEFAULT_PROXY_BASE).trim();
    const normalizedBase = configuredBase.endsWith("/") ? configuredBase.slice(0, -1) : configuredBase;
    const url = new URL(`${normalizedBase}${REGION_STOCK_REPORT_PATH}`, window.location.origin);
    url.searchParams.set("cityId", String(cityId));
    url.searchParams.set("languageId", String(LANGUAGE_ID));
    url.searchParams.set("monthColumn", String(monthColumn));
    if (monthLabel) {
        url.searchParams.set("monthLabel", String(monthLabel));
    }

    const response = await fetch(url.toString(), {
        method: "GET",
        headers: buildRequestHeaders({
            Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            // Пароль проверяется только на сервере и нигде не сохраняется на клиенте.
            "X-Report-Password": String(password || ""),
        }),
    });

    if (!response.ok) {
        const payload = await parseResponseBody(response);
        throwResponseError(response, payload);
    }

    const blob = await response.blob();
    const now = new Date();
    const localDate = [now.getDate(), now.getMonth() + 1, now.getFullYear() % 100]
        .map((part) => String(part).padStart(2, "0"))
        .join("-");
    const filename = extractFilenameFromContentDisposition(
        response.headers.get("Content-Disposition"),
        `report ${localDate}.xlsx`
    );

    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    // Safari/WebView могут начать чтение blob уже после обработки click.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
