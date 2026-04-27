import { useState, useEffect } from "react";
import {
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INCOME_CATEGORIES,
  sortCategories,
} from "../constants/categories";
import { openDB } from "../utils/db";

const STORE = "categories";

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

const saveToDB = async (profileId, expenseCategories, incomeCategories) => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ type: profileId, categories: { expense: expenseCategories, income: incomeCategories } });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    console.error("Грешка при запис на категории в IndexedDB");
  }
};

export const deleteProfileCategories = async (profileId) => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(profileId);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    console.error("Грешка при изтриване на категории на профил");
  }
};

export const useCategories = (profileId) => {
  const [expenseCategories, setExpenseCategories] = useState([]);
  const [incomeCategories, setIncomeCategories] = useState([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (!profileId) {
      setExpenseCategories([]);
      setIncomeCategories([]);
      setIsLoaded(false);
      return;
    }
    setIsLoaded(false);
    loadFromDB(profileId).then((data) => {
      if (data) {
        setExpenseCategories(sortCategories(data.categories.expense || []));
        setIncomeCategories(sortCategories(data.categories.income || []));
      } else {
        // Нов профил — зареждаме DEFAULT категориите
        setExpenseCategories(sortCategories(DEFAULT_EXPENSE_CATEGORIES));
        setIncomeCategories(sortCategories(DEFAULT_INCOME_CATEGORIES));
      }
      setIsLoaded(true);
    });
  }, [profileId]);

  useEffect(() => {
    if (isLoaded && profileId) {
      saveToDB(profileId, expenseCategories, incomeCategories);
    }
  }, [expenseCategories, incomeCategories, isLoaded, profileId]);

  const addCategory = (type, name) => {
    const trimmed = name.trim();
    if (!trimmed) return false;
    if (type === "expense") {
      if (expenseCategories.some((c) => c.toLowerCase() === trimmed.toLowerCase())) return false;
      setExpenseCategories((prev) => sortCategories([...prev, trimmed]));
    } else {
      if (incomeCategories.some((c) => c.toLowerCase() === trimmed.toLowerCase())) return false;
      setIncomeCategories((prev) => sortCategories([...prev, trimmed]));
    }
    return true;
  };

  const editCategory = (type, oldName, newName) => {
    const trimmed = newName.trim();
    if (!trimmed) return false;
    if (type === "expense") {
      if (expenseCategories.some((c) => c.toLowerCase() === trimmed.toLowerCase() && c.toLowerCase() !== oldName.toLowerCase())) return false;
      setExpenseCategories((prev) => sortCategories(prev.map((c) => (c === oldName ? trimmed : c))));
    } else {
      if (incomeCategories.some((c) => c.toLowerCase() === trimmed.toLowerCase() && c.toLowerCase() !== oldName.toLowerCase())) return false;
      setIncomeCategories((prev) => sortCategories(prev.map((c) => (c === oldName ? trimmed : c))));
    }
    return true;
  };

  const deleteCategory = (type, name) => {
    if (type === "expense") {
      setExpenseCategories((prev) => prev.filter((c) => c !== name));
    } else {
      setIncomeCategories((prev) => prev.filter((c) => c !== name));
    }
  };

  const addCategoriesFromImport = (type, newCategories) => {
    if (type === "expense") {
      setExpenseCategories((prev) => {
        const merged = [...new Set([...prev, ...newCategories])];
        return sortCategories(merged);
      });
    } else {
      setIncomeCategories((prev) => {
        const merged = [...new Set([...prev, ...newCategories])];
        return sortCategories(merged);
      });
    }
  };

  const setExpenseCategoriesFromBackup = (categories) => {
    setExpenseCategories(sortCategories(categories));
  };

  const setIncomeCategoriesFromBackup = (categories) => {
    setIncomeCategories(sortCategories(categories));
  };

  return {
    expenseCategories,
    incomeCategories,
    addCategory,
    editCategory,
    deleteCategory,
    addCategoriesFromImport,
    setExpenseCategoriesFromBackup,
    setIncomeCategoriesFromBackup,
  };
};