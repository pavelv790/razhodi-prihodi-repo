import { useState, useEffect, useCallback } from "react";
import { openDB } from "../utils/db";
import { parseDate, getTodayString } from "../utils/formatters";

const STORE = "recurring";

const loadByProfile = async (profileId) => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => {
        const all = req.result || [];
        resolve(all.filter((r) => r.profileId === profileId));
      };
      req.onerror = () => reject(req.error);
    });
  } catch { return []; }
};

const saveOne = async (item) => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(item);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch { console.error("Грешка при запис на повтаряща се транзакция"); }
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
  } catch { console.error("Грешка при изтриване на повтаряща се транзакция"); }
};

const deleteByProfile = async (profileId) => {
  try {
    const db = await openDB();
    const all = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    const remaining = all.filter((r) => r.profileId !== profileId);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      store.clear();
      remaining.forEach((r) => store.put(r));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch { console.error("Грешка при изтриване на повтарящи се транзакции по профил"); }
};

// Изчислява всички чакащи дати за дадена повтаряща се транзакция
export const getPendingDates = (item, today) => {
  const todayDate = today || parseDate(getTodayString());
  const start = parseDate(item.startDate);
  if (!start) return [];
  const end = item.endDate ? parseDate(item.endDate) : null;
  const last = item.lastAdded ? parseDate(item.lastAdded) : null;

  // Началната точка е деня след последното добавяне, или startDate
  let current = last ? new Date(last) : new Date(start);
  if (last) {
    // Добавяме един период след lastAdded
    current = getNextDate(item, current);
  }

  const pending = [];
  // Максимум 366 итерации за да избегнем безкраен цикъл
  let safety = 0;
  while (current <= todayDate && safety < 366) {
    safety++;
    if (end && current > end) break;
    if (current >= start) {
      pending.push(formatDate(current));
    }
    current = getNextDate(item, current);
  }
  return pending;
};

const getNextDate = (item, from) => {
  const next = new Date(from);
  if (item.period === "weekly") {
    next.setDate(next.getDate() + 7);
  } else if (item.period === "monthly") {
    next.setMonth(next.getMonth() + 1);
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
    setIsLoaded(false);
    loadByProfile(profileId).then((data) => {
      setRecurringItems(data);
      setIsLoaded(true);
    });
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
    const updated = recurringItems.map((r) =>
      r.id === id ? { ...r, lastAdded: date } : r
    );
    const item = updated.find((r) => r.id === id);
    await saveOne(item);
    setRecurringItems(updated);
  };

  const deleteAllByProfile = async (targetProfileId) => {
    await deleteByProfile(targetProfileId);
  };

  const restoreRecurring = async (items) => {
    try {
      const db = await openDB();
      const all = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
      const otherProfiles = all.filter((r) => r.profileId !== profileId);
      const withProfile = items.map((r) => ({ ...r, profileId }));
      const merged = [...otherProfiles, ...withProfile];
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        store.clear();
        merged.forEach((r) => store.put(r));
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      setRecurringItems(withProfile);
    } catch { console.error("Грешка при restore на повтарящи се транзакции"); }
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