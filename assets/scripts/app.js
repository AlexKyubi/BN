import { normalizeArticleSearchInput as normalizeArticleSearchInputFromUtils, normalizeFullName as normalizeFullNameFromUtils, parseCsv as parseCsvFromUtils } from "./modules/utils.js";
import { buildItem as buildItemModule, buildSulpakCharacteristicsUrl as buildSulpakCharacteristicsUrlModule } from "./modules/catalog.js";
import { fetchStockForArticle as fetchStockForArticleModule, formatMoneyKzt as formatMoneyKztModule } from "./modules/stock.js";
import { normalizeGoogleSheetCsvUrl as normalizeGoogleSheetCsvUrlFromAuth, verifyCredentials as verifyCredentialsFromAuth } from "./modules/auth.js";

const runtimeConfig =
    window.BN_CONFIG && typeof window.BN_CONFIG === "object"
        ? window.BN_CONFIG
        : {};

const GOOGLE_SHEET_URL = String(runtimeConfig.googleSheetUrl || "").trim();

const IMAGE_BASE_PATH = "images";
const CATEGORY_ALL = "all";
const CSV_CACHE_KEY = "bn_csv_cache";
const CSV_CACHE_TTL = 1000 * 60 * 60 * 6; // 6 часов
const QUICK_RETURN_STATE_KEY = "bn_quick_return_state_v1";
const QUICK_RETURN_TTL = 1000 * 60 * 30; // 30 минут
const LOCAL_CSV_PATH = "public/products.csv";
const AUTH_STORAGE_KEY = "bn_auth_ok_v1";
const AUTH_USER_NAME_KEY = "bn_user_name_v1";
const SHEET_URL_STORAGE_KEY = "bn_sheet_url_v1";
const PROFILE_REGION_STORAGE_KEY = "bn_profile_region_v1";
const PROFILE_CITY_STORAGE_KEY = "bn_profile_city_v1";
const HIDE_ZERO_PRICE_STORAGE_KEY = "bn_hide_zero_price_v1";
const HIDE_NO_STOCK_STORAGE_KEY = "bn_hide_no_stock_v1";
const DEFAULT_PROXY_BASE = "https://proxy.bn.alexkyubi.com";
const STOCK_PATH = "/stock";
const REGION_STOCK_PATH = "/region-stock";
const AUTH_VALIDATE_PATH = "/auth/validate";
const LANGUAGE_ID = 3;
const STOCK_CONFIG = {
    proxyBase: String(runtimeConfig.sulpakProxyBase || DEFAULT_PROXY_BASE).trim(),
};
const STOCK_FETCH_TIMEOUT_MS = Math.max(0, Number(runtimeConfig.stockFetchTimeoutMs || 600000));
const REGION_SYNC_TIMEOUT_MS = Math.max(0, Number(runtimeConfig.regionSyncTimeoutMs || 0));
const AUTH_VALIDATE_TIMEOUT_MS = Math.max(0, Number(runtimeConfig.authValidateTimeoutMs || 15000));
const CATALOG_REFRESH_INTERVAL_MS = Math.max(60_000, Number(runtimeConfig.catalogRefreshIntervalMs || 900_000));
const ARTICLE_COLUMN_INDEX = 2; // Column C
const DEFAULT_MONTH_COLUMN_INDEX = 4; // Column E

const dom = {
    grid: document.getElementById("grid"),
    search: document.getElementById("search"),
    stars: document.getElementById("stars"),
    resultCount: document.getElementById("resultCount"),
    activeFilters: document.getElementById("activeFilters"),
    monthToggle: document.getElementById("monthToggle"),
    monthBadge: document.getElementById("monthBadge"),
    resetFiltersBtn: document.getElementById("resetFiltersBtn"),
    monthDrawer: document.getElementById("monthDrawer"),
    closeMonthDrawer: document.getElementById("closeMonthDrawer"),
    monthList: document.getElementById("monthList"),
    monthDrawerBackdrop: document.getElementById("monthDrawerBackdrop"),
    viewer: document.getElementById("viewer"),
    viewerImage: document.getElementById("viewerImage"),
    viewerClose: document.getElementById("viewerClose"),
    viewerBackground: document.getElementById("viewerBackground"),
    template: document.getElementById("cardTemplate"),
    categoryToggle: document.getElementById("categoryToggle") || {},
    categoryDrawer: document.getElementById("categoryDrawer"),
    drawerBackdrop: document.getElementById("drawerBackdrop"),
    closeCategoryDrawer: document.getElementById("closeCategoryDrawer"),
    categoryList: document.getElementById("categoryList"),
    mainContent: document.getElementById("mainContent"),
    scrollTop: document.getElementById("scrollTop"),
    currentUser: document.getElementById("currentUser"),
    authModal: document.getElementById("authModal"),
    authForm: document.getElementById("authForm"),
    authLogin: document.getElementById("authLogin"),
    authSheetUrl: document.getElementById("authSheetUrl"),
    authError: document.getElementById("authError"),
    profileModal: document.getElementById("profileModal"),
    profileBackdrop: document.getElementById("profileBackdrop"),
    closeProfileModal: document.getElementById("closeProfileModal"),
    closeProfileFooterBtn: document.getElementById("closeProfileFooterBtn"),
    profileRegion: document.getElementById("profileRegion"),
    profileCity: document.getElementById("profileCity"),
    profileRegionUpdatedAt: document.getElementById("profileRegionUpdatedAt"),
    hideZeroPrice: document.getElementById("hideZeroPrice"),
    hideNoStock: document.getElementById("hideNoStock"),
    profileStatus: document.getElementById("profileStatus"),
    refreshStockBtn: document.getElementById("refreshStockBtn"),
    stockInfoModal: document.getElementById("stockInfoModal"),
    stockInfoBackdrop: document.getElementById("stockInfoBackdrop"),
    closeStockInfoModal: document.getElementById("closeStockInfoModal"),
    closeStockInfoFooterBtn: document.getElementById("closeStockInfoFooterBtn"),
    stockInfoBody: document.getElementById("stockInfoBody"),
};

let items = [];
let categories = [];
let activeCategory = CATEGORY_ALL;
let activeStars = 0;
let searchQuery = "";
let loadError = null;
let loadWarning = null;
let appStarted = false;
let monthColumns = [];
let activeMonthColumn = -1;
let pendingQuickReturnMonthColumn = null;
let sourceRows = [];
let sourceBaseIndices = null;
let sourceWarnings = [];
let regionsModel = null;
let stockCache = { regions: {} };
let stockSyncTokens = {};
let hideZeroPrice = false;
let hideNoStock = false;
let catalogRefreshTimerId = null;
let catalogRefreshInFlight = false;

function isAuthorizedOnDevice() {
    try {
        return localStorage.getItem(AUTH_STORAGE_KEY) === "1"
            && Boolean(loadSavedUserName())
            && Boolean(getEffectiveSheetUrl());
    } catch (error) {
        console.warn("Не удалось прочитать статус авторизации:", error);
        return false;
    }
}

function saveAuthorizationOnDevice(fullName, sheetUrl) {
    try {
        localStorage.setItem(AUTH_STORAGE_KEY, "1");
        localStorage.setItem(AUTH_USER_NAME_KEY, fullName);
        localStorage.setItem(SHEET_URL_STORAGE_KEY, sheetUrl);
    } catch (error) {
        console.warn("Не удалось сохранить статус авторизации:", error);
    }
}

function clearAuthorizationOnDevice() {
    try {
        localStorage.removeItem(AUTH_STORAGE_KEY);
        localStorage.removeItem(AUTH_USER_NAME_KEY);
        localStorage.removeItem(SHEET_URL_STORAGE_KEY);
    } catch (error) {
        console.warn("Не удалось очистить статус авторизации:", error);
    }
}

function loadSavedSheetUrl() {
    try {
        return (localStorage.getItem(SHEET_URL_STORAGE_KEY) || "").trim();
    } catch (error) {
        console.warn("Не удалось прочитать ссылку таблицы:", error);
        return "";
    }
}

function getEffectiveSheetUrl() {
    const saved = loadSavedSheetUrl();
    if (saved) {
        return saved;
    }
    return GOOGLE_SHEET_URL;
}

function isValidGoogleSheetCsvUrl(value) {
    return Boolean(normalizeGoogleSheetCsvUrlFromAuth(value));
}

function loadSavedUserName() {
    try {
        return (localStorage.getItem(AUTH_USER_NAME_KEY) || "").trim();
    } catch (error) {
        console.warn("Не удалось прочитать имя пользователя:", error);
        return "";
    }
}

function renderCurrentUserName(fullName) {
    if (!dom.currentUser) {
        return;
    }

    const safeName = (fullName || "").trim();
    if (!safeName) {
        dom.currentUser.textContent = "";
        dom.currentUser.classList.add("hidden");
        return;
    }

    const city = getCurrentCityDisplay();
    if (city) {
        dom.currentUser.innerHTML = `${escapeHtml(safeName)}<br><span class="current-user-city">${escapeHtml(city)}</span>`;
    } else {
        dom.currentUser.textContent = `Пользователь: ${safeName}`;
    }
    dom.currentUser.title = "Открыть личный кабинет";
    dom.currentUser.setAttribute("role", "button");
    dom.currentUser.setAttribute("tabindex", "0");
    dom.currentUser.classList.remove("hidden");
}

