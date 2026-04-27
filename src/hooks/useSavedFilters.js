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

export const useSavedFilters = (profileId) => {
  const [savedFilters, setSavedFilters] = useState([]);

  useEffect(() => {
    if (!profileId) {
      setSavedFilters([]);
      return;
    }
    loadAll().then((all) => {
      setSavedFilters(all.filter((f) => f.profileId === profileId));
    });
  }, [profileId]);

  const saveFilter = async (name, filter) => {
    const entry = {
      id: `${Date.now()}`,
      name,
      profileId,
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
    try {
      const db = await openDB();
      const all = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
      const otherProfiles = all.filter((f) => f.profileId !== profileId);
      const withProfile = filters.map((f) => ({ ...f, profileId }));
      const merged = [...otherProfiles, ...withProfile];
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        store.clear();
        merged.forEach((f) => store.put(f));
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch { console.error("Грешка при restore на филтри"); }
  };

  return { savedFilters, saveFilter, deleteFilter, restoreFilters, setSavedFilters };
};