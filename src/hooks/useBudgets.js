import { useState, useEffect } from "react";
import { openDB } from "../utils/db";
import { getFirstDayOfMonth, getLastDayOfMonth } from "../utils/formatters";

const STORE = "budgets";

const loadFromDB = async () => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get("current");
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
};

const saveToDB = async (data) => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ id: "current", ...data });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    console.error("Грешка при запис на бюджети в IndexedDB");
  }
};

export const useBudgets = () => {
  const today = new Date();
  const [budgets, setBudgets] = useState({
    totalLimit: "",           // общ лимит за разходи (string, "" = няма)
    categoryLimits: {},       // { "Супермаркет": "300", ... }
    fromDate: getFirstDayOfMonth(today),
    toDate: getLastDayOfMonth(today),
  });
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    loadFromDB().then((data) => {
      if (data) {
        const { id, ...rest } = data;
        setBudgets(rest);
      }
      setIsLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (isLoaded) {
      saveToDB(budgets);
    }
  }, [budgets, isLoaded]);

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