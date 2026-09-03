import { dom } from "../dom.js";

/**
 * Строка статуса личного кабинета (используется несколькими независимыми модулями).
 */

/** Показывает сообщение статуса в личном кабинете (tone: "ok" | "error" | ""). */
export function setProfileStatus(message, tone = "") {
    if (!dom.profileStatus) {
        return;
    }

    dom.profileStatus.textContent = message || "";
    dom.profileStatus.classList.remove("ok", "error");
    if (tone) {
        dom.profileStatus.classList.add(tone);
    }
}
