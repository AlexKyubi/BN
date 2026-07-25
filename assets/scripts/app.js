const runtimeConfig =
    window.BN_CONFIG && typeof window.BN_CONFIG === "object"
        ? window.BN_CONFIG
        : {};

const GOOGLE_SHEET_URL = String(runtimeConfig.googleSheetUrl || "").trim();

const IMAGE_BASE_PATH = "images";
const CATEGORY_ALL = "all";
const CSV_CACHE_KEY = "bn_csv_cache";
const CSV_CACHE_TTL = 1000 * 60 * 60 * 6; // 6 часов
const LOCAL_CSV_PATH = "public/products.csv";
const AUTH_STORAGE_KEY = "bn_auth_ok_v1";
const AUTH_USER_NAME_KEY = "bn_user_name_v1";
const SHEET_URL_STORAGE_KEY = "bn_sheet_url_v1";
const AUTH_CONFIG = {
    defaultPassword: String(runtimeConfig.defaultPassword || "").trim(),
};

const dom = {
    grid: document.getElementById("grid"),
    search: document.getElementById("search"),
    stars: document.getElementById("stars"),
    resultCount: document.getElementById("resultCount"),
    activeFilters: document.getElementById("activeFilters"),
    viewer: document.getElementById("viewer"),
    viewerImage: document.getElementById("viewerImage"),
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
    authPassword: document.getElementById("authPassword"),
    authError: document.getElementById("authError"),
};

let items = [];
let categories = [];
let activeCategory = CATEGORY_ALL;
let activeStars = 0;
let searchQuery = "";
let loadError = null;
let loadWarning = null;
let appStarted = false;

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
    const url = String(value || "").trim();
    if (!url) {
        return false;
    }

    const pattern = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[^/]+\/export\?format=csv(&gid=\d+)?$/i;
    return pattern.test(url);
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

    dom.currentUser.textContent = `Пользователь: ${safeName}`;
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