function showAuthModal() {
    if (!dom.authModal) {
        return;
    }

    document.body.classList.add("auth-locked");
    dom.authModal.classList.remove("hidden");
    if (dom.authLogin) {
        dom.authLogin.focus();
    }
}

function hideAuthModal() {
    if (!dom.authModal) {
        return;
    }

    dom.authModal.classList.add("hidden");
    document.body.classList.remove("auth-locked");
}

function isValidFullName(value) {
    const normalized = normalizeFullNameFromUtils(value);
    return /^[A-Za-zА-Яа-яЁёІіЇїЄєҚқҢңҒғҮүҰұӨөҺһ-]+\s+[A-Za-zА-Яа-яЁёІіЇїЄєҚқҢңҒғҮүҰұӨөҺһ-]+(?:\s+[A-Za-zА-Яа-яЁёІіЇїЄєҚқҢңҒғҮүҰұӨөҺһ-]+)*$/.test(normalized);
}

function clearAuthError() {
    if (dom.authError) {
        dom.authError.textContent = "";
    }
}

function setAuthError(message) {
    if (dom.authError) {
        dom.authError.textContent = message;
    }
}

function bindAuthorizationEvents() {
    if (!dom.authForm) {
        return;
    }

    dom.authForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const username = (dom.authLogin?.value || "").trim();
        const rawSheetUrl = (dom.authSheetUrl?.value || "").trim();

        clearAuthError();

        if (!username || !rawSheetUrl) {
            setAuthError("Введите логин и ссылку таблицы.");
            return;
        }

        const sheetUrl = normalizeGoogleSheetCsvUrlFromAuth(rawSheetUrl);
        if (!sheetUrl) {
            setAuthError("Введите корректную ссылку Google Sheets (edit/export). Сервис сам преобразует её для проверки.");
            return;
        }

        if (dom.authSheetUrl) {
            dom.authSheetUrl.value = sheetUrl;
        }

        const verified = verifyCredentialsFromAuth(username);
        if (!verified.ok) {
            setAuthError(verified.message);
            return;
        }

        const authorization = await validateSheetUrlWithServer(sheetUrl);
        if (!authorization.ok) {
            setAuthError(authorization.message);
            return;
        }

        saveAuthorizationOnDevice(verified.fullName, authorization.normalizedSheetUrl);
        renderCurrentUserName(verified.fullName);
        hideAuthModal();
        await startApp();
    });
}

async function startApp() {
    if (appStarted) {
        return;
    }

    appStarted = true;
    bindEvents();
    await initProfileCabinet();
    hydrateQuickReturnState();
    await loadProducts();
    renderCards();
    scheduleCatalogRefresh();
    try {
        await syncCurrentRegionStock({ forceFull: false, silent: true });
    } catch (error) {
        console.warn("Не удалось выполнить стартовую синхронизацию региона:", error);
    }
}

function scheduleCatalogRefresh() {
    if (catalogRefreshTimerId) {
        clearInterval(catalogRefreshTimerId);
    }

    catalogRefreshTimerId = setInterval(() => {
        void refreshCatalogInBackground();
    }, CATALOG_REFRESH_INTERVAL_MS);
}

async function refreshCatalogInBackground() {
    if (catalogRefreshInFlight) {
        return;
    }

    // Если вкладка неактивна, пропускаем итерацию, чтобы не тратить сеть и CPU.
    if (document.visibilityState !== "visible") {
        return;
    }

    catalogRefreshInFlight = true;
    try {
        await loadProducts();
        renderCards();
    } catch (error) {
        console.warn("Фоновое обновление каталога не удалось:", error);
    } finally {
        catalogRefreshInFlight = false;
    }
}

window.__BN_TEST__ = {
    get items() {
        return items;
    },
};

function saveQuickReturnState() {
    const uiState = {
        activeCategory,
        activeStars,
        searchQuery,
        activeMonthColumn,
        scrollY: window.scrollY || 0,
    };

    const payload = {
        timestamp: Date.now(),
        uiState,
        items,
        categories,
    };

    try {
        sessionStorage.setItem(QUICK_RETURN_STATE_KEY, JSON.stringify(payload));
    } catch (error) {
        console.warn("Не удалось сохранить состояние быстрого возврата:", error);
    }
}

function hydrateQuickReturnState() {
    let payload;
    try {
        const raw = sessionStorage.getItem(QUICK_RETURN_STATE_KEY);
        if (!raw) {
            return;
        }
        payload = JSON.parse(raw);
    } catch (error) {
        console.warn("Не удалось прочитать состояние быстрого возврата:", error);
        return;
    }

    if (!payload || typeof payload !== "object") {
        return;
    }

    if (!payload.timestamp || Date.now() - payload.timestamp > QUICK_RETURN_TTL) {
        return;
    }

    if (Array.isArray(payload.items) && payload.items.length) {
        items = payload.items;
    }

    if (Array.isArray(payload.categories) && payload.categories.length) {
        categories = payload.categories;
    }

    if (Array.isArray(categories) && categories.length) {
        createCategoryList(categories);
    }

    const uiState = payload.uiState && typeof payload.uiState === "object"
        ? payload.uiState
        : {};

    activeCategory = uiState.activeCategory || CATEGORY_ALL;
    activeStars = Number(uiState.activeStars || 0);
    searchQuery = normalizeArticleSearchInputFromUtils(uiState.searchQuery || "");
    pendingQuickReturnMonthColumn = Number.isFinite(Number(uiState.activeMonthColumn))
        ? Number(uiState.activeMonthColumn)
        : null;
    dom.search.value = searchQuery;

    updateCategoryButtons();
    updateStarsButtons();
    renderCards();

    if (Number.isFinite(uiState.scrollY) && uiState.scrollY > 0) {
        requestAnimationFrame(() => {
            window.scrollTo({ top: uiState.scrollY, behavior: "auto" });
        });
    }
}

async function initAuthorization() {
    bindAuthorizationEvents();
    const savedUserName = loadSavedUserName();
    const savedSheetUrl = loadSavedSheetUrl();
    renderCurrentUserName(savedUserName);
    if (dom.authSheetUrl && savedSheetUrl) {
        dom.authSheetUrl.value = savedSheetUrl;
    }

    if (isAuthorizedOnDevice()) {
        const authorization = await validateSheetUrlWithServer(savedSheetUrl);
        if (!authorization.ok) {
            clearAuthorizationOnDevice();
            if (dom.authSheetUrl) {
                dom.authSheetUrl.value = "";
            }
            showAuthModal();
            setAuthError(authorization.message);
            return;
        }

        if (authorization.normalizedSheetUrl !== savedSheetUrl) {
            saveAuthorizationOnDevice(savedUserName, authorization.normalizedSheetUrl);
            if (dom.authSheetUrl) {
                dom.authSheetUrl.value = authorization.normalizedSheetUrl;
            }
        }

        hideAuthModal();
        startApp();
        return;
    }

    showAuthModal();
}

function setProfileStatus(message, tone = "") {
    if (!dom.profileStatus) {
        return;
    }

    dom.profileStatus.textContent = message || "";
    dom.profileStatus.classList.remove("ok", "error");
    if (tone) {
        dom.profileStatus.classList.add(tone);
    }
}

