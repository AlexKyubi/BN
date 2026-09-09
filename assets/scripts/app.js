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
 * - catalog/                построение товаров из CSV и загрузка каталога
 * - regions/                справочник регионов/городов личного кабинета
 * - stock/                  клиент прокси остатков, клиентский кеш, модалка с деталями остатков
 * - profile/                личный кабинет (регион/город, фильтры, статус)
 * - ui/                     сетка карточек, выдвижные панели, просмотрщик изображений
 * - pwa/                    установка PWA
 * - qr/                     сканер QR-кодов
 */

import { dom } from "./dom.js";
import { state } from "./state.js";
import { CATALOG_REFRESH_INTERVAL_MS, DEFAULT_MONTH_COLUMN_INDEX } from "./config.js";
import { normalizeArticleSearchInput, normalizeGoogleSheetCsvUrl } from "./utils.js";
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
import { loadProducts, rebuildItemsFromSourceRows } from "./catalog/csv-source.js";
import { closeStockInfoModal } from "./stock/stock-info-modal.js";
import { syncCurrentRegionStock } from "./stock/stock-sync.js";
import { initProfileCabinet } from "./profile/profile-cabinet.js";
import { setProfileStatus } from "./profile/profile-status.js";
import { hydrateQuickReturnState, saveQuickReturnState } from "./quick-return.js";
import { closeCategoryDrawer, closeMonthDrawer, openCategoryDrawer, openMonthDrawer, syncMonthSelector } from "./ui/drawers.js";
import { createCategoryList, renderCards, updateCategoryButtons, updateSortPriceButton, updateStarsButtons } from "./ui/grid.js";
import { hideViewer } from "./ui/viewer.js";
import { initPwaInstall } from "./pwa/install.js";
import { initReportPasswordModal } from "./ui/password-prompt.js";
import { initQrScanner, stopQrScanner } from "./qr/scanner.js";
import { initVersionManager } from "./update/version-manager.js";
import { initSaleDialog } from "./sales/sale-dialog.js";

/** Позволяет тестам читать текущий список товаров из консоли/автотестов. */
window.__BN_TEST__ = {
    get items() {
        return state.items;
    },
};

/** Запускает приложение один раз: события, личный кабинет, каталог, фоновое обновление. */
async function startApp() {
    if (state.appStarted) {
        return;
    }

    state.appStarted = true;
    bindEvents();
    updateSortPriceButton();
    await initProfileCabinet();
    if (hydrateQuickReturnState()) {
        createCategoryList(state.categories);
        updateCategoryButtons();
        updateStarsButtons();
        renderCards();
    }
    await loadProducts();
    renderCards();
    scheduleCatalogRefresh();
    try {
        await syncCurrentRegionStock({ forceFull: false, silent: true });
    } catch (error) {
        console.warn("Не удалось выполнить стартовую синхронизацию региона:", error);
    }
}

/** Планирует периодическое фоновое обновление каталога из CSV. */
function scheduleCatalogRefresh() {
    if (state.catalogRefreshTimerId) {
        clearInterval(state.catalogRefreshTimerId);
    }

    state.catalogRefreshTimerId = setInterval(() => {
        void refreshCatalogInBackground();
    }, CATALOG_REFRESH_INTERVAL_MS);
}

/** Тихо перезагружает каталог из CSV, если вкладка активна и предыдущее обновление завершилось. */
async function refreshCatalogInBackground() {
    if (state.catalogRefreshInFlight) {
        return;
    }

    // Если вкладка неактивна, пропускаем итерацию, чтобы не тратить сеть и CPU.
    if (document.visibilityState !== "visible") {
        return;
    }

    state.catalogRefreshInFlight = true;
    try {
        await loadProducts();
        renderCards();
    } catch (error) {
        console.warn("Фоновое обновление каталога не удалось:", error);
    } finally {
        state.catalogRefreshInFlight = false;
    }
}

/** Сбрасывает все активные фильтры каталога к значениям по умолчанию. */
function resetAllFilters() {
    state.activeCategory = "all";
    state.activeStars = 0;
    state.searchQuery = "";
    state.priceSort = "none";

    if (dom.search) {
        dom.search.value = "";
    }

    state.activeMonthColumn = DEFAULT_MONTH_COLUMN_INDEX;
    rebuildItemsFromSourceRows();
    syncMonthSelector();
    updateCategoryButtons();
    updateStarsButtons();
    updateSortPriceButton();
    closeCategoryDrawer();
    closeMonthDrawer();
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
        const normalized = normalizeArticleSearchInput(event.target.value);
        if (event.target.value !== normalized) {
            event.target.value = normalized;
        }
        state.searchQuery = normalized;
        renderCards();
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

        state.activeCategory = button.dataset.category || "all";
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
        if (state.activeStars < selectedValue) {
            state.activeStars = selectedValue;
        } else if (state.activeStars === selectedValue) {
            state.activeStars = Math.max(0, selectedValue - 1);
        } else {
            state.activeStars = selectedValue;
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
            closeStockInfoModal();
        }
    });

    if (dom.currentUser) {
        const openDashboard = () => window.location.assign("dashboard.html");
        dom.currentUser.addEventListener("click", openDashboard);
        dom.currentUser.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openDashboard();
            }
        });
    }

    if (dom.closeStockInfoModal) {
        dom.closeStockInfoModal.addEventListener("click", closeStockInfoModal);
    }

    if (dom.stockInfoBackdrop) {
        dom.stockInfoBackdrop.addEventListener("click", closeStockInfoModal);
    }

    window.addEventListener("pagehide", saveQuickReturnState);

    initQrScanner();
    initReportPasswordModal();
    initSaleDialog();
}

initPwaInstall();
initVersionManager();
initAuthorization();
