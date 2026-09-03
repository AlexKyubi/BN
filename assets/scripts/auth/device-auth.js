import { dom } from "../dom.js";
import { AUTH_STORAGE_KEY, AUTH_USER_NAME_KEY, SHEET_URL_STORAGE_KEY } from "../config.js";
import { escapeHtml, normalizeFullName } from "../utils.js";
import { getCurrentCityDisplay } from "../regions/regions.js";
import { clearAccessToken } from "./access-token.js";

/**
 * Авторизация на устройстве: хранение статуса входа, проверка формата ФИО, отображение имени пользователя.
 */

/** Проверяет, что на устройстве уже сохранён валидный вход (флаг + имя + ссылка на таблицу). */
export function isAuthorizedOnDevice() {
    try {
        return localStorage.getItem(AUTH_STORAGE_KEY) === "1"
            && Boolean(loadSavedUserName())
            && Boolean(getEffectiveSheetUrl());
    } catch (error) {
        console.warn("Не удалось прочитать статус авторизации:", error);
        return false;
    }
}

/** Сохраняет успешную авторизацию (имя пользователя + разрешённую ссылку таблицы). */
export function saveAuthorizationOnDevice(fullName, sheetUrl) {
    try {
        localStorage.setItem(AUTH_STORAGE_KEY, "1");
        localStorage.setItem(AUTH_USER_NAME_KEY, fullName);
        localStorage.setItem(SHEET_URL_STORAGE_KEY, sheetUrl);
    } catch (error) {
        console.warn("Не удалось сохранить статус авторизации:", error);
    }
}

/** Очищает сохранённую авторизацию (например, при отзыве доступа сервером). */
export function clearAuthorizationOnDevice() {
    try {
        localStorage.removeItem(AUTH_STORAGE_KEY);
        localStorage.removeItem(AUTH_USER_NAME_KEY);
        localStorage.removeItem(SHEET_URL_STORAGE_KEY);
    } catch (error) {
        console.warn("Не удалось очистить статус авторизации:", error);
    }
    clearAccessToken();
}

/** Читает сохранённую ссылку на таблицу пользователя. */
export function loadSavedSheetUrl() {
    try {
        return (localStorage.getItem(SHEET_URL_STORAGE_KEY) || "").trim();
    } catch (error) {
        console.warn("Не удалось прочитать ссылку таблицы:", error);
        return "";
    }
}

/** Возвращает действующую ссылку на таблицу — только ту, что уже подтверждена сервером и сохранена ранее. */
export function getEffectiveSheetUrl() {
    return loadSavedSheetUrl();
}

/** Читает сохранённое ФИО пользователя. */
export function loadSavedUserName() {
    try {
        return (localStorage.getItem(AUTH_USER_NAME_KEY) || "").trim();
    } catch (error) {
        console.warn("Не удалось прочитать имя пользователя:", error);
        return "";
    }
}

/** Проверяет, что строка соответствует формату "Фамилия Имя" (кириллица/латиница). */
export function isValidFullName(value) {
    const normalized = normalizeFullName(value);
    return /^[A-Za-zА-Яа-яЁёІіЇїЄєҚқҢңҒғҮүҰұӨөҺһ-]+\s+[A-Za-zА-Яа-яЁёІіЇїЄєҚқҢңҒғҮүҰұӨөҺһ-]+(?:\s+[A-Za-zА-Яа-яЁёІіЇїЄєҚқҢңҒғҮүҰұӨөҺһ-]+)*$/.test(normalized);
}

/** Проверяет логин локально (без сети): валидный формат ФИО. */
export function verifyCredentials(username) {
    if (!isValidFullName(username)) {
        return { ok: false, message: "Введите логин в формате: Фамилия Имя." };
    }

    return { ok: true, fullName: normalizeFullName(username) };
}

/** Отображает имя текущего пользователя (и город, если выбран) в шапке. */
export function renderCurrentUserName(fullName) {
    if (!dom.currentUser) {
        return;
    }

    const safeName = (fullName || "").trim();
    if (!safeName) {
        dom.currentUser.textContent = "";
        dom.currentUser.classList.add("hidden");
        return;
    }

    const city = getCurrentCityDisplay();
    if (city) {
        dom.currentUser.innerHTML = `${escapeHtml(safeName)}<br><span class="current-user-city">${escapeHtml(city)}</span>`;
    } else {
        dom.currentUser.textContent = `Пользователь: ${safeName}`;
    }
    dom.currentUser.title = "Открыть личный кабинет";
    dom.currentUser.setAttribute("role", "button");
    dom.currentUser.setAttribute("tabindex", "0");
    dom.currentUser.classList.remove("hidden");
}

/** Показывает модальное окно авторизации. */
export function showAuthModal() {
    if (!dom.authModal) {
        return;
    }

    document.body.classList.add("auth-locked");
    dom.authModal.classList.remove("hidden");
    if (dom.authLogin) {
        dom.authLogin.focus();
    }
}

/** Скрывает модальное окно авторизации. */
export function hideAuthModal() {
    if (!dom.authModal) {
        return;
    }

    dom.authModal.classList.add("hidden");
    document.body.classList.remove("auth-locked");
}

/** Очищает текст ошибки формы авторизации. */
export function clearAuthError() {
    if (dom.authError) {
        dom.authError.textContent = "";
    }
}

/** Показывает текст ошибки формы авторизации. */
export function setAuthError(message) {
    if (dom.authError) {
        dom.authError.textContent = message;
    }
}
