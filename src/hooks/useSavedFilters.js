import { useState, useEffect } from "react";

const DB_NAME = "finance_db";
const DB_VERSION = 5;
const STORE = "saved_filters";

const openDB = () =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("transactions"))
        db.createObjectStore("transactions", { keyPath: "id" });
      if (!db.objectStoreNames.contains("categories"))
        db.createObjectStore("categories", { keyPath: "type" });
      if (!db.objectStoreNames.contains(STORE))
        db.createObjectStore(STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains("currency"))
        db.createObjectStore("currency", { keyPath: "id" });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });

const loadAll = async () => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch { return []; }
};

const saveOne = async (filter) => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(filter);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch { console.error("Грешка при запис на филтър"); }
};

const deleteOne = async (id) => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch { console.error("Грешка при изтриване на филтър"); }
};

export const useSavedFilters = () => {
  const [savedFilters, setSavedFilters] = useState([]);

  useEffect(() => {
    loadAll().then(setSavedFilters);
  }, []);

  const saveFilter = async (name, filter) => {
    const entry = {
      id: `${Date.now()}`,
      name,
      ...filter,
    };
    await saveOne(entry);
    setSavedFilters((prev) => [...prev, entry]);
  };

  const deleteFilter = async (id) => {
    await deleteOne(id);
    setSavedFilters((prev) => prev.filter((f) => f.id !== id));
  };

  return { savedFilters, saveFilter, deleteFilter };
};