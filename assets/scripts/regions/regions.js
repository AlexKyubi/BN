import { dom } from "../dom.js";
import { state } from "../state.js";
import { PROFILE_CITY_STORAGE_KEY, PROFILE_REGION_STORAGE_KEY } from "../config.js";
import { escapeHtml } from "../utils.js";
import { fetchRegions } from "../stock/stock-api.js";

/**
 * Справочник регионов/городов: загрузка, построение модели, заполнение селектов профиля.
 */

/** Сохранённый выбор региона/города пользователя (localStorage). */
export function loadProfileSelection() {
    try {
        return {
            region: (localStorage.getItem(PROFILE_REGION_STORAGE_KEY) || "").trim(),
            cityId: (localStorage.getItem(PROFILE_CITY_STORAGE_KEY) || "").trim(),
        };
    } catch (error) {
        console.warn("Не удалось прочитать настройки кабинета:", error);
        return { region: "", cityId: "" };
    }
}

/** Сохраняет выбор региона/города пользователя. */
export function saveProfileSelection(region, cityId) {
    try {
        localStorage.setItem(PROFILE_REGION_STORAGE_KEY, String(region || "").trim());
        localStorage.setItem(PROFILE_CITY_STORAGE_KEY, String(cityId || "").trim());
    } catch (error) {
        console.warn("Не удалось сохранить настройки кабинета:", error);
    }
}

/** Загружает с сервера и валидирует список регионов/городов. */
export async function loadRegionRows() {
    const rows = await fetchRegions();

    const normalized = rows
        .map((item) => ({
            id: Number(item?.id),
            city: String(item?.city || "").trim(),
            region: String(item?.region || "").trim(),
        }))
        .filter((item) => Number.isFinite(item.id) && item.id > 0 && item.city);

    if (!normalized.length) {
        throw new Error("Сервер вернул пустой список регионов.");
    }

    return normalized;
}

/** Группирует плоский список городов по региону (с сортировкой по алфавиту). */
export function buildRegionCityModel(rows) {
    const byRegion = new Map();

    rows.forEach((item) => {
        const regionName = item.region || "Регион не указан";
        if (!byRegion.has(regionName)) {
            byRegion.set(regionName, []);
        }
        byRegion.get(regionName).push(item);
    });

    for (const cities of byRegion.values()) {
        cities.sort((a, b) => String(a.city || "").localeCompare(String(b.city || ""), "ru"));
    }

    const regionNames = [...byRegion.keys()].sort((a, b) => a.localeCompare(b, "ru"));
    return { byRegion, regionNames };
}

/** Заполняет select региона вариантами из справочника. */
export function fillProfileRegionSelect(regionNames) {
    if (!dom.profileRegion) {
        return;
    }

    const options = [`<option value="">Выберите регион</option>`]
        .concat(regionNames.map((region) => `<option value="${escapeHtml(region)}">${escapeHtml(region)}</option>`))
        .join("");

    dom.profileRegion.innerHTML = options;
}

/** Заполняет select города списком магазинов выбранного региона. */
function fillProfileCitySelect(cities, preferredCityId = "") {
    if (!dom.profileCity) {
        return;
    }

    if (!Array.isArray(cities) || !cities.length) {
        dom.profileCity.innerHTML = `<option value="">Сначала выберите регион</option>`;
        dom.profileCity.disabled = true;
        return;
    }

    dom.profileCity.disabled = false;
    dom.profileCity.innerHTML = cities
        .map((item) => `<option value="${item.id}">${escapeHtml(item.city || "Без названия")}</option>`)
        .join("");

    const preferred = cities.find((item) => String(item.id) === String(preferredCityId));
    if (preferred) {
        dom.profileCity.value = String(preferred.id);
    }
}

/** Пересобирает список городов в select при смене выбранного региона. */
export function syncProfileCitySelect(preferredCityId = "") {
    if (!state.regionsModel || !dom.profileRegion) {
        return;
    }

    const selectedRegion = (dom.profileRegion.value || "").trim();
    const cities = state.regionsModel.byRegion.get(selectedRegion) || [];
    fillProfileCitySelect(cities, preferredCityId);
}

/** Возвращает id и отображаемое название выбранного города. */
export function getSelectedCityContext() {
    if (!dom.profileCity) {
        const saved = loadProfileSelection();
        let cityName = "";
        if (saved.cityId && state.regionsModel?.byRegion) {
            const cities = state.regionsModel.byRegion.get(saved.region) || [];
            cityName = cities.find((item) => String(item.id) === String(saved.cityId))?.city || "";
        }
        return { cityId: saved.cityId, cityName };
    }

    const cityId = String(dom.profileCity.value || "").trim();
    const cityName = dom.profileCity.options[dom.profileCity.selectedIndex]?.textContent || "";
    return { cityId, cityName: String(cityName || "").trim() };
}

/** Возвращает название выбранного региона. */
export function getSelectedRegionValue() {
    return String(dom.profileRegion?.value || loadProfileSelection().region || "").trim();
}

/** Определяет отображаемое название текущего города (из select либо из сохранённого выбора). */
export function getCurrentCityDisplay() {
    try {
        if (dom.profileCity && dom.profileCity.selectedIndex > -1) {
            const txt = dom.profileCity.options[dom.profileCity.selectedIndex]?.textContent || "";
            if (txt && String(txt).trim()) {
                return String(txt).trim();
            }
        }

        const saved = loadProfileSelection();
        const savedCityId = String(saved.cityId || "").trim();
        if (savedCityId && state.regionsModel && state.regionsModel.byRegion) {
            for (const cities of state.regionsModel.byRegion.values()) {
                const found = cities.find((c) => String(c.id) === savedCityId);
                if (found) {
                    return String(found.city || "");
                }
            }
        }
    } catch (e) {
        // ignore
    }

    return "";
}