function loadProfileSelection() {
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

function saveProfileSelection(region, cityId) {
    try {
        localStorage.setItem(PROFILE_REGION_STORAGE_KEY, String(region || "").trim());
        localStorage.setItem(PROFILE_CITY_STORAGE_KEY, String(cityId || "").trim());
    } catch (error) {
        console.warn("Не удалось сохранить настройки кабинета:", error);
    }
}

function loadProfileFilters() {
    try {
        hideZeroPrice = localStorage.getItem(HIDE_ZERO_PRICE_STORAGE_KEY) === "1";
        hideNoStock = localStorage.getItem(HIDE_NO_STOCK_STORAGE_KEY) === "1";
    } catch (error) {
        console.warn("Не удалось прочитать фильтры личного кабинета:", error);
        hideZeroPrice = false;
        hideNoStock = false;
    }
}

function saveProfileFilters() {
    try {
        localStorage.setItem(HIDE_ZERO_PRICE_STORAGE_KEY, hideZeroPrice ? "1" : "0");
        localStorage.setItem(HIDE_NO_STOCK_STORAGE_KEY, hideNoStock ? "1" : "0");
    } catch (error) {
        console.warn("Не удалось сохранить фильтры личного кабинета:", error);
    }
}

function syncProfileFiltersUi() {
    if (dom.hideZeroPrice) {
        dom.hideZeroPrice.checked = Boolean(hideZeroPrice);
    }
    if (dom.hideNoStock) {
        dom.hideNoStock.checked = Boolean(hideNoStock);
    }
}

function loadStockCache() {
    return { regions: {} };
}

function saveStockCache() {
    // Источник истины - сервер и SQLite. На клиенте держим только сессионный in-memory кеш.
}

function buildRegionCacheKey(regionName, cityId) {
    const safeRegion = String(regionName || "").trim();
    const safeCityId = String(cityId || "").trim();
    return `${safeRegion}::${safeCityId}`;
}

function getCurrentRegionEntry() {
    const regionName = getSelectedRegionValue();
    const cityId = String(dom.profileCity?.value || "").trim();
    if (!regionName || !cityId) {
        return null;
    }

    const key = buildRegionCacheKey(regionName, cityId);
    const entry = stockCache?.regions?.[key];
    if (!entry || typeof entry !== "object") {
        return null;
    }

    return entry;
}

function ensureCurrentRegionEntry() {
    const regionName = getSelectedRegionValue();
    const cityId = String(dom.profileCity?.value || "").trim();
    const cityName = getSelectedCityContext().cityName;

    if (!regionName || !cityId) {
        return null;
    }

    if (!stockCache || typeof stockCache !== "object") {
        stockCache = { regions: {} };
    }

    if (!stockCache.regions || typeof stockCache.regions !== "object") {
        stockCache.regions = {};
    }

    const key = buildRegionCacheKey(regionName, cityId);
    if (!stockCache.regions[key] || typeof stockCache.regions[key] !== "object") {
        stockCache.regions[key] = {
            regionName,
            cityId,
            cityName,
            updatedAt: 0,
            items: {},
        };
    }

    stockCache.regions[key].regionName = regionName;
    stockCache.regions[key].cityId = cityId;
    stockCache.regions[key].cityName = cityName;
    if (!stockCache.regions[key].items || typeof stockCache.regions[key].items !== "object") {
        stockCache.regions[key].items = {};
    }

    return stockCache.regions[key];
}

function getStockRecordByArticle(article) {
    const key = String(article || "").trim();
    if (!key) {
        return null;
    }

    const currentRegionEntry = getCurrentRegionEntry();
    const value = currentRegionEntry?.items?.[key];
    if (!value || typeof value !== "object") {
        return null;
    }

    return value;
}

function updateRegionUpdatedAtLabel() {
    if (!dom.profileRegionUpdatedAt) {
        return;
    }

    const entry = getCurrentRegionEntry();
    const text = entry?.updatedAt
        ? formatStockUpdatedAt(entry.updatedAt)
        : "-";
    dom.profileRegionUpdatedAt.textContent = `Последнее обновление по региону: ${text}`;
}

function getCandidateRegionUrls() {
    const base = window.location.href;
    return [
        new URL("data/sulpak.region.codes.json", base),
        new URL("./data/sulpak.region.codes.json", base),
        new URL("../data/sulpak.region.codes.json", base),
        new URL("../../data/sulpak.region.codes.json", base),
    ];
}

async function loadRegionRows() {
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

function buildRegionCityModel(rows) {
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

function fillProfileRegionSelect(regionNames) {
    if (!dom.profileRegion) {
        return;
    }

    const options = [`<option value="">Выберите регион</option>`]
        .concat(regionNames.map((region) => `<option value="${escapeHtml(region)}">${escapeHtml(region)}</option>`))
        .join("");

    dom.profileRegion.innerHTML = options;
}

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

function syncProfileCitySelect(preferredCityId = "") {
    if (!regionsModel || !dom.profileRegion) {
        return;
    }

    const selectedRegion = (dom.profileRegion.value || "").trim();
    const cities = regionsModel.byRegion.get(selectedRegion) || [];
    fillProfileCitySelect(cities, preferredCityId);
}

function getSelectedCityContext() {
    if (!dom.profileCity) {
        return { cityId: "", cityName: "" };
    }

    const cityId = String(dom.profileCity.value || "").trim();
    const cityName = dom.profileCity.options[dom.profileCity.selectedIndex]?.textContent || "";
    return { cityId, cityName: String(cityName || "").trim() };
}

function getSelectedRegionValue() {
    return String(dom.profileRegion?.value || "").trim();
}

function getCurrentCityDisplay() {
    try {
        if (dom.profileCity && dom.profileCity.selectedIndex > -1) {
            const txt = dom.profileCity.options[dom.profileCity.selectedIndex]?.textContent || "";
            if (txt && String(txt).trim()) {
                return String(txt).trim();
            }
        }

        const saved = loadProfileSelection();
        const savedCityId = String(saved.cityId || "").trim();
        if (savedCityId && regionsModel && regionsModel.byRegion) {
            for (const cities of regionsModel.byRegion.values()) {
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

function buildStockUrl({ cityId, article, languageId }) {
    const configuredBase = String(STOCK_CONFIG.proxyBase || DEFAULT_PROXY_BASE).trim();
    const normalizedBase = configuredBase.endsWith("/") ? configuredBase.slice(0, -1) : configuredBase;
    const url = new URL(`${normalizedBase}${STOCK_PATH}`, window.location.origin);
    url.searchParams.set("cityId", String(cityId));
    url.searchParams.set("article", String(article));
    url.searchParams.set("languageId", String(languageId));
    return url.toString();
}

function buildRegionStockUrl({ cityId, languageId, sinceToken = null }) {
    const configuredBase = String(STOCK_CONFIG.proxyBase || DEFAULT_PROXY_BASE).trim();
    const normalizedBase = configuredBase.endsWith("/") ? configuredBase.slice(0, -1) : configuredBase;
    const url = new URL(`${normalizedBase}${REGION_STOCK_PATH}`, window.location.origin);
    url.searchParams.set("cityId", String(cityId));
    url.searchParams.set("languageId", String(languageId));
    if (Number.isFinite(Number(sinceToken)) && Number(sinceToken) > 0) {
        url.searchParams.set("since", String(Number(sinceToken)));
    }
    return url.toString();
}

function buildAuthValidateUrl(sheetUrl) {
    const configuredBase = String(STOCK_CONFIG.proxyBase || DEFAULT_PROXY_BASE).trim();
    const normalizedBase = configuredBase.endsWith("/") ? configuredBase.slice(0, -1) : configuredBase;
    const url = new URL(`${normalizedBase}${AUTH_VALIDATE_PATH}`, window.location.origin);
    url.searchParams.set("sheetUrl", String(sheetUrl || "").trim());
    return url.toString();
}

async function parseResponseBody(response) {
    const text = await response.text();
    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch {
        return { raw: text };
    }
}

function normalizeStockRecord(payload, fallbackCityName = "") {
    const stores = Array.isArray(payload?.stores)
        ? payload.stores.map((store) => ({
            storageId: String(store?.storageId || "").trim(),
            address: String(store?.address || "").trim(),
            availability: String(store?.availability || "").trim(),
        }))
        : [];

    const countFromField = Number(payload?.count);
    const count = Number.isFinite(countFromField) ? countFromField : stores.length;

    const priceValue = Number(payload?.price);
    const price = Number.isFinite(priceValue) ? priceValue : null;

    return {
        price,
        count,
        stores,
        cityTitle: String(payload?.cityTitle || fallbackCityName || "").trim(),
        updatedAt: Date.now(),
    };
}

async function fetchStockForArticle(cityId, cityName, article, options = {}) {
    return fetchStockForArticleModule(cityId, cityName, article, options);
}

async function fetchRegionStockSnapshot(cityId, sinceToken = null) {
    const controller = new AbortController();
    const timeoutId = REGION_SYNC_TIMEOUT_MS > 0
        ? setTimeout(() => controller.abort(), REGION_SYNC_TIMEOUT_MS)
        : null;
    const requestUrl = buildRegionStockUrl({ cityId, languageId: LANGUAGE_ID, sinceToken });

    let response;
    try {
        response = await fetch(requestUrl, {
            method: "GET",
            headers: { Accept: "application/json" },
            signal: timeoutId ? controller.signal : undefined,
        });
    } catch (error) {
        if (error && error.name === "AbortError") {
            throw new Error(`timeout_${REGION_SYNC_TIMEOUT_MS}ms`);
        }
        throw error;
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }

    const payload = await parseResponseBody(response);
    if (!response.ok) {
        const message = payload?.error || payload?.message || `HTTP ${response.status}`;
        throw new Error(String(message));
    }

    return payload;
}

async function validateSheetUrlWithServer(sheetUrl) {
    const normalizedSheetUrl = normalizeGoogleSheetCsvUrlFromAuth(sheetUrl);
    if (!normalizedSheetUrl) {
        return { ok: false, message: "Введите корректную ссылку Google Sheets." };
    }

    const controller = new AbortController();
    const timeoutId = AUTH_VALIDATE_TIMEOUT_MS > 0
        ? setTimeout(() => controller.abort(), AUTH_VALIDATE_TIMEOUT_MS)
        : null;
    const requestUrl = buildAuthValidateUrl(normalizedSheetUrl);

    let response;
    try {
        response = await fetch(requestUrl, {
            method: "GET",
            headers: { Accept: "application/json" },
            signal: timeoutId ? controller.signal : undefined,
        });
    } catch (error) {
        if (error && error.name === "AbortError") {
            return { ok: false, message: `Сервер авторизации не ответил за ${AUTH_VALIDATE_TIMEOUT_MS} мс.` };
        }
        return { ok: false, message: "Не удалось проверить ссылку на сервере." };
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }

    const payload = await parseResponseBody(response);
    if (!response.ok || payload?.authorized !== true) {
        return {
            ok: false,
            message: payload?.message || "Доступ запрещён: ссылка таблицы не совпадает с разрешённой.",
        };
    }

    return {
        ok: true,
        normalizedSheetUrl: String(payload?.normalizedSheetUrl || normalizedSheetUrl).trim(),
    };
}

function getCurrentRegionSyncToken(regionName, cityId) {
    const key = buildRegionCacheKey(regionName, cityId);
    return Number(stockSyncTokens[key] || 0);
}

function setCurrentRegionSyncToken(regionName, cityId, token) {
    const key = buildRegionCacheKey(regionName, cityId);
    const nextToken = Number(token);
    stockSyncTokens[key] = Number.isFinite(nextToken) && nextToken > 0 ? nextToken : 0;
}

async function syncCurrentRegionStock(options = {}) {
    const region = getSelectedRegionValue();
    const { cityId } = getSelectedCityContext();

    if (!region || !cityId) {
        return;
    }

    const regionEntry = ensureCurrentRegionEntry();
    if (!regionEntry) {
        return;
    }

    const forceFull = Boolean(options?.forceFull);
    const silent = Boolean(options?.silent);
    const sinceToken = forceFull ? null : getCurrentRegionSyncToken(region, cityId);

    if (!silent) {
        setProfileStatus("Синхронизация с сервером...", "");
    }

    const payload = await fetchRegionStockSnapshot(cityId, sinceToken);
    const rows = Array.isArray(payload?.items) ? payload.items : [];
    rows.forEach((row) => {
        const article = String(row?.article || "").trim();
        if (!article) {
            return;
        }
        regionEntry.items[article] = normalizeStockRecord(row, regionEntry.cityName);
    });

    if (Number.isFinite(Number(payload?.syncToken))) {
        setCurrentRegionSyncToken(region, cityId, Number(payload.syncToken));
    }

    regionEntry.updatedAt = Date.now();
    saveStockCache();
    updateRegionUpdatedAtLabel();
    renderCards();

    if (!silent) {
        setProfileStatus("Данные региона синхронизированы с сервером.", "ok");
    }
}

function formatMoneyKzt(value) {
    return formatMoneyKztModule(value);
}

function formatStockUpdatedAt(timestamp) {
    if (!Number.isFinite(Number(timestamp))) {
        return "-";
    }

    return new Date(Number(timestamp)).toLocaleString("ru-RU");
}

function createStoreInfoHtml(stores) {
    if (!Array.isArray(stores) || !stores.length) {
        return "<p class=\"stock-info-empty\">Точки с остатками не найдены.</p>";
    }

    const items = stores.map((store) => {
        const address = escapeHtml(store.address || "Без адреса");
        const availability = escapeHtml(store.availability || "Нет данных");
        return `<li><strong>${address}</strong><span>${availability}</span></li>`;
    }).join("");

    return `<ul class=\"stock-info-list\">${items}</ul>`;
}

function showStockInfoModal(item, stockRecord = null) {
    const currentRecord = stockRecord || getStockRecordByArticle(item?.article);
    if (!dom.stockInfoModal || !dom.stockInfoBody) {
        return;
    }

    const city = currentRecord?.cityTitle || "-";
    const count = Number.isFinite(Number(currentRecord?.count)) ? Number(currentRecord.count) : 0;
    const price = formatMoneyKzt(currentRecord?.price);
    const updatedAt = formatStockUpdatedAt(currentRecord?.updatedAt);
    const viewStats = currentRecord?._serverMeta?.viewStats;

    dom.stockInfoBody.innerHTML = `
        <p><strong>Товар:</strong> #${escapeHtml(item?.article || "-")}</p>
        <p><strong>Название:</strong> ${escapeHtml(item?.title || "-")}</p>
        <p><strong>Город:</strong> ${escapeHtml(city)}</p>
        <p><strong>Цена:</strong> ${escapeHtml(price)}</p>
        <p><strong>Остаток:</strong> ${escapeHtml(String(count))}</p>
        <p><strong>Обновлено:</strong> ${escapeHtml(updatedAt)}</p>
        ${viewStats ? `<p><strong>Просмотры за 7 дней:</strong> регион ${escapeHtml(String(viewStats.region7d || 0))}, Казахстан ${escapeHtml(String(viewStats.kz7d || 0))}</p>` : ""}
        ${createStoreInfoHtml(currentRecord?.stores || [])}
    `;

    dom.stockInfoModal.classList.remove("hidden");
    dom.stockInfoModal.setAttribute("aria-hidden", "false");
}

function closeStockInfoModal() {
    if (!dom.stockInfoModal) {
        return;
    }

    dom.stockInfoModal.classList.add("hidden");
    dom.stockInfoModal.setAttribute("aria-hidden", "true");
}

function openProfileModal() {
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

function closeProfileModal() {
    if (!dom.profileModal) {
        return;
    }

    dom.profileModal.classList.add("hidden");
}

async function initProfileCabinet() {
    stockCache = loadStockCache();
    stockSyncTokens = {};
    loadProfileFilters();
    syncProfileFiltersUi();

    try {
        const rows = await loadRegionRows();
        regionsModel = buildRegionCityModel(rows);
        fillProfileRegionSelect(regionsModel.regionNames);

        const savedSelection = loadProfileSelection();
        const defaultRegion = savedSelection.region
            || rows.find((item) => item.id === 1)?.region
            || regionsModel.regionNames[0]
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
    // Обновим отображение имени пользователя и выбранного города после загрузки регионов
    try {
        renderCurrentUserName(loadSavedUserName());
    } catch (e) {
        // ignore
    }
}

async function refreshStockForAllItems() {
    if (!items.length) {
        setProfileStatus("Товары ещё не загружены.", "error");
        return;
    }

    const region = getSelectedRegionValue();
    const { cityId, cityName } = getSelectedCityContext();

    if (!region) {
        setProfileStatus("Выберите регион.", "error");
        return;
    }

    if (!cityId) {
        setProfileStatus("Выберите магазин (город).", "error");
        return;
    }

    if (!dom.refreshStockBtn) {
        return;
    }

    saveProfileSelection(region, cityId);
    dom.refreshStockBtn.disabled = true;
    try {
        await syncCurrentRegionStock({ forceFull: true, silent: false });
    } catch (error) {
        console.warn("Ошибка синхронизации остатков:", error);
        setProfileStatus(`Ошибка синхронизации: ${error.message || error}`, "error");
    } finally {
        dom.refreshStockBtn.disabled = false;
    }
}

function normalizeHeader(value) {
    return (value || "").trim().toLowerCase();
}

function normalizeHeaderName(value) {
    return (value || "")
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9а-яё]+/gi, "");
}

function escapeRegExp(string) {
    return String(string).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function findColumnIndex(headers, possibleNames) {
    const normalizedHeaders = headers.map(normalizeHeaderName);

    for (const name of possibleNames) {
        const normalizedName = normalizeHeaderName(name);
        const exactIndex = normalizedHeaders.indexOf(normalizedName);
        if (exactIndex !== -1) {
            return exactIndex;
        }

        if (normalizedName.length === 1) {
            continue; // односимвольные заголовки не должны матчиться по подстроке
        }

        const fuzzyIndex = normalizedHeaders.findIndex((header) =>
            header.includes(normalizedName) || normalizedName.includes(header)
        );

        if (fuzzyIndex !== -1) {
            return fuzzyIndex;
        }
    }

    return -1;
}

function detectMonthColumns(headers) {
    const months = [];

    for (let col = DEFAULT_MONTH_COLUMN_INDEX; col < headers.length; col += 1) {
        const label = headers[col] == null ? "" : String(headers[col]);
        if (!label.length) {
            continue;
        }

        months.push({
            index: col,
            label,
        });
    }

    return months;
}

function formatMonthBadgeText(label) {
    const raw = String(label || "").trim();
    if (!raw) {
        return "";
    }

    const normalized = raw
        .replace(/^bonus\s+/i, "")
        .replace(/^update\s+/i, "")
        .replace(/\s+/g, " ")
        .trim();

    if (!normalized) {
        return "";
    }

    const token = normalized.split(" ")[0] || normalized;
    return token.slice(0, 3);
}

function getActiveMonthLabel() {
    const activeMonth = monthColumns.find((month) => month.index === activeMonthColumn);
    return activeMonth ? activeMonth.label : "";
}

function syncMonthSelector() {
    if (!dom.monthList) {
        return;
    }

    dom.monthList.innerHTML = "";

    if (!monthColumns.length) {
        const empty = document.createElement("div");
        empty.className = "empty-text";
        empty.textContent = "Месяцы не найдены";
        dom.monthList.append(empty);
        if (dom.monthToggle) {
            dom.monthToggle.disabled = true;
        }
        return;
    }

    if (!monthColumns.some((month) => month.index === activeMonthColumn)) {
        const hasDefaultMonth = monthColumns.some((month) => month.index === DEFAULT_MONTH_COLUMN_INDEX);
        activeMonthColumn = hasDefaultMonth
            ? DEFAULT_MONTH_COLUMN_INDEX
            : monthColumns[0].index;
    }

    monthColumns.forEach((month) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "category-item month-item";
        button.dataset.monthIndex = String(month.index);
        button.textContent = month.label;
        button.classList.toggle("active", month.index === activeMonthColumn);
        dom.monthList.append(button);
    });

    if (dom.monthToggle) {
        dom.monthToggle.disabled = false;
        const activeMonthLabel = getActiveMonthLabel();
        dom.monthToggle.title = activeMonthLabel
            ? `Выбран месяц: ${activeMonthLabel}`
            : "Выбрать месяц";
    }

    if (dom.monthBadge) {
        const badgeText = formatMonthBadgeText(getActiveMonthLabel());
        dom.monthBadge.textContent = badgeText;
        dom.monthBadge.classList.toggle("hidden", !badgeText);
    }
}

function rebuildItemsFromSourceRows() {
    if (!sourceRows.length || !sourceBaseIndices) {
        return;
    }

    const warnings = [...sourceWarnings];
    const ratingIndex = activeMonthColumn;

    if (ratingIndex === -1) {
        warnings.push("Колонки месяцев (с E) не найдены. Все товары будут без звёзд.");
    }

    items = sourceRows.slice(1)
        .map((row) => buildItem(row, { ...sourceBaseIndices, rating: ratingIndex }))
        .filter(Boolean);

    if (!items.length) {
        const message = warnings.length
            ? `CSV загружен, но не найдено данных товаров. ${warnings.join(" ")}`
            : "CSV загружен, но товары не найдены. Проверьте данные в файле.";
        loadError = message;
        dom.grid.textContent = message;
        dom.resultCount.textContent = "Ошибка загрузки товаров";
        dom.activeFilters.textContent = message;
        return;
    }

    loadError = null;
    loadWarning = warnings.length ? warnings.join(" ") : null;

    const categoryNames = [...new Set(items.map((item) => item.category))]
        .sort((a, b) => a.localeCompare(b, "ru"));
    createCategoryList(categoryNames);
    updateStarsButtons();
    renderCards();
}

function parseRating(value) {
    const normalized = (value || "").toString().trim().replace(',', '.').replace('%', '');
    const parsed = Number(normalized);

    if (Number.isNaN(parsed)) {
        return 0;
    }

    if (parsed > 5) {
        return Math.min(5, Math.max(1, Math.round(parsed / 20)));
    }

    return Math.min(5, Math.max(1, Math.round(parsed)));
}

function parsePercent(value) {
    if (value == null) return null;
    const raw = String(value).trim();
    if (!raw) return null;

    const hasPercent = raw.includes('%');
    const normalized = raw.replace('%', '').replace(',', '.').trim();
    const n = Number(normalized);
    if (Number.isNaN(n)) return null;

    // Treat any numeric 0..100 as percent when possible.
    if (n >= 0 && n <= 100) {
        return Math.round(n);
    }

    // fallback: if it's a small fraction 0..1, scale to percent
    if (n > 0 && n <= 1) {
        return Math.round(n * 100);
    }

    return null;
}

function extractArticleFromText(value) {
    const raw = String(value || "").trim();
    if (!raw) {
        return "";
    }

    const normalizedOnlyDigits = normalizeArticleSearchInputFromUtils(raw);
    if (normalizedOnlyDigits.length >= 5) {
        return normalizedOnlyDigits;
    }

    const match = raw.match(/\b(\d{5,})\b/);
    return match ? String(match[1]).trim() : "";
}

function resolveArticleFromRow(row, indices) {
    return extractArticleFromText(row?.[ARTICLE_COLUMN_INDEX]);
}

function getAllArticlesFromSourceRows() {
    if (!Array.isArray(sourceRows) || sourceRows.length <= 1 || !sourceBaseIndices) {
        return [];
    }

    const unique = new Set();
    sourceRows.slice(1).forEach((row) => {
        const article = resolveArticleFromRow(row, sourceBaseIndices);
        if (article) {
            unique.add(article);
        }
    });

    return [...unique];
}

function getProxyUrls(url) {
    return [
        `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
        `https://corsproxy.io/?${encodeURIComponent(url)}`,
        `https://thingproxy.freeboard.io/fetch/${encodeURIComponent(url)}`,
    ];
}

async function fetchCsvText(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Не удалось загрузить CSV напрямую: ${response.status}`);
        }
        return await response.text();
    } catch (error) {
        console.warn("Прямая загрузка CSV не прошла, пробую CORS-прокси:", error);
    }

    const proxyUrls = getProxyUrls(url);
    let lastError = null;

    for (const proxyUrl of proxyUrls) {
        try {
            const proxyResponse = await fetch(proxyUrl);
            if (!proxyResponse.ok) {
                throw new Error(`Не удалось загрузить CSV через прокси ${proxyUrl}: ${proxyResponse.status}`);
            }
            return await proxyResponse.text();
        } catch (proxyError) {
            console.warn(proxyError);
            lastError = proxyError;
        }
    }

    throw lastError || new Error("Не удалось загрузить CSV через доступные прокси.");
}

async function fetchLocalCsv() {
    try {
        const response = await fetch(LOCAL_CSV_PATH);
        if (!response.ok) {
            throw new Error(`Не удалось загрузить локальный CSV: ${response.status}`);
        }
        return await response.text();
    } catch (error) {
        console.warn("Не удалось загрузить локальный CSV:", error);
        return null;
    }
}

function saveCsvCache(text) {
    const cacheEntry = {
        content: text,
        timestamp: Date.now(),
    };

    try {
        localStorage.setItem(CSV_CACHE_KEY, JSON.stringify(cacheEntry));
    } catch (error) {
        console.warn("Не удалось сохранить кеш CSV:", error);
    }
}

function loadCsvCache() {
    try {
        const raw = localStorage.getItem(CSV_CACHE_KEY);
        if (!raw) {
            return null;
        }

        const entry = JSON.parse(raw);
        if (!entry || typeof entry !== "object") {
            return null;
        }

        if (Date.now() - entry.timestamp > CSV_CACHE_TTL) {
            return null;
        }

        return typeof entry.content === "string" ? entry.content : null;
    } catch (error) {
        console.warn("Не удалось загрузить кеш CSV:", error);
        return null;
    }
}

function buildItem(row, indices) {
    return buildItemModule(row, indices);
}

function renderCategoryList(filter = "") {
    dom.categoryList.innerHTML = "";
    const normalizedFilter = filter.toString().trim().toLowerCase();

    const visibleCategories = [CATEGORY_ALL, ...categories].filter((category) =>
        category.toLowerCase().includes(normalizedFilter)
    );

    visibleCategories.forEach((category) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "category-item";
        item.dataset.category = category;
        item.textContent = category === CATEGORY_ALL ? "Все" : category;
        item.classList.toggle("active", activeCategory === category);
        dom.categoryList.append(item);
    });
}

function createCategoryList(uniqueCategories) {
    categories = uniqueCategories;
    renderCategoryList();
}

function updateCategoryActiveState() {
    const buttons = dom.categoryList.querySelectorAll(".category-item");
    buttons.forEach((button) => {
        const category = button.dataset.category;
        button.classList.toggle("active", activeCategory === category);
    });
}

function createStars(count) {
    if (!count) {
        return "Нет рейтинга";
    }

    const full = "⭐".repeat(count);
    const empty = "☆".repeat(5 - count);

    return `${full}${empty}`;
}

function createCard(item) {
    const clone = dom.template.content.cloneNode(true);
    const card = clone.querySelector(".card");
    const image = clone.querySelector(".photo");
    const titleEl = clone.querySelector(".card-title");
    const priceEl = clone.querySelector(".card-price");
    const articleEl = clone.querySelector(".card-article");
    const stockInfoEl = clone.querySelector(".card-stock-info");
    const modelEl = clone.querySelector(".card-model");
    const starsEl = clone.querySelector(".card-stars");
    const stockRecord = getStockRecordByArticle(item.article);
    // compute display stars: prefer explicit percent (item.percent) when available
    let display = 0;
    if (typeof item.percent === 'number') {
        // percent interpreted as 0..100 where 1% => 1 star
        // cap to 5 stars
        display = Math.max(0, Math.min(5, Math.round(item.percent)));
    } else {
        const raw = Number(item.stars) || 0;
        if (raw > 5) {
            // assume 0-100 percent stored in stars (fallback)
            display = Math.round(Math.min(100, raw) / 20);
        } else if (raw > 0 && raw <= 1) {
            display = Math.round(raw * 5);
        } else {
            display = Math.round(raw);
        }
        display = Math.max(0, Math.min(5, display));
    }

    card.classList.add(`stars${display}`);
    // render stars inside spans so we can style filled and hollow stars separately
    const filledStars = '★'.repeat(display);
    const hollowStars = '☆'.repeat(5 - display);
    const starsHtml = `<span class="stars-text">${filledStars}</span><span class="stars-hollow">${hollowStars}</span>`;
    starsEl.innerHTML = starsHtml;
    // placeholder SVG data URI (inline) to use when image missing or fails to load
    const placeholderSvg = encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800">'
        + '<rect width="100%" height="100%" fill="#0f1724"/>'
        + '<g fill="#cbd5e1" opacity="0.9">'
        + '<rect x="80" y="180" width="640" height="420" rx="20"/>'
        + '<circle cx="200" cy="400" r="70"/>'
        + '</g>'
        + '<text x="50%" y="90%" fill="#8b9bb0" font-size="36" font-family="Inter, Arial, sans-serif" text-anchor="middle">Нет фото</text>'
        + '</svg>'
    );
    const placeholder = `data:image/svg+xml;utf8,${placeholderSvg}`;

    image.src = item.image || placeholder;
    image.alt = item.title;

    image.addEventListener('error', () => {
        if (image.src !== placeholder) {
            image.src = placeholder;
        }
        image.classList.add('no-photo');
    });
    image.addEventListener('load', () => {
        image.classList.remove('no-photo');
    });
    titleEl.textContent = item.title;
    priceEl.textContent = `Цена: ${formatMoneyKzt(stockRecord?.price)}`;
        articleEl.textContent = `Артикул: #${item.article}`;

    priceEl.title = stockRecord
        ? `Остаток: ${Number.isFinite(Number(stockRecord.count)) ? Number(stockRecord.count) : 0}`
        : "Цена и остатки будут доступны после загрузки в личном кабинете";

    if (stockInfoEl) {
        const count = Number.isFinite(Number(stockRecord?.count)) ? Number(stockRecord.count) : 0;
        stockInfoEl.textContent = count > 0 ? String(count) : "i";
        stockInfoEl.title = stockRecord
            ? `Показать остатки (${count})`
            : "Нет данных по остаткам. Обновите в личном кабинете";
    }

    modelEl.textContent = item.category;

    articleEl.addEventListener("click", (event) => {
        event.stopPropagation();
    });

    articleEl.addEventListener("dblclick", (event) => {
        event.preventDefault();
        event.stopPropagation();

        const url = buildSulpakCharacteristicsUrl(item.article);
        if (!url) {
            return;
        }

        saveQuickReturnState();
        window.location.assign(url);
    });

    if (stockInfoEl) {
        stockInfoEl.addEventListener("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();

            const region = getSelectedRegionValue();
            const { cityId, cityName } = getSelectedCityContext();
            if (!region || !cityId) {
                setProfileStatus("Выберите регион и магазин в личном кабинете.", "error");
                return;
            }

            stockInfoEl.disabled = true;
            const previousText = stockInfoEl.textContent;
            stockInfoEl.textContent = "...";

            try {
                const savedUserName = loadSavedUserName();
                const stockRecord = await fetchStockForArticle(cityId, cityName, item.article, {
                    userId: savedUserName || "anonymous",
                });
                const regionEntry = ensureCurrentRegionEntry();
                if (regionEntry) {
                    regionEntry.items[item.article] = stockRecord;
                    regionEntry.updatedAt = Date.now();
                    saveStockCache();
                }
                updateRegionUpdatedAtLabel();
                renderCards();
                showStockInfoModal(item, stockRecord);
            } catch (error) {
                console.warn(`Ошибка загрузки карточки остатка для ${item.article}:`, error);
                setProfileStatus(`Не удалось загрузить остатки по товару #${item.article}.`, "error");
                showStockInfoModal(item);
            } finally {
                stockInfoEl.disabled = false;
                stockInfoEl.textContent = previousText;
            }
        });
    }

    card.addEventListener("click", () => {
        if (item.image) {
            openViewerWithImage(item.image, item.title);
        }
    });

    return clone;
}

function updateSummary(total) {
    const filters = [];

    if (activeCategory !== CATEGORY_ALL) {
        filters.push(`Категория: ${activeCategory}`);
    }

    if (activeStars) {
        filters.push(`Звезды: ${activeStars}%`);
    }

    if (searchQuery) {
        filters.push(`Поиск: «${searchQuery}»`);
    }

    if (loadWarning) {
        filters.push(loadWarning);
    }

    dom.resultCount.textContent = `Найдено товаров: ${total}`;
    dom.activeFilters.textContent = filters.join(" • ");
}

function filterItems() {
    return items.filter((item) => {
        const stockRecord = getStockRecordByArticle(item.article);

        if (hideZeroPrice && stockRecord && Number(stockRecord.price || 0) <= 0) {
            return false;
        }

        if (hideNoStock) {
            // If no stock data exists for article, treat it as "no stock" and hide.
            if (!stockRecord) {
                return false;
            }

            if (Number(stockRecord.count || 0) <= 0) {
                return false;
            }
        }

        if (activeCategory !== CATEGORY_ALL && item.category !== activeCategory) {
            return false;
        }

        if (activeStars) {
            // prefer explicit percent matching (column E), fallback to star count
            if (typeof item.percent === 'number') {
                if (Number(item.percent) !== Number(activeStars)) {
                    return false;
                }
            } else {
                if (Number(item.stars) !== Number(activeStars)) {
                    return false;
                }
            }
        }

        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            return item.title.toLowerCase().includes(query)
                || item.article.toLowerCase().includes(query)
                || item.category.toLowerCase().includes(query);
        }

        return true;
    });
}

function renderCards() {
    const matched = filterItems();

    dom.grid.innerHTML = "";

    if (!matched.length) {
        const state = document.createElement("div");
        state.className = "empty-state";

        const title = document.createElement("div");
        title.className = "empty-title";
        title.textContent = !items.length && loadError ? loadError : "Товаров не найдено.";

        const description = document.createElement("div");
        description.className = "empty-text";
        description.textContent = "Попробуйте изменить поиск или очистить фильтры. Если для товара нет фото, он может не отображаться.";

        state.append(title, description);
        dom.grid.append(state);

        updateSummary(0);
        return;
    }

    matched.forEach((item) => {
        dom.grid.append(createCard(item));
    });

    updateSummary(matched.length);
}

function updateStarsButtons() {
    const buttons = dom.stars.querySelectorAll(".star");
    buttons.forEach((button) => {
        const value = Number(button.dataset.stars || 0);
        button.classList.toggle("active", value <= activeStars && activeStars > 0);
        button.textContent = value <= activeStars ? "★" : "☆";
    });
}

function updateCategoryButtons() {
    updateCategoryActiveState();
}

function openCategoryDrawer() {
    closeMonthDrawer();
    dom.categoryDrawer.classList.remove("hidden");
    dom.categoryDrawer.setAttribute("aria-hidden", "false");
    document.body.classList.add("drawer-open");
}

function closeCategoryDrawer() {
    dom.categoryDrawer.classList.add("hidden");
    dom.categoryDrawer.setAttribute("aria-hidden", "true");
    if (dom.monthDrawer?.classList.contains("hidden")) {
        document.body.classList.remove("drawer-open");
    }
}

function openMonthDrawer() {
    closeCategoryDrawer();
    dom.monthDrawer.classList.remove("hidden");
    dom.monthDrawer.setAttribute("aria-hidden", "false");
    document.body.classList.add("drawer-open");
}

function closeMonthDrawer() {
    dom.monthDrawer.classList.add("hidden");
    dom.monthDrawer.setAttribute("aria-hidden", "true");
    if (dom.categoryDrawer?.classList.contains("hidden")) {
        document.body.classList.remove("drawer-open");
    }
}

function resetAllFilters() {
    activeCategory = CATEGORY_ALL;
    activeStars = 0;
    searchQuery = "";

    if (dom.search) {
        dom.search.value = "";
    }

    activeMonthColumn = DEFAULT_MONTH_COLUMN_INDEX;
    rebuildItemsFromSourceRows();
    syncMonthSelector();
    updateCategoryButtons();
    updateStarsButtons();
    closeCategoryDrawer();
    closeMonthDrawer();
}

function bindEvents() {
    dom.search.addEventListener("input", (event) => {
        const normalized = normalizeArticleSearchInputFromUtils(event.target.value);
        if (event.target.value !== normalized) {
            event.target.value = normalized;
        }
        searchQuery = normalized;
        renderCards();
    });

    if (dom.monthToggle) {
        dom.monthToggle.addEventListener("click", openMonthDrawer);
    }
    if (dom.resetFiltersBtn) {
        dom.resetFiltersBtn.addEventListener("click", resetAllFilters);
    }
    if (dom.closeMonthDrawer) {
        dom.closeMonthDrawer.addEventListener("click", closeMonthDrawer);
    }
    if (dom.monthDrawerBackdrop) {
        dom.monthDrawerBackdrop.addEventListener("click", closeMonthDrawer);
    }

    if (dom.monthList) {
        dom.monthList.addEventListener("click", (event) => {
            const button = event.target.closest(".month-item");
            if (!button) {
                return;
            }

            activeMonthColumn = Number(button.dataset.monthIndex || -1);
            if (dom.search && dom.search.value) {
                dom.search.value = "";
            }
            searchQuery = "";
            rebuildItemsFromSourceRows();
            syncMonthSelector();
            closeMonthDrawer();
        });
    }

    dom.categoryToggle.addEventListener("click", openCategoryDrawer);
    dom.closeCategoryDrawer.addEventListener("click", closeCategoryDrawer);
    dom.drawerBackdrop.addEventListener("click", closeCategoryDrawer);

    dom.categoryList.addEventListener("click", (event) => {
        const button = event.target.closest(".category-item");
        if (!button) {
            return;
        }

        activeCategory = button.dataset.category || CATEGORY_ALL;
        updateCategoryButtons();
        renderCards();
        closeCategoryDrawer();
    });

    dom.stars.addEventListener("click", (event) => {
        const button = event.target.closest(".star");
        if (!button) {
            return;
        }

        const selectedValue = Number(button.dataset.stars || 0);
        if (activeStars < selectedValue) {
            // increase selection
            activeStars = selectedValue;
        } else if (activeStars === selectedValue) {
            // decrease by one (toggle the clicked star off)
            activeStars = Math.max(0, selectedValue - 1);
        } else {
            // clicked a lower star than current selection -> set to that value
            activeStars = selectedValue;
        }

        updateStarsButtons();
        renderCards();
    });

    dom.mainContent.addEventListener("click", () => {
        if (!dom.categoryDrawer.classList.contains("hidden")) {
            closeCategoryDrawer();
        }
        if (!dom.monthDrawer.classList.contains("hidden")) {
            closeMonthDrawer();
        }
    });

    dom.search.addEventListener("focus", () => {
        if (!dom.categoryDrawer.classList.contains("hidden")) {
            closeCategoryDrawer();
        }
        if (!dom.monthDrawer.classList.contains("hidden")) {
            closeMonthDrawer();
        }
    });

    dom.viewerBackground.addEventListener("click", hideViewer);
    dom.viewerImage.addEventListener("click", hideViewer);
    if (dom.viewerClose) {
        dom.viewerClose.addEventListener("click", hideViewer);
    }
    dom.scrollTop.addEventListener("click", () => {
        window.scrollTo({ top: 0, behavior: "smooth" });
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            closeCategoryDrawer();
            closeMonthDrawer();
            hideViewer();
            stopQrScanner();
            closeProfileModal();
            closeStockInfoModal();
        }
    });

    if (dom.currentUser) {
        dom.currentUser.addEventListener("click", openProfileModal);
        dom.currentUser.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openProfileModal();
            }
        });
    }

    if (dom.profileRegion) {
        dom.profileRegion.addEventListener("change", async () => {
            syncProfileCitySelect();
            saveProfileSelection(getSelectedRegionValue(), dom.profileCity?.value || "");
            updateRegionUpdatedAtLabel();

            const cachedRegion = getCurrentRegionEntry();
            if (cachedRegion?.updatedAt) {
                setProfileStatus("Остатки загружены.", "ok");
            } else {
                setProfileStatus("Синхронизация с сервером...", "");
            }

            renderCards();
            try {
                await syncCurrentRegionStock({ forceFull: false, silent: false });
            } catch (error) {
                setProfileStatus(`Ошибка синхронизации: ${error.message || error}`, "error");
            }
            // Обновим кнопку профиля (имя + город)
            try { renderCurrentUserName(loadSavedUserName()); } catch (e) { }
        });
    }

    if (dom.profileCity) {
        dom.profileCity.addEventListener("change", async () => {
            saveProfileSelection(getSelectedRegionValue(), dom.profileCity?.value || "");
            updateRegionUpdatedAtLabel();

            const cachedRegion = getCurrentRegionEntry();
            if (cachedRegion?.updatedAt) {
                setProfileStatus("Остатки загружены.", "ok");
            } else {
                setProfileStatus("Синхронизация с сервером...", "");
            }

            renderCards();
            try {
                await syncCurrentRegionStock({ forceFull: false, silent: false });
            } catch (error) {
                setProfileStatus(`Ошибка синхронизации: ${error.message || error}`, "error");
            }
            // Обновим кнопку профиля (имя + город)
            try { renderCurrentUserName(loadSavedUserName()); } catch (e) { }
        });
    }

    if (dom.hideZeroPrice) {
        dom.hideZeroPrice.addEventListener("change", () => {
            hideZeroPrice = Boolean(dom.hideZeroPrice.checked);
            saveProfileFilters();
            renderCards();
        });
    }

    if (dom.hideNoStock) {
        dom.hideNoStock.addEventListener("change", () => {
            hideNoStock = Boolean(dom.hideNoStock.checked);
            saveProfileFilters();
            renderCards();
        });
    }

    if (dom.refreshStockBtn) {
        dom.refreshStockBtn.addEventListener("click", refreshStockForAllItems);
    }

    if (dom.closeProfileModal) {
        dom.closeProfileModal.addEventListener("click", closeProfileModal);
    }

    if (dom.closeProfileFooterBtn) {
        dom.closeProfileFooterBtn.addEventListener("click", closeProfileModal);
    }

    if (dom.profileBackdrop) {
        dom.profileBackdrop.addEventListener("click", closeProfileModal);
    }

    if (dom.closeStockInfoModal) {
        dom.closeStockInfoModal.addEventListener("click", closeStockInfoModal);
    }

    if (dom.closeStockInfoFooterBtn) {
        dom.closeStockInfoFooterBtn.addEventListener("click", closeStockInfoModal);
    }

    if (dom.stockInfoBackdrop) {
        dom.stockInfoBackdrop.addEventListener("click", closeStockInfoModal);
    }

    window.addEventListener("pagehide", saveQuickReturnState);

    // QR Scanner setup
    const scanQrBtn = document.getElementById("scanQrBtn");
    const closeQrScannerBtn = document.getElementById("closeQrScanner");
    const stopQrScannerBtn = document.getElementById("stopQrScanner");

    scanQrBtn.addEventListener("click", startQrScanner);
    closeQrScannerBtn.addEventListener("click", stopQrScanner);
    stopQrScannerBtn.addEventListener("click", stopQrScanner);
}

// QR Scanner Functions
let qrStream = null;
let qrScannerActive = false;
let isFrontCamera = false; // Флаг для определения типа камеры

// PWA Install
let deferredPrompt = null;
const installBtn = document.getElementById("installBtn");
let installPromptInFlight = false;

// Логирование инициализации PWA
console.log('🔍 PWA Инициализация:');
console.log('installBtn:', !!installBtn);
console.log('Protocol:', window.location.protocol);

// Слушаем beforeinstallprompt для PWA установки
window.addEventListener("beforeinstallprompt", (e) => {
    console.log('✅ beforeinstallprompt event triggered!');
    e.preventDefault();
    deferredPrompt = e;
    showInstallButton();
});

// Логирование если beforeinstallprompt не срабатывает
window.addEventListener('load', () => {
    setTimeout(() => {
        if (!deferredPrompt) {
            console.warn('⚠️ beforeinstallprompt не был срабатыван!');
            console.warn('Возможные причины:');
            console.warn('- Используется HTTP вместо HTTPS (нужен localhost или https)');
            console.warn('- Service Worker не регистрирован');
            console.warn('- Браузер не поддерживает PWA');
            console.warn('- Приложение уже установлено');
        }
    }, 2000);
});

function showInstallButton() {
    console.log('📥 Показываю кнопку Install');
    if (installBtn) {
        installBtn.classList.remove("hidden");
    }
}

function hideInstallButton() {
    if (installBtn) {
        installBtn.classList.add("hidden");
    }
}

async function triggerInstallPrompt() {
    if (!deferredPrompt || installPromptInFlight) {
        console.warn("⚠️ Системный install prompt сейчас недоступен");
        hideInstallButton();
        return;
    }

    installPromptInFlight = true;
    installBtn?.setAttribute("disabled", "disabled");

    try {
        await deferredPrompt.prompt();
        const choiceResult = await deferredPrompt.userChoice;
        console.log("📱 Результат установки:", choiceResult.outcome);
    } catch (error) {
        console.error("❌ Ошибка показа install prompt:", error);
    } finally {
        deferredPrompt = null;
        installPromptInFlight = false;
        installBtn?.removeAttribute("disabled");
        hideInstallButton();
    }
}

// Обработчик клика на кнопку установки
if (installBtn) {
    installBtn.addEventListener("click", () => {
        triggerInstallPrompt();
    });
}

window.addEventListener("appinstalled", () => {
    console.log("✅ Приложение установлено");
    deferredPrompt = null;
    hideInstallButton();
});

function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
        || window.innerWidth <= 650;
}

