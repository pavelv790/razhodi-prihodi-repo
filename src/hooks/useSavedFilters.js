import { useState, useEffect } from "react";
import { runTx, replaceByProfile, reportDBError } from "../utils/db";

const STORE = "saved_filters";


// При грешка отхвърля: провалено четене не е „няма филтри“ (одит 2026-10, 1А-04)
const loadAll = async () =>
  (await runTx(STORE, "readonly", (store) => store.getAll())) || [];

const saveOne = async (filter) => {
  try {
    await runTx(STORE, "readwrite", (store) => store.put(filter));
  } catch (err) { reportDBError(); console.error("Грешка при запис на филтър", err); }
};

const deleteOne = async (id) => {
  try {
    await runTx(STORE, "readwrite", (store) => store.delete(id));
  } catch (err) { reportDBError(); console.error("Грешка при изтриване на филтър", err); }
};

// При грешка отхвърля, за да спре изтриването на профила
export const deleteProfileSavedFilters = async (profileId) => {
  try {
    await replaceByProfile(STORE, profileId);
  } catch (err) {
    reportDBError();
    console.error("Грешка при изтриване на филтри на профил", err);
    throw err;
  }
};

export const useSavedFilters = (profileId) => {
  const [savedFilters, setSavedFilters] = useState([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (!profileId) {
      setSavedFilters([]);
      setIsLoaded(false);
      return;
    }
    let cancelled = false;
    setIsLoaded(false);
    loadAll().then((all) => {
      if (cancelled) return;
      setSavedFilters(all.filter((f) => f.profileId === profileId));
      setIsLoaded(true);
    }).catch((err) => {
      if (cancelled) return;
      // isLoaded остава false
      reportDBError();
      console.error("Грешка при зареждане на филтри от IndexedDB", err);
    });
    return () => { cancelled = true; };
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

  // Преименуване на категория: ключът "<име>::<тип>" във всички запазени филтри на профила, в ЕДНА
  // транзакция; списъкът се сменя само при успешен запис (одит 2026-10, 4-01)
  const renameCategoryKey = async (oldKey, newKey) => {
    const changed = savedFilters
      .filter((f) => (f.categories || []).includes(oldKey))
      .map((f) => ({ ...f, categories: [...new Set(f.categories.map((k) => (k === oldKey ? newKey : k)))] }));
    if (changed.length === 0) return true;
    try {
      await runTx(STORE, "readwrite", (store) => changed.forEach((f) => store.put(f)));
    } catch (err) {
      reportDBError();
      console.error("Грешка при преименуване на категория в запазените филтри", err);
      return false;
    }
    const byId = Object.fromEntries(changed.map((f) => [f.id, f]));
    setSavedFilters((prev) => prev.map((f) => byId[f.id] || f));
    return true;
  };

  // Не отхвърля (одит 2026-10, 1А-04), а връща true/false — възстановяването спира при провал
  // и казва докъде е стигнало (2А-01)
  const restoreFilters = async (filters, targetProfileId) => {
    try {
      const target = targetProfileId || profileId;
      const withProfile = filters.map((f) => ({ ...f, profileId: target }));
      await replaceByProfile(STORE, target, withProfile);
      return true;
    } catch (err) {
      reportDBError();
      console.error("Грешка при възстановяване от файл на филтри", err);
      return false;
    }
  };

  return { savedFilters, saveFilter, deleteFilter, restoreFilters, renameCategoryKey, setSavedFilters, isLoaded };
};