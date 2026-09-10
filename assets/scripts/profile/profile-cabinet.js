import { dom } from "../dom.js";
import { state } from "../state.js";
import { HIDE_NO_STOCK_STORAGE_KEY } from "../config.js";
import { loadSavedUserName, renderCurrentUserName } from "../auth/device-auth.js";
import {
    buildRegionCityModel,
    fillProfileRegionSelect,
    loadProfileSelection,
    loadRegionRows,
    saveProfileSelection,
    syncProfileCitySelect,
} from "../regions/regions.js";
import { loadStockCache, updateRegionUpdatedAtLabel } from "../stock/stock-cache.js";
import { syncCurrentRegionStock } from "../stock/stock-sync.js";
import { setProfileStatus } from "./profile-status.js";

/**
 * Настройки каталога: выбранный регион и режим отображения остатков.
 */

/** Читает сохранённый режим отображения остатков. */
export function loadProfileFilters() {
    try {
        localStorage.removeItem("bn_hide_zero_price_v1");
        state.hideNoStock = localStorage.getItem(HIDE_NO_STOCK_STORAGE_KEY) === "1";
    } catch (error) {
        console.warn("Не удалось прочитать режим отображения остатков:", error);
        state.hideNoStock = false;
    }
}

/** Готовит личный кабинет при старте приложения: справочник регионов, сохранённый выбор, синхронизация остатков. */
export async function initProfileCabinet({ syncStock = true } = {}) {
    state.stockCache = loadStockCache();
    state.stockSyncTokens = {};
    loadProfileFilters();

    try {
        const rows = await loadRegionRows();
        state.regionsModel = buildRegionCityModel(rows);
        fillProfileRegionSelect(state.regionsModel.regionNames);

        const savedSelection = loadProfileSelection();
        const defaultRegion = savedSelection.region
            || rows.find((item) => item.id === 1)?.region
            || state.regionsModel.regionNames[0]
            || "";

        if (dom.profileRegion && defaultRegion) {
            dom.profileRegion.value = defaultRegion;
            syncProfileCitySelect(savedSelection.cityId || "1");
        } else if (defaultRegion) {
            const cities = state.regionsModel.byRegion.get(defaultRegion) || [];
            const cityId = cities.some((item) => String(item.id) === String(savedSelection.cityId))
                ? savedSelection.cityId
                : String(cities.find((item) => item.id === 1)?.id || cities[0]?.id || "");
            saveProfileSelection(defaultRegion, cityId);
        }
        updateRegionUpdatedAtLabel();
        if (syncStock) {
            await syncCurrentRegionStock({ forceFull: false, silent: true });
        }
    } catch (error) {
        console.warn("Не удалось подготовить личный кабинет:", error);
        setProfileStatus(error.message || "Не удалось загрузить регионы.", "error");
    }

    // Обновим отображение имени пользователя и выбранного города после загрузки регионов.
    try {
        renderCurrentUserName(loadSavedUserName());
    } catch (e) {
        // ignore
    }
}
