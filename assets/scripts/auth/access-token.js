import { ACCESS_TOKEN_STORAGE_KEY } from "../config.js";

/**
 * Хранение токена доступа к данным. Вынесено отдельно от device-auth.js, чтобы сетевой слой
 * мог читать токен, не завися от UI-модулей (иначе получается цикл импортов).
 */

/** Сохраняет выданный сервером токен доступа к данным. */
export function saveAccessToken(token) {
    try {
        const normalized = String(token || "").trim();
        if (normalized) {
            localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, normalized);
        }
    } catch (error) {
        console.warn("Не удалось сохранить токен доступа:", error);
    }
}

/** Читает сохранённый токен доступа. */
export function loadAccessToken() {
    try {
        return (localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY) || "").trim();
    } catch (error) {
        console.warn("Не удалось прочитать токен доступа:", error);
        return "";
    }
}

/** Удаляет токен доступа (например, когда сервер ответил, что он просрочен). */
export function clearAccessToken() {
    try {
        localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
    } catch (error) {
        console.warn("Не удалось очистить токен доступа:", error);
    }
}
