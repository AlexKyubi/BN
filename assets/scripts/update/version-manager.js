import { dom } from "../dom.js";
import {
    ACKNOWLEDGED_BACKEND_VERSION_KEY,
    APP_CACHE_PREFIX,
    FRONTEND_VERSION,
    HEALTH_PATH,
    PENDING_BACKEND_VERSION_KEY,
    STOCK_CONFIG,
    VERSION_CHECK_TIMEOUT_MS,
} from "../config.js";

const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const pageVersion = document.querySelector('meta[name="bn-frontend-version"]')?.content || "";
const RUNNING_FRONTEND_VERSION = VERSION_PATTERN.test(pageVersion) ? pageVersion : FRONTEND_VERSION;

let latestRelease = null;
let checkPromise = null;
let initialized = false;

function readStorage(storage, key) {
    try {
        return storage?.getItem(key) || "";
    } catch (error) {
        console.warn(`Не удалось прочитать ${key}:`, error);
        return "";
    }
}

function writeStorage(storage, key, value) {
    try {
        storage?.setItem(key, value);
        return true;
    } catch (error) {
        console.warn(`Не удалось сохранить ${key}:`, error);
        return false;
    }
}

function removeStorage(storage, key) {
    try {
        storage?.removeItem(key);
    } catch (error) {
        console.warn(`Не удалось удалить ${key}:`, error);
    }
}

function normalizeRelease(payload) {
    const release = payload?.release;
    if (!release || typeof release !== "object") {
        return null;
    }

    const normalized = {};
    for (const key of ["id", "frontend", "backend"]) {
        if (typeof release[key] !== "string" || !VERSION_PATTERN.test(release[key])) {
            return null;
        }
        normalized[key] = release[key];
    }
    return normalized;
}

function setStatus(message, tone = "") {
    if (!dom.appUpdateStatus) {
        return;
    }
    dom.appUpdateStatus.textContent = message;
    dom.appUpdateStatus.classList.toggle("error", tone === "error");
}

function setButtonVisible(visible) {
    if (dom.updateAppBtn) {
        dom.updateAppBtn.classList.toggle("hidden", !visible);
    }
}

function renderRelease(release, updateAvailable) {
    if (dom.appVersionStatus) {
        dom.appVersionStatus.textContent = release
            ? `Фронт ${RUNNING_FRONTEND_VERSION} · Backend ${release.backend}`
            : `Фронт ${RUNNING_FRONTEND_VERSION}`;
    }
    setButtonVisible(updateAvailable);
    setStatus(updateAvailable ? "Доступна новая версия приложения." : "Установлена актуальная версия.");
}

function consumePendingBackendVersion() {
    const pending = readStorage(sessionStorage, PENDING_BACKEND_VERSION_KEY);
    if (!VERSION_PATTERN.test(pending)) {
        if (pending) {
            removeStorage(sessionStorage, PENDING_BACKEND_VERSION_KEY);
        }
        return;
    }
    if (writeStorage(localStorage, ACKNOWLEDGED_BACKEND_VERSION_KEY, pending)) {
        removeStorage(sessionStorage, PENDING_BACKEND_VERSION_KEY);
    }
}

async function fetchRelease() {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeoutId = controller
        ? setTimeout(() => controller.abort(), VERSION_CHECK_TIMEOUT_MS)
        : null;

    try {
        const url = new URL(HEALTH_PATH, STOCK_CONFIG.proxyBase);
        url.searchParams.set("_", Date.now().toString());
        const response = await fetch(url, {
            cache: "no-store",
            headers: { Accept: "application/json" },
            signal: controller?.signal,
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const release = normalizeRelease(await response.json());
        if (!release) {
            throw new Error("Некорректный формат версии");
        }
        return release;
    } finally {
        if (timeoutId !== null) {
            clearTimeout(timeoutId);
        }
    }
}

async function performVersionCheck() {
    try {
        const release = await fetchRelease();
        latestRelease = release;

        let acknowledgedBackend = readStorage(localStorage, ACKNOWLEDGED_BACKEND_VERSION_KEY);
        if (!VERSION_PATTERN.test(acknowledgedBackend)) {
            acknowledgedBackend = "";
        }

        // Первый корректный ответ становится базовой backend-версией и не тревожит пользователя.
        if (!acknowledgedBackend) {
            writeStorage(localStorage, ACKNOWLEDGED_BACKEND_VERSION_KEY, release.backend);
            acknowledgedBackend = release.backend;
        }

        const updateAvailable = release.frontend !== RUNNING_FRONTEND_VERSION
            || release.backend !== acknowledgedBackend;
        renderRelease(release, updateAvailable);
        return updateAvailable;
    } catch (error) {
        console.warn("Проверка версии недоступна:", error);
        if (!latestRelease) {
            if (dom.appVersionStatus) {
                dom.appVersionStatus.textContent = `Фронт ${RUNNING_FRONTEND_VERSION}`;
            }
            setStatus("Не удалось проверить обновления.", "error");
        }
        return false;
    }
}

/** Проверяет версию; одновременные вызовы используют один сетевой запрос. */
export async function checkForUpdates() {
    if (checkPromise) {
        return checkPromise;
    }
    checkPromise = performVersionCheck();
    try {
        return await checkPromise;
    } finally {
        checkPromise = null;
    }
}

async function clearApplicationCaches() {
    if (!("caches" in window)) {
        return;
    }
    const names = await caches.keys();
    await Promise.all(names
        .filter((name) => name.startsWith(APP_CACHE_PREFIX))
        .map((name) => caches.delete(name)));
}

async function requestServiceWorkerUpdate() {
    if (!("serviceWorker" in navigator)) {
        return;
    }
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration) {
        await registration.update();
    }
}

async function applyAvailableUpdate() {
    if (!latestRelease) {
        await checkForUpdates();
    }
    if (!latestRelease) {
        setStatus("Не удалось получить информацию об обновлении.", "error");
        return;
    }

    if (dom.updateAppBtn) {
        dom.updateAppBtn.disabled = true;
    }
    setStatus("Обновляем приложение…");

    // Авторизация хранится в localStorage и намеренно не удаляется.
    writeStorage(sessionStorage, PENDING_BACKEND_VERSION_KEY, latestRelease.backend);

    const maintenanceResults = await Promise.allSettled([
        clearApplicationCaches(),
        requestServiceWorkerUpdate(),
    ]);
    for (const result of maintenanceResults) {
        if (result.status === "rejected") {
            console.warn("Необязательный этап обновления не выполнен:", result.reason);
        }
    }

    try {
        const url = new URL(window.location.href);
        url.searchParams.set("release", latestRelease.id);
        window.location.replace(url.toString());
    } catch (error) {
        console.error("Не удалось перезагрузить приложение:", error);
        setStatus("Не удалось обновить страницу. Попробуйте ещё раз.", "error");
        if (dom.updateAppBtn) {
            dom.updateAppBtn.disabled = false;
        }
    }
}

/** Выполняет безопасную однократную проверку версии при загрузке приложения. */
export function initVersionManager() {
    if (initialized) {
        return;
    }
    initialized = true;
    consumePendingBackendVersion();
    if (dom.appVersionStatus) {
        dom.appVersionStatus.textContent = `Фронт ${RUNNING_FRONTEND_VERSION}`;
    }
    setButtonVisible(false);
    setStatus("Проверяем обновления…");

    dom.updateAppBtn?.addEventListener("click", () => {
        void applyAvailableUpdate();
    });

    // Ровно одна автоматическая проверка при каждой загрузке/перезагрузке страницы.
    void checkForUpdates();
}
