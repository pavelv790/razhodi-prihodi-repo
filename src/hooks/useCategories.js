import { useState, useEffect } from "react";
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES, sortCategories } from "../constants/categories";

const STORAGE_KEYS = {
  EXPENSE_CATEGORIES: "finance_expense_categories",
  INCOME_CATEGORIES: "finance_income_categories",
};

const loadFromStorage = (key, defaultValue) => {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : defaultValue;
  } catch {
    return defaultValue;
  }
};

const saveToStorage = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    console.error("Грешка при запис в localStorage");
  }
};

export const useCategories = () => {
  const [expenseCategories, setExpenseCategories] = useState(() =>
    sortCategories(loadFromStorage(STORAGE_KEYS.EXPENSE_CATEGORIES, DEFAULT_EXPENSE_CATEGORIES))
  );

  const [incomeCategories, setIncomeCategories] = useState(() =>
    sortCategories(loadFromStorage(STORAGE_KEYS.INCOME_CATEGORIES, DEFAULT_INCOME_CATEGORIES))
  );

  useEffect(() => {
    saveToStorage(STORAGE_KEYS.EXPENSE_CATEGORIES, expenseCategories);
  }, [expenseCategories]);

  useEffect(() => {
    saveToStorage(STORAGE_KEYS.INCOME_CATEGORIES, incomeCategories);
  }, [incomeCategories]);

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
      if (expenseCategories.some((c) => c.toLowerCase() === trimmed.toLowerCase() && c !== oldName)) return false;
      setExpenseCategories((prev) => sortCategories(prev.map((c) => (c === oldName ? trimmed : c))));
    } else {
      if (incomeCategories.some((c) => c.toLowerCase() === trimmed.toLowerCase() && c !== oldName)) return false;
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