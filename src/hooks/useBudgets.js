import { useState, useEffect, useRef } from "react";
import { runTx, reportDBError } from "../utils/db";
import { getFirstDayOfMonth, getLastDayOfMonth } from "../utils/formatters";

const STORE = "budgets";

// При грешка отхвърля: празните лимити не бива да се запишат върху реалните (одит 2026-10, 1А-04)
const loadFromDB = async (profileId) =>
  (await runTx(STORE, "readonly", (store) => store.get(profileId))) || null;

const saveToDB = async (profileId, data) => {
  try {
    await runTx(STORE, "readwrite", (store) => store.put({ id: profileId, ...data }));
    return true;
  } catch (err) {
    reportDBError();
    console.error("Грешка при запис на бюджети в IndexedDB", err);
    return false;
  }
};

// При грешка отхвърля, за да спре изтриването на профила
export const deleteProfileBudgets = async (profileId) => {
  try {
    await runTx(STORE, "readwrite", (store) => store.delete(profileId));
  } catch (err) {
    reportDBError();
    console.error("Грешка при изтриване на бюджети", err);
    throw err;
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
    }).catch((err) => {
      if (cancelled) return;
      // isLoaded остава false: нищо не се записва
      reportDBError();
      console.error("Грешка при зареждане на бюджети от IndexedDB", err);
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

  // Записва директно и връща true/false, за да спре възстановяването при провал,
  // вместо записът да остане за ефекта (одит 2026-10, 2А-01)
  const restoreBudgets = async (data) => {
    const ok = await saveToDB(profileId, data);
    if (ok) setBudgets(data);
    return ok;
  };

  return {
    budgets,
    updateBudgets,
    restoreBudgets,
    isLoaded,
  };
};