function normalizeFullName(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function isValidFullName(value) {
    const normalized = normalizeFullName(value);
    return /^[A-Za-zА-Яа-яЁёІіЇїЄєҚқҢңҒғҮүҰұӨөҺһ-]+\s+[A-Za-zА-Яа-яЁёІіЇїЄєҚқҢңҒғҮүҰұӨөҺһ-]+(?:\s+[A-Za-zА-Яа-яЁёІіЇїЄєҚқҢңҒғҮүҰұӨөҺһ-]+)*$/.test(normalized);
}

function verifyCredentials(username, password) {
    if (!AUTH_CONFIG.defaultPassword) {
        return { ok: false, message: "Сервис не настроен: пароль входа не задан." };
    }

    if (!isValidFullName(username)) {
        return { ok: false, message: "Введите логин в формате: Фамилия Имя." };
    }

    if (password !== AUTH_CONFIG.defaultPassword) {
        return { ok: false, message: "Неверный пароль." };
    }

    return { ok: true, fullName: normalizeFullName(username) };
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
        const sheetUrl = (dom.authSheetUrl?.value || "").trim();
        const password = dom.authPassword?.value || "";

        clearAuthError();

        if (!username || !password || !sheetUrl) {
            setAuthError("Введите логин, ссылку таблицы и пароль.");
            return;
        }

        if (!isValidGoogleSheetCsvUrl(sheetUrl)) {
            setAuthError("Введите корректную CSV-ссылку Google Sheets (формат export?format=csv&gid=...).");
            return;
        }

        const verified = verifyCredentials(username, password);
        if (!verified.ok) {
            setAuthError(verified.message);
            return;
        }

        saveAuthorizationOnDevice(verified.fullName, sheetUrl);
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
    await loadProducts();
    renderCards();
}

function initAuthorization() {
    bindAuthorizationEvents();
    const savedUserName = loadSavedUserName();
    const savedSheetUrl = loadSavedSheetUrl() || GOOGLE_SHEET_URL;
    renderCurrentUserName(savedUserName);
    if (dom.authSheetUrl && savedSheetUrl) {
        dom.authSheetUrl.value = savedSheetUrl;
    }

    if (isAuthorizedOnDevice()) {
        hideAuthModal();
        startApp();
        return;
    }

    showAuthModal();
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

function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let insideQuote = false;

    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];

        if (insideQuote) {
            if (char === '"') {
                if (text[i + 1] === '"') {
                    cell += '"';
                    i += 1;
                } else {
                    insideQuote = false;
                }
            } else {
                cell += char;
            }
            continue;
        }

        if (char === '"') {
            insideQuote = true;
            continue;
        }

        if (char === ',') {
            row.push(cell);
            cell = "";
            continue;
        }

        if (char === '\r') {
            continue;
        }

        if (char === '\n') {
            row.push(cell);
            rows.push(row);
            row = [];
            cell = "";
            continue;
        }

        cell += char;
    }

    if (cell.length || row.length) {
        row.push(cell);
        rows.push(row);
    }

    return rows;
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
    const article = String(row[indices.article] || "").trim();

    // title: prefer columns C and D (brand + model). If empty, fall back to detected title column.
    const c = String(row[2] || "").trim();
    const d = String(row[3] || "").trim();
    let title = [c, d].filter(Boolean).join(' ').trim();
    if (!title && typeof indices.title === 'number' && indices.title >= 0) {
        title = String(row[indices.title] || "").trim();
    }

    // remove article from title if it appears there (avoid duplicating article)
    if (article) {
        try {
            const re = new RegExp("(?:#\\s*)?" + escapeRegExp(article), "gi");
            title = title.replace(re, "").replace(/\s{2,}/g, " ").trim();
        } catch (e) {
            // ignore regexp errors
        }
    }

    // category: prefer detected index, otherwise try column B (index 1)
    let category = "";
    if (typeof indices.category === 'number' && indices.category >= 0) {
        category = String(row[indices.category] || "").trim();
    }
    if (!category && row.length > 1) {
        category = String(row[1] || "").trim();
    }
    category = category || "Без категории";

    const rawRating = row[indices.rating] || "";
    const stars = parseRating(rawRating);
    const percent = parsePercent(rawRating);

    if (!article) {
        return null;
    }

    // ensure percent numeric: try fallback to column E (index 4) if parse failed
    let finalPercent = percent;
    if (finalPercent == null && row.length > 4) {
        const tryE = parsePercent(row[4]);
        if (tryE != null) finalPercent = tryE;
    }

    return {
        article,
        title: title || article,
        category,
        stars,
        percent: finalPercent,
        image: `${IMAGE_BASE_PATH}/${article}.webp`,
    };
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
    const articleEl = clone.querySelector(".card-article");
    const priceEl = clone.querySelector(".card-price");
    const modelEl = clone.querySelector(".card-model");
    const starsEl = clone.querySelector(".card-stars");
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
    articleEl.textContent = item.title;
    // show only article without percent
    priceEl.textContent = `#${item.article}`;
    modelEl.textContent = item.category;

    card.addEventListener("click", () => {
        if (item.image) {
            dom.viewerImage.src = item.image;
            dom.viewerImage.alt = item.title;
            dom.viewer.classList.remove("hidden");
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
    dom.categoryDrawer.classList.remove("hidden");
    dom.categoryDrawer.setAttribute("aria-hidden", "false");
    document.body.classList.add("drawer-open");
}

function closeCategoryDrawer() {
    dom.categoryDrawer.classList.add("hidden");
    dom.categoryDrawer.setAttribute("aria-hidden", "true");
    document.body.classList.remove("drawer-open");
}

function bindEvents() {
    dom.search.addEventListener("input", (event) => {
        searchQuery = event.target.value.trim();
        renderCards();
    });

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
    });

    dom.search.addEventListener("focus", () => {
        if (!dom.categoryDrawer.classList.contains("hidden")) {
            closeCategoryDrawer();
        }
    });

    dom.viewerBackground.addEventListener("click", hideViewer);
    dom.viewerImage.addEventListener("click", hideViewer);
    dom.scrollTop.addEventListener("click", () => {
        window.scrollTo({ top: 0, behavior: "smooth" });
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            closeCategoryDrawer();
            hideViewer();
            stopQrScanner();
        }
    });

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
const installModal = document.getElementById("installModal");
const installInstructions = document.getElementById("installInstructions");
const closeInstallModal = document.getElementById("closeInstallModal");
const confirmInstall = document.getElementById("confirmInstall");
const cancelInstall = document.getElementById("cancelInstall");
const modalBackdrop = installModal?.querySelector(".modal-backdrop");

