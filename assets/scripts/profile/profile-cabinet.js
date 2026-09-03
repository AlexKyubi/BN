import { dom } from "../dom.js";
import { state } from "../state.js";
import { HIDE_NO_STOCK_STORAGE_KEY, HIDE_ZERO_PRICE_STORAGE_KEY } from "../config.js";
import { loadSavedUserName, renderCurrentUserName } from "../auth/device-auth.js";
import {
    buildRegionCityModel,
    fillProfileRegionSelect,
    loadProfileSelection,
    loadRegionRows,
    syncProfileCitySelect,
} from "../regions/regions.js";
import { getCurrentRegionEntry, loadStockCache, updateRegionUpdatedAtLabel } from "../stock/stock-cache.js";
import { syncCurrentRegionStock } from "../stock/stock-sync.js";
import { setProfileStatus } from "./profile-status.js";

/**
 * Личный кабинет: модальное окно, фильтры (скрыть нулевую цену/нет остатка), инициализация региона.
 */

/** Читает сохранённые переключатели фильтров личного кабинета. */
export function loadProfileFilters() {
    try {
        state.hideZeroPrice = localStorage.getItem(HIDE_ZERO_PRICE_STORAGE_KEY) === "1";
        state.hideNoStock = localStorage.getItem(HIDE_NO_STOCK_STORAGE_KEY) === "1";
    } catch (error) {
        console.warn("Не удалось прочитать фильтры личного кабинета:", error);
        state.hideZeroPrice = false;
        state.hideNoStock = false;
    }
}

/** Сохраняет переключатели фильтров личного кабинета. */
export function saveProfileFilters() {
    try {
        localStorage.setItem(HIDE_ZERO_PRICE_STORAGE_KEY, state.hideZeroPrice ? "1" : "0");
        localStorage.setItem(HIDE_NO_STOCK_STORAGE_KEY, state.hideNoStock ? "1" : "0");
    } catch (error) {
        console.warn("Не удалось сохранить фильтры личного кабинета:", error);
    }
}

/** Синхронизирует переключатели фильтров в DOM с текущим состоянием. */
export function syncProfileFiltersUi() {
    if (dom.hideZeroPrice) {
        dom.hideZeroPrice.checked = Boolean(state.hideZeroPrice);
    }
    if (dom.hideNoStock) {
        dom.hideNoStock.checked = Boolean(state.hideNoStock);
    }
}

/** Открывает модальное окно личного кабинета. */
export function openProfileModal() {
    if (!dom.profileModal) {
        return;
    }

    updateRegionUpdatedAtLabel();
    syncProfileFiltersUi();

    const cachedRegion = getCurrentRegionEntry();
    if (cachedRegion?.updatedAt) {
        setProfileStatus("Остатки загружены.", "ok");
    } else {
        setProfileStatus("Данные будут загружены с сервера при первом обращении.", "");
    }

    dom.profileModal.classList.remove("hidden");
}

/** Закрывает модальное окно личного кабинета. */
export function closeProfileModal() {
    if (!dom.profileModal) {
        return;
    }

    dom.profileModal.classList.add("hidden");
}

/** Готовит личный кабинет при старте приложения: справочник регионов, сохранённый выбор, синхронизация остатков. */
export async function initProfileCabinet() {
    state.stockCache = loadStockCache();
    state.stockSyncTokens = {};
    loadProfileFilters();
    syncProfileFiltersUi();

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
        }

        syncProfileCitySelect(savedSelection.cityId || "1");
        updateRegionUpdatedAtLabel();
        await syncCurrentRegionStock({ forceFull: false, silent: true });
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
