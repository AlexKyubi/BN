const DB_NAME = "bonus-navigator-sales";
const STORE_NAME = "sales";
const DB_VERSION = 1;
let prunedYear = null;

function retainedYear() {
    return new Date().getFullYear();
}

function isInRetainedYear(value) {
    const date = value instanceof Date ? value : new Date(value);
    return !Number.isNaN(date.getTime()) && date.getFullYear() === retainedYear();
}

function openDatabase() {
    return new Promise((resolve, reject) => {
        if (!("indexedDB" in window)) {
            reject(new Error("Хранилище IndexedDB не поддерживается."));
            return;
        }
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error || new Error("Не удалось открыть хранилище продаж."));
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
                store.createIndex("month", "month", { unique: false });
                store.createIndex("article", "article", { unique: false });
                store.createIndex("soldAt", "soldAt", { unique: false });
            }
        };
        request.onsuccess = () => resolve(request.result);
    });
}

function runTransaction(mode, action) {
    return openDatabase().then((db) => new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, mode);
        const store = transaction.objectStore(STORE_NAME);
        let result;
        transaction.oncomplete = () => { db.close(); resolve(result); };
        transaction.onerror = () => { db.close(); reject(transaction.error || new Error("Ошибка хранилища продаж.")); };
        transaction.onabort = transaction.onerror;
        action(store, (value) => { result = value; });
    }));
}

function normalizeSale(raw) {
    const soldAt = new Date(raw?.soldAt);
    const price = Number(raw?.price);
    const quantity = Number(raw?.quantity);
    const percent = Number(raw?.percent);
    const article = String(raw?.article || "").replace(/^#/, "").trim();
    const createdAt = raw?.createdAt ? new Date(raw.createdAt) : new Date();
    const updatedAt = raw?.updatedAt ? new Date(raw.updatedAt) : new Date();
    if (!raw?.id || !article || Number.isNaN(soldAt.getTime())
        || !Number.isFinite(price) || price < 0
        || !Number.isInteger(quantity) || quantity < 1
        || !Number.isFinite(percent) || percent < 0 || percent > 100
        || Number.isNaN(createdAt.getTime()) || Number.isNaN(updatedAt.getTime())) {
        return null;
    }
    const month = `${soldAt.getFullYear()}-${String(soldAt.getMonth() + 1).padStart(2, "0")}`;
    return {
        id: String(raw.id).slice(0, 100),
        article: article.slice(0, 80),
        title: String(raw.title || raw.article).slice(0, 300),
        category: String(raw.category || "Без категории").slice(0, 150),
        price: Math.round(price * 100) / 100,
        quantity,
        percent: Math.round(percent * 100) / 100,
        commission: Math.round(price * quantity * percent) / 100,
        soldAt: soldAt.toISOString(),
        month,
        rateMonthLabel: String(raw.rateMonthLabel || "").slice(0, 100),
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
        returned: Boolean(raw.returned),
    };
}

export function createSaleId() {
    return globalThis.crypto?.randomUUID?.() || `sale-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getAllSalesRaw() {
    return runTransaction("readonly", (store, done) => {
        const request = store.getAll();
        request.onsuccess = () => done((request.result || []).map(normalizeSale).filter(Boolean));
    });
}

/** Удаляет повреждённые записи и историю до 1 января текущего календарного года. */
export async function pruneSalesHistory({ force = false } = {}) {
    const year = retainedYear();
    if (!force && prunedYear === year) return 0;
    const deleted = await runTransaction("readwrite", (store, done) => {
        let count = 0;
        const request = store.openCursor();
        request.onerror = () => done(count);
        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) {
                done(count);
                return;
            }
            const sale = normalizeSale(cursor.value);
            if (!sale || !isInRetainedYear(sale.soldAt)) {
                cursor.delete();
                count += 1;
            }
            cursor.continue();
        };
    });
    prunedYear = year;
    return deleted;
}

export async function getAllSales() {
    await pruneSalesHistory();
    return getAllSalesRaw();
}

export async function saveSale(raw, { preserveUpdatedAt = false } = {}) {
    const sale = normalizeSale(raw);
    if (!sale) {
        return Promise.reject(new Error("Проверьте данные продажи."));
    }
    if (!isInRetainedYear(sale.soldAt)) {
        return Promise.reject(new Error(`История хранится только с 1 января ${retainedYear()} года.`));
    }
    await pruneSalesHistory();
    if (!preserveUpdatedAt) {
        sale.updatedAt = new Date().toISOString();
    }
    return runTransaction("readwrite", (store, done) => {
        store.put(sale).onsuccess = () => done(sale);
    });
}

export async function deleteSale(id) {
    const saleId = String(id || "").trim();
    if (!saleId) {
        return Promise.reject(new Error("Продажа не найдена."));
    }
    return runTransaction("readwrite", (store, done) => {
        const lookup = store.get(saleId);
        lookup.onsuccess = () => {
            if (!lookup.result) {
                done(false);
                return;
            }
            store.delete(saleId).onsuccess = () => done(true);
        };
    });
}

export async function exportSalesBackup() {
    const sales = await getAllSales();
    return JSON.stringify({ format: "bonus-navigator-sales", version: 1, exportedAt: new Date().toISOString(), sales }, null, 2);
}

export async function importSalesBackup(text) {
    let payload;
    try { payload = JSON.parse(text); } catch { throw new Error("Выбранный файл не является резервной копией."); }
    if (payload?.format !== "bonus-navigator-sales" || payload?.version !== 1 || !Array.isArray(payload.sales)) {
        throw new Error("Формат резервной копии не поддерживается.");
    }
    if (payload.sales.length > 50_000) {
        throw new Error("Резервная копия содержит слишком много записей.");
    }
    const normalizedIncoming = payload.sales.map(normalizeSale).filter(Boolean);
    if (normalizedIncoming.length !== payload.sales.length) {
        throw new Error("Резервная копия содержит повреждённые записи.");
    }

    // Если файл содержит несколько версий одной продажи, оставляем самую новую.
    const incomingById = new Map();
    for (const sale of normalizedIncoming) {
        const previous = incomingById.get(sale.id);
        if (!previous || Date.parse(sale.updatedAt) > Date.parse(previous.updatedAt)) {
            incomingById.set(sale.id, sale);
        }
    }
    const allIncoming = [...incomingById.values()];
    const incoming = allIncoming.filter((sale) => isInRetainedYear(sale.soldAt));
    const ignoredOutsideRetention = allIncoming.length - incoming.length;
    const current = new Map((await getAllSales()).map((sale) => [sale.id, sale]));
    let imported = 0;
    for (const sale of incoming) {
        const existing = current.get(sale.id);
        if (!existing || Date.parse(sale.updatedAt) > Date.parse(existing.updatedAt)) {
            await saveSale(sale, { preserveUpdatedAt: true });
            current.set(sale.id, sale);
            imported += 1;
        }
    }
    return { imported, total: normalizedIncoming.length, ignoredOutsideRetention };
}
