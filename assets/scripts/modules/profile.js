import { constants } from "./state.js";
import { escapeHtml } from "./utils.js";
import { formatStockUpdatedAt } from "./stock.js";

export function loadProfileSelection() {
    try {
        return {
            region: (localStorage.getItem(constants.PROFILE_REGION_STORAGE_KEY) || "").trim(),
            cityId: (localStorage.getItem(constants.PROFILE_CITY_STORAGE_KEY) || "").trim(),
        };
    } catch (error) {
        console.warn("Не удалось прочитать настройки кабинета:", error);
        return { region: "", cityId: "" };
    }
}

export function saveProfileSelection(region, cityId) {
    try {
        localStorage.setItem(constants.PROFILE_REGION_STORAGE_KEY, String(region || "").trim());
        localStorage.setItem(constants.PROFILE_CITY_STORAGE_KEY, String(cityId || "").trim());
    } catch (error) {
        console.warn("Не удалось сохранить настройки кабинета:", error);
    }
}

export function loadProfileFilters(state) {
    try {
        state.hideZeroPrice = localStorage.getItem(constants.HIDE_ZERO_PRICE_STORAGE_KEY) === "1";
        state.hideNoStock = localStorage.getItem(constants.HIDE_NO_STOCK_STORAGE_KEY) === "1";
    } catch (error) {
        console.warn("Не удалось прочитать фильтры личного кабинета:", error);
        state.hideZeroPrice = false;
        state.hideNoStock = false;
    }
}

export function saveProfileFilters(state) {
    try {
        localStorage.setItem(constants.HIDE_ZERO_PRICE_STORAGE_KEY, state.hideZeroPrice ? "1" : "0");
        localStorage.setItem(constants.HIDE_NO_STOCK_STORAGE_KEY, state.hideNoStock ? "1" : "0");
    } catch (error) {
        console.warn("Не удалось сохранить фильтры личного кабинета:", error);
    }
}

export function syncProfileFiltersUi(dom, state) {
    if (dom.hideZeroPrice) {
        dom.hideZeroPrice.checked = Boolean(state.hideZeroPrice);
    }
    if (dom.hideNoStock) {
        dom.hideNoStock.checked = Boolean(state.hideNoStock);
    }
}

export function loadStockCache() {
    try {
        const raw = localStorage.getItem(constants.STOCK_CACHE_KEY);
        if (!raw) {
            return { regions: {} };
        }

        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return { regions: {} };
        }

        if (parsed.regions && typeof parsed.regions === "object" && !Array.isArray(parsed.regions)) {
            return parsed;
        }

        return {
            regions: {
                legacy: {
                    regionName: "legacy",
                    cityId: "",
                    cityName: "",
                    updatedAt: 0,
                    items: parsed,
                },
            },
        };
    } catch (error) {
        console.warn("Не удалось загрузить кеш остатков:", error);
        return { regions: {} };
    }
}

export function saveStockCache(state) {
    try {
        localStorage.setItem(constants.STOCK_CACHE_KEY, JSON.stringify(state.stockCache || { regions: {} }));
    } catch (error) {
        console.warn("Не удалось сохранить кеш остатков:", error);
    }
}

export function buildRegionCacheKey(regionName, cityId) {
    const safeRegion = String(regionName || "").trim();
    const safeCityId = String(cityId || "").trim();
    return `${safeRegion}::${safeCityId}`;
}

export function getCurrentRegionEntry(state, dom) {
    const regionName = getSelectedRegionValue(dom);
    const cityId = String(dom.profileCity?.value || "").trim();
    if (!regionName || !cityId) {
        return null;
    }

    const key = buildRegionCacheKey(regionName, cityId);
    const entry = state.stockCache?.regions?.[key];
    if (!entry || typeof entry !== "object") {
        return null;
    }

    return entry;
}

