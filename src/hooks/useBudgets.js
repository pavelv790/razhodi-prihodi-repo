import { useState, useEffect, useRef } from "react";
import { openDB, reportDBError } from "../utils/db";
import { getFirstDayOfMonth, getLastDayOfMonth } from "../utils/formatters";

const STORE = "budgets";

const loadFromDB = async (profileId) => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(profileId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
};

const saveToDB = async (profileId, data) => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ id: profileId, ...data });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    reportDBError();
    console.error("Грешка при запис на бюджети в IndexedDB");
  }
};

export const deleteProfileBudgets = async (profileId) => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(profileId);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    console.error("Грешка при изтриване на бюджети");
  }
};

export const useBudgets = (profileId) => {
  const today = new Date();
  const defaultBudgets = {
    totalLimit: "",
    categoryLimits: {},
    fromDate: getFirstDayOfMonth(today),
    toDate: getLastDayOfMonth(today),
  };
  const [budgets, setBudgets] = useState(defaultBudgets);
  const [isLoaded, setIsLoaded] = useState(false);
  const loadedForProfileRef = useRef(null);

  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    setIsLoaded(false);
    setBudgets(defaultBudgets);
    loadedForProfileRef.current = null;
    loadFromDB(profileId).then((data) => {
      if (cancelled) return;
      if (data) {
        const { id, ...rest } = data;
        setBudgets(rest);
      }
      loadedForProfileRef.current = profileId;
      setIsLoaded(true);
    });
    return () => { cancelled = true; };
  }, [profileId]);

  useEffect(() => {
    if (isLoaded && profileId && loadedForProfileRef.current === profileId) {
      saveToDB(profileId, budgets);
    }
  }, [budgets, isLoaded, profileId]);

  const updateBudgets = (newBudgets) => {
    setBudgets(newBudgets);
  };

  const restoreBudgets = (data) => {
    setBudgets(data);
  };

  return {
    budgets,
    updateBudgets,
    restoreBudgets,
    isLoaded,
  };
};