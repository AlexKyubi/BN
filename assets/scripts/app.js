/**
 * Главный модуль фронтенда: точка входа, которая связывает все модули между собой и вешает обработчики событий.
 *
 * Модули:
 * - config.js               runtime-конфигурация и константы
 * - dom.js                  карта DOM-элементов страницы
 * - state.js                общее изменяемое состояние приложения
 * - utils.js                мелкие переиспользуемые хелперы (строки, CSV, числа)
 * - quick-return.js         сохранение/восстановление состояния при быстром возврате
 * - auth/                   авторизация на устройстве и проверка ссылки Google Sheets на сервере
 * - catalog/                загрузка справочника и построение карточек с месячными процентами
 * - regions/                справочник регионов/городов личного кабинета
 * - stock/                  клиент прокси остатков, клиентский кеш, модалка с деталями остатков
 * - profile/                выбранный регион, режим наличия и статус синхронизации
 * - ui/                     сетка карточек, выдвижные панели, просмотрщик изображений
 * - pwa/                    установка PWA
 * - qr/                     сканер QR-кодов
 */

import { dom } from "./dom.js";
import { state } from "./state.js";
import { DASHBOARD_FAST_RETURN_KEY, DASHBOARD_RETURN_MARKER_KEY, DEFAULT_MONTH_COLUMN_INDEX, HIDE_NO_STOCK_STORAGE_KEY } from "./config.js";
import { normalizeCatalogSearchInput, normalizeGoogleSheetCsvUrl } from "./utils.js";
import {
    clearAuthError,
    clearAuthorizationOnDevice,
    hideAuthModal,
    isAuthorizedOnDevice,
    loadSavedSheetUrl,
    loadSavedUserName,
    renderCurrentUserName,
    saveAuthorizationOnDevice,
    setAuthError,
    showAuthModal,
    verifyCredentials,
} from "./auth/device-auth.js";
import { validateSheetUrlWithServer } from "./auth/sheet-auth.js";
import { loadProducts, rebuildItemsFromCatalog } from "./catalog/catalog-source.js";
import { closeStockInfoModal } from "./stock/stock-info-modal.js";
import { syncCurrentRegionStock } from "./stock/stock-sync.js";
import { initProfileCabinet, loadProfileFilters } from "./profile/profile-cabinet.js";
import { hasUsableQuickReturnState, hydrateCatalogUiState, hydrateQuickReturnState, saveCatalogUiState, saveQuickReturnState } from "./quick-return.js";
import { closeCategoryDrawer, closeMonthDrawer, openCategoryDrawer, openMonthDrawer, syncMonthSelector } from "./ui/drawers.js";
import { createCategoryList, renderCards, updateCategoryButtons, updateSortPriceButton, updateStarsButtons, updateStockFilterButton } from "./ui/grid.js";
import { hideViewer } from "./ui/viewer.js";
import { initPwaInstall } from "./pwa/install.js";
import { initReportPasswordModal } from "./ui/password-prompt.js";
import { initQrScanner, stopQrScanner } from "./qr/scanner.js";
import { initVersionManager } from "./update/version-manager.js";
import { initSaleDialog } from "./sales/sale-dialog.js";
import { initThemeManager } from "./theme/theme-manager.js";

/** Позволяет тестам читать текущий список товаров из консоли/автотестов. */
window.__BN_TEST__ = {
    get items() {
        return state.items;
    },
};

