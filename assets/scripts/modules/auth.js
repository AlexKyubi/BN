import { constants } from "./state.js";
import {
    normalizeFullName,
} from "./utils.js";

export function isAuthorizedOnDevice(state, dom) {
    try {
        return localStorage.getItem(constants.AUTH_STORAGE_KEY) === "1"
            && Boolean(loadSavedUserName())
            && Boolean(getEffectiveSheetUrl());
    } catch (error) {
        console.warn("Не удалось прочитать статус авторизации:", error);
        return false;
    }
}

export function saveAuthorizationOnDevice(fullName, sheetUrl) {
    try {
        localStorage.setItem(constants.AUTH_STORAGE_KEY, "1");
        localStorage.setItem(constants.AUTH_USER_NAME_KEY, fullName);
        localStorage.setItem(constants.SHEET_URL_STORAGE_KEY, sheetUrl);
    } catch (error) {
        console.warn("Не удалось сохранить статус авторизации:", error);
    }
}

export function loadSavedSheetUrl() {
    try {
        return (localStorage.getItem(constants.SHEET_URL_STORAGE_KEY) || "").trim();
    } catch (error) {
        console.warn("Не удалось прочитать ссылку таблицы:", error);
        return "";
    }
}

export function getEffectiveSheetUrl() {
    const saved = loadSavedSheetUrl();
    if (saved) {
        return saved;
    }
    return constants.GOOGLE_SHEET_URL;
}

export function loadSavedUserName() {
    try {
        return (localStorage.getItem(constants.AUTH_USER_NAME_KEY) || "").trim();
    } catch (error) {
        console.warn("Не удалось прочитать имя пользователя:", error);
        return "";
    }
}

export function isValidFullName(value) {
    const normalized = normalizeFullName(value);
    return /^[A-Za-zА-Яа-яЁёІіЇїЄєҚқҢңҒғҮүҰұӨөҺһ-]+\s+[A-Za-zА-Яа-яЁёІіЇїЄєҚқҢңҒғҮуҰұӨөҺһ-]+(?:\s+[A-Za-zА-Яа-яЁёІіЇїЄєҚқҢңҒғҮүҰұӨөҺһ-]+)*$/.test(normalized);
}

export function verifyCredentials(username) {
    if (!isValidFullName(username)) {
        return { ok: false, message: "Введите логин в формате: Фамилия Имя." };
    }

    return { ok: true, fullName: normalizeFullName(username) };
}

export function normalizeGoogleSheetCsvUrl(value) {
    const input = String(value || "").trim();
    if (!input) {
        return "";
    }

    let url;
    try {
        url = new URL(input);
    } catch (error) {
        return "";
    }

    if (url.protocol !== "https:" || url.hostname !== "docs.google.com") {
        return "";
    }

    const match = url.pathname.match(/^\/spreadsheets\/d\/([^/]+)\//i);
    if (!match || !match[1]) {
        return "";
    }

    const sheetId = match[1];
    const hashGidMatch = (url.hash || "").match(/gid=(\d+)/i);
    const gid = (url.searchParams.get("gid") || (hashGidMatch ? hashGidMatch[1] : "")).trim();
    const gidPart = /^\d+$/.test(gid) ? `&gid=${gid}` : "";

    return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv${gidPart}`;
}

export function isValidGoogleSheetCsvUrl(value) {
    return Boolean(normalizeGoogleSheetCsvUrl(value));
}
