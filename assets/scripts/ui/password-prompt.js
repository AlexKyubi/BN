import { dom } from "../dom.js";

/**
 * Модальное окно запроса пароля отчёта (замена window.prompt, который поддерживается не везде).
 */

let activeResolve = null;

/** Закрывает окно и возвращает результат ожидающему вызову. */
function closeWithResult(value) {
    if (!dom.reportPasswordModal) {
        return;
    }

    dom.reportPasswordModal.classList.add("hidden");
    if (dom.reportPasswordInput) {
        dom.reportPasswordInput.value = "";
    }

    const resolve = activeResolve;
    activeResolve = null;
    if (resolve) {
        resolve(value);
    }
}

/** Подключает обработчики окна пароля (вызывается один раз при старте приложения). */
export function initReportPasswordModal() {
    if (!dom.reportPasswordModal) {
        return;
    }

    dom.reportPasswordForm?.addEventListener("submit", (event) => {
        event.preventDefault();
        const value = (dom.reportPasswordInput?.value || "").trim();
        if (!value) {
            setReportPasswordError("Введите пароль.");
            return;
        }
        closeWithResult(value);
    });

    dom.cancelReportPasswordBtn?.addEventListener("click", () => closeWithResult(null));
    dom.closeReportPasswordModal?.addEventListener("click", () => closeWithResult(null));
    dom.reportPasswordBackdrop?.addEventListener("click", () => closeWithResult(null));

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !dom.reportPasswordModal.classList.contains("hidden")) {
            closeWithResult(null);
        }
    });
}

/** Показывает текст ошибки в окне пароля. */
export function setReportPasswordError(message) {
    if (dom.reportPasswordError) {
        dom.reportPasswordError.textContent = message || "";
    }
}

/** Показывает окно и ждёт ввода пароля; возвращает null, если пользователь отменил. */
export function askReportPassword() {
    if (!dom.reportPasswordModal) {
        return Promise.resolve(null);
    }

    setReportPasswordError("");
    dom.reportPasswordModal.classList.remove("hidden");
    dom.reportPasswordInput?.focus();

    return new Promise((resolve) => {
        activeResolve = resolve;
    });
}