async function startQrScanner() {
    if (!isMobileDevice()) {
        alert("QR сканер доступен только на мобильных устройствах.");
        return;
    }

    const qrScannerModal = document.getElementById("qrScannerModal");
    const qrVideo = document.getElementById("qrVideo");
    const qrStatus = document.getElementById("qrStatus");

    qrScannerModal.classList.remove("hidden");
    qrScannerActive = true;
    qrStatus.textContent = "Инициализация камеры...";

    try {
        // Пробуем с основными параметрами
        const constraints = {
            video: {
                facingMode: "environment",
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: false
        };

        qrStream = await navigator.mediaDevices.getUserMedia(constraints);
        qrVideo.srcObject = qrStream;
        
        // Логирование параметров камеры и видео
        const videoTrack = qrStream.getVideoTracks()[0];
        const settings = videoTrack.getSettings();
        isFrontCamera = settings.facingMode === 'user'; // Проверяем тип камеры
        
        // Применяем зеркало в CSS только для фронтальной камеры
        if (isFrontCamera) {
            qrVideo.style.transform = 'scaleX(-1)';
            console.log('🔄 Применено зеркало для фронтальной камеры');
        } else {
            qrVideo.style.transform = 'none';
            console.log('✅ Зеркало отключено для основной камеры');
        }
        
        console.log('📹 Параметры камеры:');
        console.log('facingMode:', settings.facingMode);
        console.log('Тип камеры:', isFrontCamera ? '📱 Фронтальная (selfie)' : '📸 Основная (задняя)');
        console.log('width:', settings.width);
        console.log('height:', settings.height);
        
        // Убедимся что видео воспроизводится
        qrVideo.onloadedmetadata = function() {
            console.log('📺 Видео метаданные загружены:');
            console.log('videoWidth:', qrVideo.videoWidth);
            console.log('videoHeight:', qrVideo.videoHeight);
            qrVideo.play().catch(err => {
                console.error("Ошибка при воспроизведении видео:", err);
                qrStatus.textContent = "Ошибка воспроизведения видео.";
            });
        };
        
        qrStatus.textContent = "Наведите камеру на QR код...";
        scanQrCode();
    } catch (error) {
        console.error("Ошибка доступа к камере:", error);
        let errorMsg = "Не удалось открыть камеру.";
        
        if (error.name === "NotAllowedError") {
            errorMsg = "Разрешение на доступ к камере отклонено. Проверьте настройки браузера.";
        } else if (error.name === "NotFoundError") {
            errorMsg = "Камера не найдена на устройстве.";
        } else if (error.name === "NotReadableError") {
            errorMsg = "Камера занята другим приложением.";
        } else if (error.name === "SecurityError") {
            errorMsg = "Требуется защищённое соединение (HTTPS) для доступа к камере.";
        }
        
        qrStatus.textContent = errorMsg;
        qrScannerActive = false;
    }
}

function stopQrScanner() {
    const qrScannerModal = document.getElementById("qrScannerModal");
    const qrVideo = document.getElementById("qrVideo");

    qrScannerActive = false;

    if (qrStream) {
        qrStream.getTracks().forEach(track => track.stop());
        qrStream = null;
    }

    qrVideo.srcObject = null;
    qrScannerModal.classList.add("hidden");
}

function scanQrCode() {
    const qrVideo = document.getElementById("qrVideo");
    const qrStatus = document.getElementById("qrStatus");
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    let noDataFrames = 0;

    const scanInterval = setInterval(() => {
        if (!qrScannerActive) {
            clearInterval(scanInterval);
            return;
        }

        // Проверяем что видео загружено и готово
        if (qrVideo.readyState === qrVideo.HAVE_ENOUGH_DATA) {
            noDataFrames = 0;
            
            try {
                canvas.width = qrVideo.videoWidth;
                canvas.height = qrVideo.videoHeight;
                
                if (canvas.width === 0 || canvas.height === 0) {
                    return;
                }
                
                // Зеркально отражаем только для фронтальной камеры
                if (isFrontCamera) {
                    ctx.save();
                    ctx.scale(-1, 1);
                    ctx.drawImage(qrVideo, -canvas.width, 0, canvas.width, canvas.height);
                    ctx.restore();
                } else {
                    // Основная (задняя) камера - без зеркала
                    ctx.drawImage(qrVideo, 0, 0, canvas.width, canvas.height);
                }
                
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const code = jsQR(imageData.data, imageData.width, imageData.height);

                if (code) {
                    const articleId = extractArticleFromUrl(code.data);
                    if (articleId) {
                        insertArticleToSearch(articleId);
                        stopQrScanner();
                        clearInterval(scanInterval);
                    } else {
                        qrStatus.textContent = "QR код не содержит валидную ссылку. Попробуйте ещё.";
                    }
                }
            } catch (err) {
                console.error("Ошибка при сканировании QR:", err);
            }
        } else {
            noDataFrames++;
            if (noDataFrames > 30) {
                qrStatus.textContent = "Видео не загружается. Проверьте разрешения камеры.";
            }
        }
    }, 300);
}

function extractArticleFromUrl(url) {
    // Ожидаем URL формата: https://www.sulpak.kz/g/460033?S55
    // Нужно извлечь 460033
    const match = url.match(/\/g\/(\d+)/);
    return match ? match[1] : null;
}

function insertArticleToSearch(articleId) {
    const searchInput = document.getElementById("search");
    const normalizedArticleId = normalizeArticleSearchInputFromUtils(articleId);
    searchInput.value = normalizedArticleId;
    // Триггер фильтрации
    searchQuery = normalizedArticleId;
    renderCards();
}

function buildSulpakCharacteristicsUrl(article) {
    return buildSulpakCharacteristicsUrlModule(article);
}

function openViewerWithImage(imageUrl, imageAlt) {
    dom.viewerImage.src = imageUrl;
    dom.viewerImage.alt = imageAlt || "";
    dom.viewerImage.classList.add("active");

    dom.viewer.classList.remove("hidden");
}

function openViewerWithFrame(url) {
    const safeUrl = String(url || "").trim();
    if (!safeUrl) {
        return;
    }

    // Для ссылок характеристик открываем страницу напрямую в текущей вкладке.
    // Это исключает iframe-ошибку и не конфликтует с просмотром фото карточки.
    window.location.assign(safeUrl);
}


function hideViewer() {
    dom.viewer.classList.add("hidden");
    dom.viewerImage.classList.remove("active");
    dom.viewerImage.src = "";
    dom.viewerImage.alt = "";
}


async function loadProducts() {
    dom.resultCount.textContent = "Загрузка товаров...";
    dom.activeFilters.textContent = "";

    loadError = null;
    loadWarning = null;
    let raw = null;
    const cached = loadCsvCache();

    const sheetUrl = getEffectiveSheetUrl();

    if (sheetUrl) {
        try {
            raw = await fetchCsvText(sheetUrl);
            saveCsvCache(raw);
        } catch (fetchError) {
            console.warn("Ошибка при загрузке удалённого CSV:", fetchError);
            raw = cached;

            if (!raw) {
                raw = await fetchLocalCsv();
                if (raw) {
                    saveCsvCache(raw);
                }
            }
        }
    } else {
        console.warn("Ссылка Google Sheets не задана, использую кеш/локальный fallback.");
        raw = cached;

        if (!raw) {
            raw = await fetchLocalCsv();
            if (raw) {
                saveCsvCache(raw);
            }
        }
    }

    if (!raw) {
        const message = "Не удалось загрузить CSV. Проверьте ссылку Google Sheets, подключение к интернету или добавьте fallback-файл public/products.csv.";
        loadError = message;
        dom.grid.textContent = message;
        dom.resultCount.textContent = "Ошибка загрузки товаров";
        dom.activeFilters.textContent = message;
        items = [];
        return;
    }

    const rows = parseCsvFromUtils(raw).filter((row) => row.length > 0);
    if (!rows.length) {
        const message = "CSV пустой или не удалось разобрать данные.";
        loadError = message;
        dom.grid.textContent = message;
        dom.resultCount.textContent = "Ошибка загрузки товаров";
        dom.activeFilters.textContent = message;
        items = [];
        return;
    }

    const headers = rows[0] || [];
    const baseIndices = {
        title: findColumnIndex(headers, ["sulpak article+name", "sulpak article + name", "sulpak article name", "sulpak article", "name", "product name"]),
        article: ARTICLE_COLUMN_INDEX,
        category: findColumnIndex(headers, ["category", "категория", "brand"]),
    };

    const warnings = [];
    if (!rows.slice(1).some((row) => extractArticleFromText(row?.[ARTICLE_COLUMN_INDEX]))) {
        const message = "В колонке C не найдены артикулы. Проверьте данные CSV.";
        loadError = message;
        dom.grid.textContent = message;
        dom.resultCount.textContent = "Ошибка загрузки товаров";
        dom.activeFilters.textContent = message;
        items = [];
        return;
    }

    if (baseIndices.title === -1) {
        warnings.push("Колонка 'Sulpak Article+name' не найдена. Названия будут заменены на артикулы.");
    }

    if (baseIndices.category === -1) {
        warnings.push("Колонка категории не найдена. Все товары будут сгруппированы как 'Без категории'.");
    }

    sourceRows = rows;
    sourceBaseIndices = baseIndices;
    sourceWarnings = warnings;

    monthColumns = detectMonthColumns(headers);
    const defaultMonthColumn = monthColumns.some((month) => month.index === DEFAULT_MONTH_COLUMN_INDEX)
        ? DEFAULT_MONTH_COLUMN_INDEX
        : (monthColumns[0]?.index ?? -1);

    const hasPendingMonth = pendingQuickReturnMonthColumn !== null
        && monthColumns.some((month) => month.index === pendingQuickReturnMonthColumn);

    activeMonthColumn = hasPendingMonth
        ? pendingQuickReturnMonthColumn
        : defaultMonthColumn;

    pendingQuickReturnMonthColumn = null;
    syncMonthSelector();

    rebuildItemsFromSourceRows();
}

initAuthorization();
