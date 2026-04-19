import { useState, useEffect } from "react";
import {
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INCOME_CATEGORIES,
  sortCategories,
} from "../constants/categories";
import { openDB } from "../utils/db";

const STORE = "categories";


const loadFromDB = async (type, defaultValue) => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(type);
      req.onsuccess = () =>
        resolve(req.result ? req.result.categories : defaultValue);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return defaultValue;
  }
};

const saveToDB = async (type, categories) => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ type, categories });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    console.error("Грешка при запис на категории в IndexedDB");
  }
};

// ============================================================
// Hook — интерфейсът е абсолютно същият като преди
// ============================================================

export const useCategories = () => {
  const [expenseCategories, setExpenseCategories] = useState([]);
  const [incomeCategories, setIncomeCategories] = useState([]);
  const [isLoaded, setIsLoaded] = useState({ expense: false, income: false });

  // Зареждаме от IndexedDB при стартиране
  useEffect(() => {
    loadFromDB("expense", DEFAULT_EXPENSE_CATEGORIES).then((data) => {
      setExpenseCategories(sortCategories(data));
      setIsLoaded((prev) => ({ ...prev, expense: true }));
    });
    loadFromDB("income", DEFAULT_INCOME_CATEGORIES).then((data) => {
      setIncomeCategories(sortCategories(data));
      setIsLoaded((prev) => ({ ...prev, income: true }));
    });
  }, []);

  // Записваме при всяка промяна
  useEffect(() => {
    if (isLoaded.expense) {
      saveToDB("expense", expenseCategories);
    }
  }, [expenseCategories, isLoaded.expense]);

  useEffect(() => {
    if (isLoaded.income) {
      saveToDB("income", incomeCategories);
    }
  }, [incomeCategories, isLoaded.income]);

  const addCategory = (type, name) => {
    const trimmed = name.trim();
    if (!trimmed) return false;
    if (type === "expense") {
      if (expenseCategories.some((c) => c.toLowerCase() === trimmed.toLowerCase()))
        return false;
      setExpenseCategories((prev) => sortCategories([...prev, trimmed]));
    } else {
      if (incomeCategories.some((c) => c.toLowerCase() === trimmed.toLowerCase()))
        return false;
      setIncomeCategories((prev) => sortCategories([...prev, trimmed]));
    }
    return true;
  };

  const editCategory = (type, oldName, newName) => {
    const trimmed = newName.trim();
    if (!trimmed) return false;
    if (type === "expense") {
      if (
        expenseCategories.some(
          (c) => c.toLowerCase() === trimmed.toLowerCase() && c !== oldName
        )
      )
        return false;
      setExpenseCategories((prev) =>
        sortCategories(prev.map((c) => (c === oldName ? trimmed : c)))
      );
    } else {
      if (
        incomeCategories.some(
          (c) => c.toLowerCase() === trimmed.toLowerCase() && c !== oldName
        )
      )
        return false;
      setIncomeCategories((prev) =>
        sortCategories(prev.map((c) => (c === oldName ? trimmed : c)))
      );
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