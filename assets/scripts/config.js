/**
 * Конфигурация фронтенда.
 *
 * Важно: ссылка на Google Sheets намеренно НЕ хранится здесь — она известна только серверу
 * (server_config.json), клиент узнаёт её только через ответ /auth/validate. Иначе любой
 * посетитель смог бы прочитать её просто через "просмотр кода страницы", даже не пытаясь войти.
 */

/** Значение категории "Все" (сброс фильтра по категории). */
export const CATEGORY_ALL = "all";
/** Ключ sessionStorage для состояния быстрого возврата из кабинета или со страницы товара. */
export const QUICK_RETURN_STATE_KEY = "bn_quick_return_state_v1";
export const QUICK_RETURN_SCHEMA_VERSION = 2;
/** Срок жизни состояния быстрого возврата — 30 минут. */
export const QUICK_RETURN_TTL = 1000 * 60 * 30;
/** Постоянное состояние фильтров и оформления каталога между запусками браузера. */
export const CATALOG_UI_STATE_STORAGE_KEY = "bn_catalog_ui_state_v1";
export const THEME_HUE_STORAGE_KEY = "bn_theme_hue_v1";
export const DEFAULT_THEME_HUE = 216;
export const DASHBOARD_RETURN_MARKER_KEY = "bn_dashboard_from_catalog_v1";
export const DASHBOARD_FAST_RETURN_KEY = "bn_dashboard_fast_return_v1";
/** Ключи localStorage для статуса и данных авторизации на устройстве. */
export const AUTH_STORAGE_KEY = "bn_auth_ok_v1";
export const AUTH_USER_NAME_KEY = "bn_user_name_v1";
export const SHEET_URL_STORAGE_KEY = "bn_sheet_url_v1";
/** Ключ localStorage для токена доступа к данным (выдаётся сервером после проверки ссылки таблицы). */
export const ACCESS_TOKEN_STORAGE_KEY = "bn_access_token_v1";
/** Ключи localStorage для выбранных региона/города личного кабинета. */
export const PROFILE_REGION_STORAGE_KEY = "bn_profile_region_v1";
export const PROFILE_CITY_STORAGE_KEY = "bn_profile_city_v1";
/** Ключи localStorage для переключателей фильтров личного кабинета. */
export const HIDE_ZERO_PRICE_STORAGE_KEY = "bn_hide_zero_price_v1";
export const HIDE_NO_STOCK_STORAGE_KEY = "bn_hide_no_stock_v1";
export const ACTIVE_MONTH_INDEX_STORAGE_KEY = "bn_active_month_index_v1";
export const ACTIVE_MONTH_LABEL_STORAGE_KEY = "bn_active_month_label_v1";

/** Версии и настройки безопасной проверки обновлений. */
export const FRONTEND_VERSION = "1.4.1";
export const HEALTH_PATH = "/health";
export const VERSION_CHECK_TIMEOUT_MS = 10_000;
export const ACKNOWLEDGED_BACKEND_VERSION_KEY = "bn_acknowledged_backend_version_v1";
export const PENDING_BACKEND_VERSION_KEY = "bn_pending_backend_version_v1";
export const APP_CACHE_PREFIX = "bonus-navigator-";

/** Базовый адрес прокси-сервера остатков (по умолчанию, если не задан в runtime-конфиге). */
export const DEFAULT_PROXY_BASE = "https://proxy.bn.alexkyubi.com";
/** Пути эндпоинтов прокси-сервера. */
export const STOCK_PATH = "/stock";
export const CATALOG_PATH = "/catalog";
export const REGIONS_PATH = "/regions";
export const REGION_STOCK_PATH = "/region-stock";
export const REGION_STOCK_REPORT_PATH = "/region-stock-report";
export const AUTH_VALIDATE_PATH = "/auth/validate";
/** Идентификатор языка для запросов к прокси (3 = русский). */
export const LANGUAGE_ID = 3;

/** Настройки подключения к прокси-серверу остатков. */
export const STOCK_CONFIG = {
    proxyBase: DEFAULT_PROXY_BASE,
};

/** Таймауты сетевых запросов (0 = без таймаута). */
export const STOCK_FETCH_TIMEOUT_MS = 600000;
export const CATALOG_FETCH_TIMEOUT_MS = 15000;
export const REGION_SYNC_TIMEOUT_MS = 0;
export const AUTH_VALIDATE_TIMEOUT_MS = 15000;
/** Индекс месячной колонки по умолчанию в серверной строке комиссий (столбец E). */
export const DEFAULT_MONTH_COLUMN_INDEX = 4;