// Логирование инициализации PWA
console.log('🔍 PWA Инициализация:');
console.log('installBtn:', !!installBtn);
console.log('installModal:', !!installModal);
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

function showInstallModal() {
    const userAgent = navigator.userAgent.toLowerCase();
    let instructions = "";
    
    if (userAgent.includes("chrome") && !userAgent.includes("edg")) {
        instructions = "<strong>Установка на Android:</strong><p>Нажмите кнопку <strong>\"Установить\"</strong> внизу. Приложение появится на главном экране.</p>";
        confirmInstall.textContent = "Установить";
        confirmInstall.style.display = "block";
    } else if (userAgent.includes("safari") && userAgent.includes("iphone")) {
        instructions = "<strong>Установка на iPhone:</strong><ol><li>Нажмите кнопку \"Поделиться\" (внизу экрана)</li><li>Выберите \"На экран Домой\"</li><li>Нажмите \"Добавить\"</li></ol><p>Приложение появится на главном экране!</p>";
        confirmInstall.style.display = "none";
    } else if (userAgent.includes("yabrowser")) {
        instructions = "<strong>Установка в Яндекс браузере:</strong><ol><li>Нажмите три точки (⋮) в меню</li><li>Выберите \"Добавить на гл. экран\"</li></ol><p>Ярлык приложения появится на главном экране.</p>";
        confirmInstall.style.display = "none";
    } else if (userAgent.includes("firefox")) {
        instructions = "<strong>Установка в Firefox:</strong><ol><li>Нажмите на иконку дома (⌂) в адресной строке</li><li>Выберите \"Добавить в Домой\"</li></ol>";
        confirmInstall.style.display = "none";
    } else {
        instructions = "<strong>Как установить приложение:</strong><p>В вашем браузере обычно есть опция добавления на главный экран. Поищите в меню браузера или нажмите значок общего доступа.</p>";
        confirmInstall.style.display = "none";
    }
    
    installInstructions.innerHTML = instructions;
    installModal.classList.remove("hidden");
}

// Обработчик клика на кнопку установки
if (installBtn) {
    installBtn.addEventListener("click", () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            deferredPrompt.userChoice.then((choiceResult) => {
                if (choiceResult.outcome === "accepted") {
                    console.log("Приложение установлено");
                }
                deferredPrompt = null;
                hideInstallButton();
                installModal.classList.add("hidden");
            });
        } else {
            // Если нет beforeinstallprompt, показываем инструкции
            showInstallModal();
        }
    });
}

// Закрытие модали
if (closeInstallModal) {
    closeInstallModal.addEventListener("click", () => {
        installModal.classList.add("hidden");
    });
}

if (cancelInstall) {
    cancelInstall.addEventListener("click", () => {
        installModal.classList.add("hidden");
    });
}

if (modalBackdrop) {
    modalBackdrop.addEventListener("click", () => {
        installModal.classList.add("hidden");
    });
}

if (confirmInstall) {
    confirmInstall.addEventListener("click", () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            deferredPrompt.userChoice.then((choiceResult) => {
                if (choiceResult.outcome === "accepted") {
                    console.log("Приложение установлено");
                }
                deferredPrompt = null;
                hideInstallButton();
                installModal.classList.add("hidden");
            });
        }
    });
}

function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
        || window.innerWidth <= 650;
}

