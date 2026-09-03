import { AUTH_VALIDATE_PATH, AUTH_VALIDATE_TIMEOUT_MS, DEFAULT_PROXY_BASE, STOCK_CONFIG } from "../config.js";
import { normalizeGoogleSheetCsvUrl, parseResponseBody } from "../utils.js";
import { saveAccessToken } from "./access-token.js";

/**
 * Проверка ссылки Google Sheets на сервере: эталонная ссылка хранится только в server_config.json,
 * клиент её не знает и не хранит — иначе она была бы видна любому в исходном коде страницы.
 */

/** Строит URL эндпоинта /auth/validate с переданной ссылкой на таблицу. */
function buildAuthValidateUrl(sheetUrl) {
    const configuredBase = String(STOCK_CONFIG.proxyBase || DEFAULT_PROXY_BASE).trim();
    const normalizedBase = configuredBase.endsWith("/") ? configuredBase.slice(0, -1) : configuredBase;
    const url = new URL(`${normalizedBase}${AUTH_VALIDATE_PATH}`, window.location.origin);
    url.searchParams.set("sheetUrl", String(sheetUrl || "").trim());
    return url.toString();
}

/** Проверяет ссылку на Google Sheets через сервер (единственный источник истины — /auth/validate). */
export async function validateSheetUrlWithServer(sheetUrl) {
    const normalizedSheetUrl = normalizeGoogleSheetCsvUrl(sheetUrl);
    if (!normalizedSheetUrl) {
        return { ok: false, message: "Введите корректную ссылку Google Sheets." };
    }

    const controller = new AbortController();
    const timeoutId = AUTH_VALIDATE_TIMEOUT_MS > 0
        ? setTimeout(() => controller.abort(), AUTH_VALIDATE_TIMEOUT_MS)
        : null;
    const requestUrl = buildAuthValidateUrl(normalizedSheetUrl);

    let response;
    try {
        response = await fetch(requestUrl, {
            method: "GET",
            headers: { Accept: "application/json" },
            signal: timeoutId ? controller.signal : undefined,
        });
    } catch (error) {
        const timedOut = error && error.name === "AbortError";
        return {
            ok: false,
            message: timedOut
                ? "Сервер проверки не отвечает. Попробуйте позже."
                : "Сервер проверки недоступен. Проверьте подключение и попробуйте позже.",
        };
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }

    const payload = await parseResponseBody(response);
    if (!response.ok || payload?.authorized !== true) {
        return {
            ok: false,
            message: payload?.message || "Доступ запрещён: ссылка таблицы не совпадает с разрешённой.",
        };
    }

    // Токен доступа к данным выдаётся только здесь — без него остатки и отчёт недоступны.
    saveAccessToken(payload?.accessToken);

    return {
        ok: true,
        normalizedSheetUrl: String(payload?.normalizedSheetUrl || normalizedSheetUrl).trim(),
    };
}
