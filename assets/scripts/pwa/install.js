import { dom } from "../dom.js";

/**
 * Установка PWA: кнопка "Установить" и обработка событий beforeinstallprompt/appinstalled.
 */

let deferredPrompt = null;
let installPromptInFlight = false;

/** Показывает кнопку установки приложения. */
function showInstallButton() {
    if (dom.installBtn) {
        dom.installBtn.classList.remove("hidden");
    }
}

/** Скрывает кнопку установки приложения. */
function hideInstallButton() {
    if (dom.installBtn) {
        dom.installBtn.classList.add("hidden");
    }
}

/** Показывает системный диалог установки PWA (после клика на кнопку "Установить"). */
async function triggerInstallPrompt() {
    if (!deferredPrompt || installPromptInFlight) {
        console.warn("Системный install prompt сейчас недоступен");
        hideInstallButton();
        return;
    }

    installPromptInFlight = true;
    dom.installBtn?.setAttribute("disabled", "disabled");

    try {
        await deferredPrompt.prompt();
        await deferredPrompt.userChoice;
    } catch (error) {
        console.error("Ошибка показа install prompt:", error);
    } finally {
        deferredPrompt = null;
        installPromptInFlight = false;
        dom.installBtn?.removeAttribute("disabled");
        hideInstallButton();
    }
}

/** Подписывается на события установки PWA и включает кнопку "Установить". */
export function initPwaInstall() {
    window.addEventListener("beforeinstallprompt", (e) => {
        e.preventDefault();
        deferredPrompt = e;
        showInstallButton();
    });

    if (dom.installBtn) {
        dom.installBtn.addEventListener("click", () => {
            triggerInstallPrompt();
        });
    }

    window.addEventListener("appinstalled", () => {
        deferredPrompt = null;
        hideInstallButton();
    });
}