// Fallback: показываем кнопку install на мобильных устройствах в любом случае
document.addEventListener('DOMContentLoaded', () => {
    if (isMobileDevice() && installBtn && !deferredPrompt) {
        console.log('📱 Мобильное устройство - показываю кнопку install');
        // Показываем кнопку даже если PWA не поддерживается, инструкции помогут
        setTimeout(() => {
            if (!deferredPrompt && installBtn.classList.contains('hidden')) {
                installBtn.classList.remove('hidden');
                console.log('📥 Кнопка install показана (fallback mode)');
            }
        }, 3000);
    }
});

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
    searchInput.value = articleId;
    // Триггер фильтрации
    searchQuery = articleId.toLowerCase();
    renderCards();
}


function hideViewer() {
    dom.viewer.classList.add("hidden");
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

    const rows = parseCsv(raw).filter((row) => row.length > 0);
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
    const indices = {
        title: findColumnIndex(headers, ["sulpak article+name", "sulpak article + name", "sulpak article name", "sulpak article", "name", "product name"]),
        article: findColumnIndex(headers, ["sulpak article", "article", "sulpak article+name", "sku", "artikul"]),
        category: findColumnIndex(headers, ["category", "категория", "brand"]),
        rating: findColumnIndex(headers, ["rating", "stars", "рейтинг", "оценка"]),
    };

    // fallback to column E (index 4) when rating column wasn't detected
    if (indices.rating === -1 && headers.length >= 5) {
        indices.rating = 4;
    }

    // If rating still not reliable, try auto-detecting a numeric percent column
    function detectPercentColumn(rows) {
        const counts = [];
        const total = rows.length - 1;
        for (let col = 0; col < headers.length; col++) {
            let good = 0;
            for (let r = 1; r < rows.length; r++) {
                const v = String(rows[r][col] || "").trim();
                if (!v) continue;
                const n = Number(v.replace('%', '').replace(',', '.'));
                if (!Number.isNaN(n) && n >= 0 && n <= 100) {
                    good++;
                }
            }
            counts[col] = good;
        }

        // choose column with most numeric percent-like values and at least 30% filled
        let best = -1;
        let bestCount = 0;
        for (let col = 0; col < counts.length; col++) {
            if (counts[col] > bestCount && counts[col] >= Math.ceil(total * 0.3)) {
                bestCount = counts[col];
                best = col;
            }
        }
        return best;
    }

    if (indices.rating === -1) {
        const detected = detectPercentColumn(rows);
        if (detected !== -1) {
            indices.rating = detected;
        }
    }

    const warnings = [];
    if (indices.article === -1) {
        const message = "Колонка 'Sulpak Article' не найдена в CSV. Нельзя определить товары без артикула.";
        loadError = message;
        dom.grid.textContent = message;
        dom.resultCount.textContent = "Ошибка загрузки товаров";
        dom.activeFilters.textContent = message;
        items = [];
        return;
    }

    if (indices.title === -1) {
        warnings.push("Колонка 'Sulpak Article+name' не найдена. Названия будут заменены на артикулы.");
    }

    if (indices.category === -1) {
        warnings.push("Колонка категории не найдена. Все товары будут сгруппированы как 'Без категории'.");
    }

    if (indices.rating === -1) {
        warnings.push("Колонка рейтинга не найдена. Все товары будут без звёзд.");
    }

    items = rows.slice(1)
        .map((row, index) => buildItem(row, indices, index + 2))
        .filter(Boolean);

    if (!items.length) {
        const message = warnings.length
            ? `CSV загружен, но не найдено данных товаров. ${warnings.join(" ")}`
            : "CSV загружен, но товары не найдены. Проверьте данные в файле.";
        loadError = message;
        dom.grid.textContent = message;
        dom.resultCount.textContent = "Ошибка загрузки товаров";
        dom.activeFilters.textContent = message;
        items = [];
        return;
    }

    if (warnings.length) {
        loadWarning = warnings.join(" ");
        dom.activeFilters.textContent = loadWarning;
    }

const categoryNames = [...new Set(items.map((item) => item.category))].sort((a, b) => a.localeCompare(b, "ru"));
        createCategoryList(categoryNames);
    updateStarsButtons();
}

initAuthorization();
