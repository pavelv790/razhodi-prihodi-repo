const DB_NAME = "finance_db";
const DB_VERSION = 9;

let dbPromise = null;

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
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => {
      dbPromise = null; // позволява retry при грешка
      reject(req.error);
    };
  });
  return dbPromise;
};

// Уведомяване на UI при провален запис в базата (иначе провалите са тихи)
let dbErrorCallback = null;
export function onDBWriteError(callback) {
  dbErrorCallback = callback;
}
export function reportDBError() {
  try { if (dbErrorCallback) dbErrorCallback(); } catch { /* никога не хвърля */ }
}