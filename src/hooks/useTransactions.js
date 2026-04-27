import { useState, useEffect, useCallback, useRef } from "react";
import { parseDate } from "../utils/formatters";
import { openDB } from "../utils/db";

const STORE = "transactions";

const loadByProfile = async (profileId) => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => {
        const all = req.result || [];
        resolve(all.filter((t) => t.profileId === profileId));
      };
      req.onerror = () => reject(req.error);
    });
  } catch { return []; }
};

const saveAllToDB_forProfile = async (profileId, newTransactions) => {
  try {
    const db = await openDB();
    // Зареждаме всички транзакции от всички профили
    const all = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    // Запазваме транзакциите на другите профили непокътнати
    const otherProfiles = all.filter((t) => t.profileId !== profileId);
    const merged = [...otherProfiles, ...newTransactions];
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      store.clear();
      merged.forEach((t) => store.put(t));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    console.error("Грешка при запис в IndexedDB");
  }
};

const generateId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const sortByDate = (transactions) =>
  [...transactions].sort((a, b) => {
    const dateA = parseDate(a.date);
    const dateB = parseDate(b.date);
    if (!dateA || !dateB) return 0;
    return dateB - dateA;
  });

export const useTransactions = (profileId) => {
  const [transactions, setTransactions] = useState([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const skipAutoSave = useRef(false);

  useEffect(() => {
    if (!profileId) {
      setTransactions([]);
      setIsLoaded(false);
      return;
    }
    setIsLoaded(false);
    loadByProfile(profileId).then((data) => {
      setTransactions(sortByDate(data));
      setIsLoaded(true);
    });
  }, [profileId]);

  useEffect(() => {
    if (!isLoaded || !profileId) return;
    if (skipAutoSave.current) { skipAutoSave.current = false; return; }
    const timer = setTimeout(() => saveAllToDB_forProfile(profileId, transactions), 300);
    return () => clearTimeout(timer);
  }, [transactions, isLoaded, profileId]);

  const addTransaction = (transaction) => {
    const newTransaction = { ...transaction, id: generateId(), profileId };
    setTransactions((prev) => sortByDate([...prev, newTransaction]));
  };

  const editTransaction = (id, updatedTransaction) => {
    setTransactions((prev) =>
      sortByDate(prev.map((t) => (t.id === id ? { ...updatedTransaction, id } : t)))
    );
  };

  const deleteTransaction = (id) => {
    setTransactions((prev) => prev.filter((t) => t.id !== id));
  };

  const deleteTransactionsByCategory = (categoryName) => {
    setTransactions((prev) => prev.filter((t) => t.category !== categoryName));
  };

  const reassignTransactionsCategory = (categoryName) => {
    setTransactions((prev) =>
      prev.map((t) =>
        t.category === categoryName ? { ...t, category: "Без категория" } : t
      )
    );
  };

  const replaceAllTransactions = async (newTransactions) => {
    const withProfile = newTransactions.map((t) => ({ ...t, profileId }));
    const sorted = sortByDate(withProfile);
    skipAutoSave.current = true;
    setTransactions(sorted);
    // Изтриваме старите на този профил и записваме новите — изчакваме записа
    await saveAllToDB_forProfile(profileId, sorted);
  };

  const addTransactions = (newTransactions) => {
    const withProfile = newTransactions.map((t) => ({ ...t, profileId }));
    setTransactions((prev) => sortByDate([...prev, ...withProfile]));
  };
  const deleteAllTransactionsByProfile = async (targetProfileId) => {
    try {
      const db = await openDB();
      const all = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
      const remaining = all.filter((t) => t.profileId !== targetProfileId);
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        store.clear();
        remaining.forEach((t) => store.put(t));
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      console.error("Грешка при изтриване на транзакции по профил");
    }
  };

  const getFilteredTransactions = useCallback((filters) => {
    const { fromDate, toDate, categories } = filters;
    return transactions.filter((t) => {
      const date = parseDate(t.date);
      if (fromDate) {
        const from = parseDate(fromDate);
        if (from && date && date < from) return false;
      }
      if (toDate) {
        const to = parseDate(toDate);
        if (to && date && date > to) return false;
      }
      if (categories && categories.length > 0) {
        const match = categories.some(
          (key) => {
            const [name, type] = key.split("::");
            return t.category === name && t.type === type;
          }
        );
        if (!match) return false;
      }
      return true;
    });
  }, [transactions]);

  const getSummary = useCallback((filteredTransactions) => {
    const income = filteredTransactions
      .filter((t) => t.type === "income")
      .reduce((sum, t) => sum + Number(t.amount), 0);

    const expense = filteredTransactions
      .filter((t) => t.type === "expense")
      .reduce((sum, t) => sum + Number(t.amount), 0);

    return { income, expense, balance: income - expense };
  }, []);

  return {
    transactions,
    addTransaction,
    editTransaction,
    deleteTransaction,
    deleteTransactionsByCategory,
    reassignTransactionsCategory,
    replaceAllTransactions,
    addTransactions,
    getFilteredTransactions,
    getSummary,
    deleteAllTransactionsByProfile,
  };
};