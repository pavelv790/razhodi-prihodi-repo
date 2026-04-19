import { useState, useEffect } from "react";
import { openDB } from "../utils/db";

const STORE = "saved_filters";


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

  const restoreFilters = async (filters) => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      store.clear();
      filters.forEach((f) => store.put(f));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  };

  return { savedFilters, saveFilter, deleteFilter, restoreFilters, setSavedFilters };
};