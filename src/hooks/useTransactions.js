import { useState, useEffect } from "react";
import { parseDate } from "../utils/formatters";
import { openDB } from "../utils/db";

const STORE = "transactions";


const loadAllFromDB = async () => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
};

const saveAllToDB = async (transactions) => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      store.clear();
      transactions.forEach((t) => store.put(t));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    console.error("Грешка при запис в IndexedDB");
  }
};

// ============================================================
// Същите помощни функции като преди
// ============================================================

const generateId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const sortByDate = (transactions) =>
  [...transactions].sort((a, b) => {
    const dateA = parseDate(a.date);
    const dateB = parseDate(b.date);
    if (!dateA || !dateB) return 0;
    return dateB - dateA;
  });

// ============================================================
// Hook — интерфейсът е абсолютно същият като преди
// ============================================================

export const useTransactions = () => {
  const [transactions, setTransactions] = useState([]);
  const [isLoaded, setIsLoaded] = useState(false);

  // Зареждаме от IndexedDB при стартиране
  useEffect(() => {
    loadAllFromDB().then((data) => {
      setTransactions(sortByDate(data));
      setIsLoaded(true);
    });
  }, []);

  // Записваме в IndexedDB при всяка промяна (с debounce 300ms)
  useEffect(() => {
    if (!isLoaded) return;
    const timer = setTimeout(() => saveAllToDB(transactions), 300);
    return () => clearTimeout(timer);
  }, [transactions, isLoaded]);

  const addTransaction = (transaction) => {
    const newTransaction = { ...transaction, id: generateId() };
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

  const replaceAllTransactions = (newTransactions) => {
    setTransactions(sortByDate(newTransactions));
  };

  const addTransactions = (newTransactions) => {
    setTransactions((prev) => sortByDate([...prev, ...newTransactions]));
  };

  const getFilteredTransactions = (filters) => {
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
  };

  const getSummary = (filteredTransactions) => {
    const income = filteredTransactions
      .filter((t) => t.type === "income")
      .reduce((sum, t) => sum + Number(t.amount), 0);

    const expense = filteredTransactions
      .filter((t) => t.type === "expense")
      .reduce((sum, t) => sum + Number(t.amount), 0);

    return { income, expense, balance: income - expense };
  };

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
  };
};