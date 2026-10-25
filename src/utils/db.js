const DB_NAME = "finance_db";
const DB_VERSION = 9;

let dbPromise = null;
let currentDB = null;

// Забравя затворена връзка, за да отвори следващото openDB() нова (одит 2026-10, 1А-06)
const forgetDB = (db) => {
  if (currentDB !== db) return;
  currentDB = null;
  dbPromise = null;
};

export const openDB = () => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      try {
      if (!db.objectStoreNames.contains("transactions"))
        db.createObjectStore("transactions", { keyPath: "id" });
      if (!db.objectStoreNames.contains("categories"))
        db.createObjectStore("categories", { keyPath: "type" });
      if (!db.objectStoreNames.contains("saved_filters"))
        db.createObjectStore("saved_filters", { keyPath: "id" });
      if (!db.objectStoreNames.contains("currency"))
        db.createObjectStore("currency", { keyPath: "id" });
      if (!db.objectStoreNames.contains("budgets"))
        db.createObjectStore("budgets", { keyPath: "id" });
      if (!db.objectStoreNames.contains("profiles"))
        db.createObjectStore("profiles", { keyPath: "id" });
      if (!db.objectStoreNames.contains("recurring"))
         db.createObjectStore("recurring", { keyPath: "id" });
      if (!db.objectStoreNames.contains("last_filter"))
         db.createObjectStore("last_filter", { keyPath: "id" });
    } catch (err) {
      dbPromise = null;
      reject(err);
    }
  };
    req.onblocked = () => {
      alert("Приложението е отворено в друг раздел или прозорец със стара версия. Затворете всички други раздели с приложението и презаредете тази страница.");
    };
    req.onsuccess = (e) => {
      const db = e.target.result;
      currentDB = db;
      // Браузърът може да затвори връзката (напр. iOS Safari след връщане от фон), а по-нова версия
      // в друг раздел иска да я освободим — и в двата случая следващото openDB() отваря нова
      db.onclose = () => forgetDB(db);
      db.onversionchange = () => {
        db.close();
        forgetDB(db);
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null; // позволява retry при грешка
      reject(req.error);
    };
  });
  return dbPromise;
};

// Отваря транзакция; ако кешираната връзка вече е затворена (InvalidStateError), отваря нова
// и опитва още веднъж (одит 2026-10, 1А-06)
const openTransaction = async (storeName, mode) => {
  const db = await openDB();
  try {
    return db.transaction(storeName, mode);
  } catch (err) {
    if (err?.name !== "InvalidStateError") throw err;
    forgetDB(db);
    return (await openDB()).transaction(storeName, mode);
  }
};

// Изпълнява fn(store, tx) в една транзакция и чака тя да завърши. Връща това, което fn върне —
// ако е заявка (IDBRequest), нейния result. При грешка, отказ (abort) или изключение във fn
// транзакцията се отменя изцяло и промисът се отхвърля (одит 2026-10, 1А-04, 1А-05, 1А-09).
// Съобщението към потребителя (reportDBError) е работа на извикващия.
export const runTx = async (storeName, mode, fn) => {
  const tx = await openTransaction(storeName, mode);
  return new Promise((resolve, reject) => {
    let out;
    const fail = () => reject(tx.error || new Error("Операцията с базата беше прекъсната."));
    tx.oncomplete = () => resolve(out instanceof IDBRequest ? out.result : out);
    tx.onerror = fail;
    tx.onabort = fail;
    try {
      out = fn(tx.objectStore(storeName), tx);
    } catch (err) {
      try { tx.abort(); } catch { /* транзакцията вече е приключила */ }
      reject(err);
    }
  });
};

// Уведомяване на UI при провален запис в базата (иначе провалите са тихи)
let dbErrorCallback = null;
export function onDBWriteError(callback) {
  dbErrorCallback = callback;
}
export function reportDBError() {
  try { if (dbErrorCallback) dbErrorCallback(); } catch { /* никога не хвърля */ }
}