export function ensureCurrentRegionEntry(state, dom) {
    const regionName = getSelectedRegionValue(dom);
    const cityId = String(dom.profileCity?.value || "").trim();
    const cityName = getSelectedCityContext(dom).cityName;

    if (!regionName || !cityId) {
        return null;
    }

    if (!state.stockCache || typeof state.stockCache !== "object") {
        state.stockCache = { regions: {} };
    }

    if (!state.stockCache.regions || typeof state.stockCache.regions !== "object") {
        state.stockCache.regions = {};
    }

    const key = buildRegionCacheKey(regionName, cityId);
    if (!state.stockCache.regions[key] || typeof state.stockCache.regions[key] !== "object") {
        state.stockCache.regions[key] = {
            regionName,
            cityId,
            cityName,
            updatedAt: 0,
            items: {},
        };
    }

    state.stockCache.regions[key].regionName = regionName;
    state.stockCache.regions[key].cityId = cityId;
    state.stockCache.regions[key].cityName = cityName;
    if (!state.stockCache.regions[key].items || typeof state.stockCache.regions[key].items !== "object") {
        state.stockCache.regions[key].items = {};
    }

    return state.stockCache.regions[key];
}

export function getStockRecordByArticle(state, dom, article) {
    const key = String(article || "").trim();
    if (!key) {
        return null;
    }

    const currentRegionEntry = getCurrentRegionEntry(state, dom);
    const value = currentRegionEntry?.items?.[key];
    if (!value || typeof value !== "object") {
        return null;
    }

    return value;
}

export function updateRegionUpdatedAtLabel(dom, state) {
    if (!dom.profileRegionUpdatedAt) {
        return;
    }

    const entry = getCurrentRegionEntry(state, dom);
    const text = entry?.updatedAt ? formatStockUpdatedAt(entry.updatedAt) : "-";
    dom.profileRegionUpdatedAt.textContent = `Последнее обновление по региону: ${text}`;
}

export function getCandidateRegionUrls() {
    const base = window.location.href;
    return [
        new URL("data/sulpak.region.codes.json", base),
        new URL("./data/sulpak.region.codes.json", base),
        new URL("../data/sulpak.region.codes.json", base),
        new URL("../../data/sulpak.region.codes.json", base),
    ];
}

export async function loadRegionRows() {
    const candidates = getCandidateRegionUrls();
    const errors = [];

    for (const url of candidates) {
        try {
            const response = await fetch(url, { cache: "no-store" });
            if (!response.ok) {
                errors.push(`${url.pathname}: HTTP ${response.status}`);
                continue;
            }

            const payload = await response.json();
            const rows = Array.isArray(payload) ? payload : payload?.regions;
            if (!Array.isArray(rows) || rows.length === 0) {
                errors.push(`${url.pathname}: пустой список`);
                continue;
            }

            const normalized = rows
                .map((item) => ({
                    id: Number(item?.id),
                    city: String(item?.city || "").trim(),
                    region: String(item?.region || "").trim(),
                }))
                .filter((item) => Number.isFinite(item.id) && item.id > 0 && item.city);

            if (!normalized.length) {
                errors.push(`${url.pathname}: нет валидных строк`);
                continue;
            }

            return normalized;
        } catch (error) {
            errors.push(`${url.pathname}: ${error.message}`);
        }
    }

    throw new Error(`Не удалось загрузить файл регионов. ${errors.join(" | ")}`);
}

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

export function fillProfileRegionSelect(dom, regionNames) {
    if (!dom.profileRegion) {
        return;
    }

    const options = [`<option value="">Выберите регион</option>`]
        .concat(regionNames.map((region) => `<option value="${escapeHtml(region)}">${escapeHtml(region)}</option>`))
        .join("");

    dom.profileRegion.innerHTML = options;
}

export function fillProfileCitySelect(dom, cities, preferredCityId = "") {
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

export function syncProfileCitySelect(dom, regionsModel, preferredCityId = "") {
    if (!regionsModel || !dom.profileRegion) {
        return;
    }

    const selectedRegion = (dom.profileRegion.value || "").trim();
    const cities = regionsModel.byRegion.get(selectedRegion) || [];
    fillProfileCitySelect(dom, cities, preferredCityId);
}

export function getSelectedCityContext(dom) {
    if (!dom.profileCity) {
        return { cityId: "", cityName: "" };
    }

    const cityId = String(dom.profileCity.value || "").trim();
    const cityName = dom.profileCity.options[dom.profileCity.selectedIndex]?.textContent || "";
    return { cityId, cityName: String(cityName || "").trim() };
}

export function getSelectedRegionValue(dom) {
    return String(dom.profileRegion?.value || "").trim();
}

export function getCurrentCityDisplay(dom, state) {
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
    } catch (error) {
        // ignore
    }

    return "";
}