/** Запускает приложение один раз и собирает каталог с минимальным количеством перерисовок. */
async function startApp({ fastReturn = false } = {}) {
    if (state.appStarted) {
        return;
    }

    state.appStarted = true;
    bindEvents();
    hydrateCatalogUiState();
    // Настройки меняются на dashboard, поэтому читаем их до возможного
    // быстрого возврата, который не запускает полную инициализацию профиля.
    loadProfileFilters();
    updateSortPriceButton();
    updateStockFilterButton();

    const restored = hydrateQuickReturnState();
    if (restored) {
        createCategoryList(state.categories);
        updateCategoryButtons();
        updateStarsButtons();
        updateSortPriceButton();
        updateStockFilterButton();
        syncMonthSelector();
        renderCards();
    }

    // Возврат из кабинета восстанавливает тот же DOM-снимок без повторной загрузки каталога
    // и остатков. Обычный запуск/перезагрузка по-прежнему получает свежие данные.
    if (fastReturn && restored) {
        saveCatalogUiState();
        return;
    }

    // Загрузка справочника и каталога идёт параллельно.
    const profilePromise = initProfileCabinet({ syncStock: false });

    const productsPromise = loadProducts({ render: !restored });
    let stockReady = false;
    const stockPromise = profilePromise.then(async () => {
        try {
            await syncCurrentRegionStock({ forceFull: false, silent: true, render: false });
        } catch (error) {
            console.warn("Не удалось выполнить стартовую синхронизацию региона:", error);
        } finally {
            stockReady = true;
        }
    });

    await productsPromise;
    const stockWasReadyForFirstRender = stockReady;
    await stockPromise;
    if (restored || !stockWasReadyForFirstRender) {
        updateCategoryButtons();
        updateStarsButtons();
        updateSortPriceButton();
        updateStockFilterButton();
        renderCards();
    }
    saveCatalogUiState();
}

/** Сбрасывает все активные фильтры каталога к значениям по умолчанию. */
function resetAllFilters() {
    state.activeCategory = "all";
    state.activeStars = 0;
    state.searchQuery = "";
    state.priceSort = "none";
    state.hideNoStock = false;
    try { localStorage.setItem(HIDE_NO_STOCK_STORAGE_KEY, "0"); } catch (error) { console.warn("Не удалось сбросить режим остатков:", error); }

    if (dom.search) {
        dom.search.value = "";
    }

    state.activeMonthColumn = DEFAULT_MONTH_COLUMN_INDEX;
    rebuildItemsFromCatalog();
    syncMonthSelector();
    updateCategoryButtons();
    updateStarsButtons();
    updateSortPriceButton();
    updateStockFilterButton();
    closeCategoryDrawer();
    closeMonthDrawer();
    saveCatalogUiState();
}

/** Подключает обработчик отправки формы авторизации. */
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

        const sheetUrl = normalizeGoogleSheetCsvUrl(rawSheetUrl);
        if (!sheetUrl) {
            setAuthError("Введите корректную ссылку Google Sheets (edit/export). Сервис сам преобразует её для проверки.");
            return;
        }

        if (dom.authSheetUrl) {
            dom.authSheetUrl.value = sheetUrl;
        }

        const verified = verifyCredentials(username);
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

