import { useState, useEffect, useRef } from "react";
import {
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INCOME_CATEGORIES,
  sortCategories,
} from "../constants/categories";
import { runTx, reportDBError } from "../utils/db";
import { mergeCategoryLists } from "../utils/categoryMatch";

const STORE = "categories";

// При грешка отхвърля: категориите по подразбиране не бива да се запишат върху реалните (одит 2026-10, 1А-04)
const loadFromDB = async (profileId) =>
  (await runTx(STORE, "readonly", (store) => store.get(profileId))) || null;

// Повреден запис: списък, който не е масив → празен; елементи, които не са текст, отпадат (одит 2026-10, 1А-11)
const validList = (list) => (Array.isArray(list) ? list.filter((c) => typeof c === "string") : []);

// Връща true/false — възстановяването спира при провал (одит 2026-10, 2А-01)
export const saveToDB = async (profileId, expenseCategories, incomeCategories) => {
  try {
    await runTx(STORE, "readwrite", (store) =>
      store.put({ type: profileId, categories: { expense: expenseCategories, income: incomeCategories } }));
    return true;
  } catch (err) {
    reportDBError();
    console.error("Грешка при запис на категории в IndexedDB", err);
    return false;
  }
};

// При грешка отхвърля, за да спре изтриването на профила по средата, вместо да изтрие профила без данните му
export const deleteProfileCategories = async (profileId) => {
  try {
    await runTx(STORE, "readwrite", (store) => store.delete(profileId));
  } catch (err) {
    reportDBError();
    console.error("Грешка при изтриване на категории на профил", err);
    throw err;
  }
};

export const useCategories = (profileId) => {
  const [expenseCategories, setExpenseCategories] = useState([]);
  const [incomeCategories, setIncomeCategories] = useState([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const loadedForProfileRef = useRef(null);

  useEffect(() => {
    if (!profileId) {
      setExpenseCategories([]);
      setIncomeCategories([]);
      setIsLoaded(false);
      return;
    }
    let cancelled = false;
    setIsLoaded(false);
    loadedForProfileRef.current = null;
    loadFromDB(profileId).then((data) => {
      if (cancelled) return;
      // Запис без categories (повреден) — като липсващ запис: категориите по подразбиране
      if (data?.categories && typeof data.categories === "object") {
        setExpenseCategories(sortCategories(validList(data.categories.expense)));
        setIncomeCategories(sortCategories(validList(data.categories.income)));
      } else {
        setExpenseCategories(sortCategories(DEFAULT_EXPENSE_CATEGORIES));
        setIncomeCategories(sortCategories(DEFAULT_INCOME_CATEGORIES));
      }
      loadedForProfileRef.current = profileId;
      setIsLoaded(true);
    }).catch((err) => {
      if (cancelled) return;
      // isLoaded остава false: нищо не се записва и не се качва в облака
      reportDBError();
      console.error("Грешка при зареждане на категории от IndexedDB", err);
    });
    return () => { cancelled = true; };
  }, [profileId]);

  useEffect(() => {
    if (isLoaded && profileId && loadedForProfileRef.current === profileId) {
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

  // Без повторения по главни/малки букви; съществуващото изписване се запазва (одит 2026-10, 1А-16)
  const addCategoriesFromImport = (type, newCategories) => {
    if (type === "expense") {
      setExpenseCategories((prev) => sortCategories(mergeCategoryLists(prev, newCategories)));
    } else {
      setIncomeCategories((prev) => sortCategories(mergeCategoryLists(prev, newCategories)));
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
    isLoaded,
    addCategory,
    editCategory,
    deleteCategory,
    addCategoriesFromImport,
    setExpenseCategoriesFromBackup,
    setIncomeCategoriesFromBackup,
  };
};