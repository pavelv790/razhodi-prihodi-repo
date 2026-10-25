import { useState, useEffect, useCallback } from "react";
import { runTx, replaceByProfile, reportDBError } from "../utils/db";
import { parseDate, getTodayString } from "../utils/formatters";

const STORE = "recurring";

// При грешка отхвърля: провалено четене не е „няма повтарящи се“ (одит 2026-10, 1А-04)
const loadByProfile = async (profileId) => {
  const all = (await runTx(STORE, "readonly", (store) => store.getAll())) || [];
  return all.filter((r) => r.profileId === profileId);
};

const saveOne = async (item) => {
  try {
    await runTx(STORE, "readwrite", (store) => store.put(item));
  } catch (err) { reportDBError(); console.error("Грешка при запис на повтаряща се транзакция", err); }
};

const deleteOne = async (id) => {
  try {
    await runTx(STORE, "readwrite", (store) => store.delete(id));
  } catch (err) { reportDBError(); console.error("Грешка при изтриване на повтаряща се транзакция", err); }
};

// При грешка отхвърля, за да спре изтриването на профила
const deleteByProfile = async (profileId) => {
  try {
    await replaceByProfile(STORE, profileId);
  } catch (err) {
    reportDBError();
    console.error("Грешка при изтриване на повтарящи се транзакции по профил", err);
    throw err;
  }
};

// Изчислява всички чакащи дати за дадена повтаряща се транзакция
export const getPendingDates = (item, today) => {
  const todayDate = today || parseDate(getTodayString());
  const start = parseDate(item.startDate);
  if (!start) return [];
  const end = item.endDate ? parseDate(item.endDate) : null;
  const last = item.lastAdded ? parseDate(item.lastAdded) : null;

  const originalDay = start.getDate();

  let current = last ? new Date(last) : new Date(start);
  if (last) {
    current = getNextDate(item, current, originalDay);
  }

  const pending = [];
  let safety = 0;
  while (current <= todayDate && safety < 366) {
    safety++;
    if (end && current > end) break;
    if (current >= start) {
      pending.push(formatDate(current));
    }
    current = getNextDate(item, current, originalDay);
  }
  return pending;
};

const getNextDate = (item, from, originalDay) => {
  const next = new Date(from);
  if (item.period === "weekly") {
    next.setDate(next.getDate() + 7);
  } else if (item.period === "monthly") {
    const newMonth = next.getMonth() + 1;
    const newYear = newMonth > 11 ? next.getFullYear() + 1 : next.getFullYear();
    const targetMonth = newMonth % 12; // 0=януари, ..., 11=декември
    const maxDay = new Date(newYear, targetMonth + 1, 0).getDate();
    next.setDate(1);
    next.setMonth(newMonth);
    next.setDate(Math.min(originalDay ?? next.getDate(), maxDay));
  } else if (item.period === "yearly") {
    next.setFullYear(next.getFullYear() + 1);
  } else if (item.period === "daily") {
    next.setDate(next.getDate() + 1);
  } else {
    // custom — брой дни, по подразбиране 1
    const days = item.customDays || 1;
    next.setDate(next.getDate() + days);
  }
  return next;
};

const formatDate = (date) => {
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
};

export const useRecurring = (profileId) => {
  const [recurringItems, setRecurringItems] = useState([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (!profileId) {
      setRecurringItems([]);
      setIsLoaded(false);
      return;
    }
    let cancelled = false;
    setIsLoaded(false);
    loadByProfile(profileId).then((data) => {
      if (cancelled) return;
      setRecurringItems(data);
      setIsLoaded(true);
    }).catch((err) => {
      if (cancelled) return;
      // isLoaded остава false
      reportDBError();
      console.error("Грешка при зареждане на повтарящи се транзакции от IndexedDB", err);
    });
    return () => { cancelled = true; };
  }, [profileId]);

  const addRecurring = async (item) => {
    const newItem = {
      ...item,
      id: `recurring_${Date.now()}`,
      profileId,
      lastAdded: null,
    };
    await saveOne(newItem);
    setRecurringItems((prev) => [...prev, newItem]);
    return newItem;
  };

  const editRecurring = async (id, updates) => {
    const updated = recurringItems.map((r) =>
      r.id === id ? { ...r, ...updates } : r
    );
    const item = updated.find((r) => r.id === id);
    await saveOne(item);
    setRecurringItems(updated);
  };

  const deleteRecurring = async (id) => {
    await deleteOne(id);
    setRecurringItems((prev) => prev.filter((r) => r.id !== id));
  };

  const markAsAdded = async (id, date) => {
    const base = recurringItems.find((r) => r.id === id);
    if (!base) return;
    const item = { ...base, lastAdded: date };
    await saveOne(item);
    setRecurringItems((prev) =>
      prev.map((r) => (r.id === id ? item : r))
    );
  };

  const deleteAllByProfile = async (targetProfileId) => {
    await deleteByProfile(targetProfileId);
  };

  const restoreRecurring = async (items, targetProfileId) => {
    try {
      const target = targetProfileId || profileId;
      const withProfile = items.map((r) => ({ ...r, profileId: target }));
      await replaceByProfile(STORE, target, withProfile);
      if (target === profileId) setRecurringItems(withProfile);
    } catch (err) {
      reportDBError();
      console.error("Грешка при възстановяване от файл на повтарящи се транзакции", err);
    }
  };

  // Изчислява всички чакащи транзакции за днес
  const getPendingTransactions = useCallback(() => {
    const today = parseDate(getTodayString());
    const pending = [];
    recurringItems.forEach((item) => {
      const dates = getPendingDates(item, today);
      dates.forEach((date) => {
        pending.push({
          recurringId: item.id,
          date,
          type: item.type,
          category: item.category,
          amount: item.amount,
          variableAmount: item.variableAmount || false,
          description: item.description || "",
        });
      });
    });
    return pending;
  }, [recurringItems]);

  return {
    recurringItems,
    isLoaded,
    addRecurring,
    editRecurring,
    deleteRecurring,
    markAsAdded,
    deleteAllByProfile,
    restoreRecurring,
    getPendingTransactions,
  };
};