/** Проверяет сохранённую авторизацию при загрузке страницы и либо стартует приложение, либо показывает форму входа. */
async function initAuthorization() {
    bindAuthorizationEvents();
    const savedUserName = loadSavedUserName();
    const savedSheetUrl = loadSavedSheetUrl();
    renderCurrentUserName(savedUserName);
    if (dom.authSheetUrl && savedSheetUrl) {
        dom.authSheetUrl.value = savedSheetUrl;
    }

    if (isAuthorizedOnDevice()) {
        let fastReturn = false;
        try {
            fastReturn = sessionStorage.getItem(DASHBOARD_FAST_RETURN_KEY) === "1"
                && hasUsableQuickReturnState();
            sessionStorage.removeItem(DASHBOARD_FAST_RETURN_KEY);
        } catch (error) {
            console.warn("Не удалось проверить быстрый возврат:", error);
        }

        if (fastReturn) {
            hideAuthModal();
            startApp({ fastReturn: true });
            return;
        }

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

/** Навешивает все обработчики событий интерфейса (поиск, фильтры, модалки, drag/keyboard). */
function bindEvents() {
    dom.search.addEventListener("input", (event) => {
        const normalized = normalizeCatalogSearchInput(event.target.value);
        if (event.target.value !== normalized) {
            event.target.value = normalized;
        }
        state.searchQuery = normalized;
        renderCards();
        saveCatalogUiState();
    });

    if (dom.monthToggle) {
        dom.monthToggle.addEventListener("click", openMonthDrawer);
    }
    if (dom.resetFiltersBtn) {
        dom.resetFiltersBtn.addEventListener("click", resetAllFilters);
    }
    if (dom.sortPriceBtn) {
        dom.sortPriceBtn.addEventListener("click", () => {
            // Первое нажатие — по убыванию, повторное — по возрастанию.
            state.priceSort = state.priceSort === "desc" ? "asc" : "desc";
            updateSortPriceButton();
            renderCards();
            saveCatalogUiState();
        });
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

            state.activeMonthColumn = Number(button.dataset.monthIndex || -1);
            if (dom.search && dom.search.value) {
                dom.search.value = "";
            }
            state.searchQuery = "";
            rebuildItemsFromCatalog();
            syncMonthSelector();
            closeMonthDrawer();
            saveCatalogUiState();
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

        state.activeCategory = button.dataset.category || "all";
        updateCategoryButtons();
        renderCards();
        closeCategoryDrawer();
        saveCatalogUiState();
    });

    dom.stars.addEventListener("click", (event) => {
        const button = event.target.closest(".star");
        if (!button) {
            return;
        }

        const selectedValue = Number(button.dataset.stars || 0);
        if (state.activeStars < selectedValue) {
            state.activeStars = selectedValue;
        } else if (state.activeStars === selectedValue) {
            state.activeStars = Math.max(0, selectedValue - 1);
        } else {
            state.activeStars = selectedValue;
        }

        updateStarsButtons();
        renderCards();
        saveCatalogUiState();
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
            closeStockInfoModal();
        }
    });

    if (dom.currentUser) {
        const openDashboard = () => {
            saveQuickReturnState();
            try {
                sessionStorage.setItem(DASHBOARD_RETURN_MARKER_KEY, "1");
            } catch (error) {
                console.warn("Не удалось сохранить маршрут возврата:", error);
            }
            window.location.assign("dashboard.html");
        };
        dom.currentUser.addEventListener("click", openDashboard);
    }
    if (dom.stockFilterBtn) {
        dom.stockFilterBtn.addEventListener("click", () => {
            state.hideNoStock = !state.hideNoStock;
            try { localStorage.setItem(HIDE_NO_STOCK_STORAGE_KEY, state.hideNoStock ? "1" : "0"); } catch (error) { console.warn("Не удалось сохранить режим остатков:", error); }
            updateStockFilterButton();
            renderCards();
            saveCatalogUiState();
        });
    }

    if (dom.closeStockInfoModal) {
        dom.closeStockInfoModal.addEventListener("click", closeStockInfoModal);
    }

    if (dom.stockInfoBackdrop) {
        dom.stockInfoBackdrop.addEventListener("click", closeStockInfoModal);
    }

    window.addEventListener("pagehide", saveQuickReturnState);
    window.addEventListener("pageshow", (event) => {
        // При настоящем BFCache-возврате модуль не запускается заново, поэтому
        // одноразовый флаг нужно погасить здесь, чтобы обычное обновление уже
        // выполнило штатную проверку версии каталога и авторизации.
        if (!event.persisted) return;
        // BFCache возвращает уже существующий JS-контекст. Перечитываем
        // изменённые на dashboard фильтры и применяем их к сохранённому DOM.
        loadProfileFilters();
        renderCards();
        try {
            sessionStorage.removeItem(DASHBOARD_FAST_RETURN_KEY);
        } catch (error) {
            console.warn("Не удалось завершить быстрый возврат:", error);
        }
    });

    initQrScanner();
    initReportPasswordModal();
    initSaleDialog();
}

initPwaInstall();
initThemeManager();
initVersionManager();
initAuthorization();
