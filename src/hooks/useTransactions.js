import { useState, useEffect } from "react";
import { parseDate } from "../utils/formatters";

const STORAGE_KEY = "finance_transactions";

const loadFromStorage = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
};

const saveToStorage = (transactions) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
  } catch {
    console.error("Грешка при запис в localStorage");
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

export const useTransactions = () => {
  const [transactions, setTransactions] = useState(() =>
    sortByDate(loadFromStorage())
  );

  useEffect(() => {
    saveToStorage(transactions);
  }, [transactions]);

  const addTransaction = (transaction) => {
    const newTransaction = {
      ...transaction,
      id: generateId(),
    };
    setTransactions((prev) => sortByDate([...prev, newTransaction]));
  };

  const editTransaction = (id, updatedTransaction) => {
    setTransactions((prev) =>
      sortByDate(
        prev.map((t) => (t.id === id ? { ...updatedTransaction, id } : t))
      )
    );
  };

  const deleteTransaction = (id) => {
    setTransactions((prev) => prev.filter((t) => t.id !== id));
  };

  const deleteTransactionsByCategory = (categoryName) => {
    setTransactions((prev) =>
      prev.filter((t) => t.category !== categoryName)
    );
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
    const { fromDate, toDate, category } = filters;
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
      if (category && category !== "") {
        if (t.category !== category) return false;
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

    return {
      income,
      expense,
      balance: income - expense,
    };
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