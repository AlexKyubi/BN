import { DEFAULT_THEME_HUE, THEME_HUE_STORAGE_KEY } from "../config.js";

function normalizeHue(value) {
    if (value === null || value === undefined || String(value).trim() === "") {
        return DEFAULT_THEME_HUE;
    }
    const hue = Math.round(Number(value));
    return Number.isFinite(hue) ? Math.min(360, Math.max(0, hue)) : DEFAULT_THEME_HUE;
}

function loadHue() {
    try {
        return normalizeHue(localStorage.getItem(THEME_HUE_STORAGE_KEY));
    } catch (error) {
        console.warn("Не удалось прочитать цвет оформления:", error);
        return DEFAULT_THEME_HUE;
    }
}

function applyHue(hue) {
    const normalized = normalizeHue(hue);
    document.documentElement.style.setProperty("--accent-hue", String(normalized));
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", `hsl(${normalized} 100% 59%)`);
    return normalized;
}

function saveHue(hue) {
    try {
        localStorage.setItem(THEME_HUE_STORAGE_KEY, String(hue));
    } catch (error) {
        console.warn("Не удалось сохранить цвет оформления:", error);
    }
}

/** Применяет сохранённый акцент и подключает слайдер, если он есть на странице. */
export function initThemeManager() {
    const currentHue = applyHue(loadHue());
    const slider = document.getElementById("themeHue");
    const preview = document.getElementById("themeColorPreview");
    if (!slider) return;

    slider.value = String(currentHue);
    if (preview) preview.style.background = `hsl(${currentHue} 100% 59%)`;

    slider.addEventListener("input", () => {
        const hue = applyHue(slider.value);
        if (preview) preview.style.background = `hsl(${hue} 100% 59%)`;
        saveHue(hue);
    });
}
