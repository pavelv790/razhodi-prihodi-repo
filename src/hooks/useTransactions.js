import { useState, useEffect, useCallback, useRef } from "react";
import { parseDate } from "../utils/formatters";
import { openDB, reportDBError } from "../utils/db";

const STORE = "transactions";

// При грешка отхвърля (не връща []), за да не се приеме провалено четене за „няма транзакции“
// и празното да не се запише върху реалните данни (одит 2026-10, 1Б-01)
const loadByProfile = async (profileId) => {
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
      tx.onerror = () => { reportDBError(); reject(tx.error); };
    });
  } catch {
    reportDBError();
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
    if (dateB - dateA !== 0) return dateB - dateA;
    return a.id < b.id ? 1 : -1;
  });

export const useTransactions = (profileId) => {
  const [transactions, setTransactions] = useState([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const pendingSaveRef = useRef(null);
  // За кой профил са заредени транзакциите в паметта (null = зареждането още тече или се е провалило).
  // Без това при смяна на профил данните на стария се записваха под новия (одит 2026-10, 1А-01).
  const loadedForProfileRef = useRef(null);
  // Масивът, който е вече в базата (от зареждането или от replaceAllTransactions) —
  // него не го записваме отново (одит 2026-10, 1Б-04)
  const savedSnapshotRef = useRef(null);
  // Пореден номер на зареждането — по-старо зареждане, което завърши късно, се пренебрегва
  const loadSeqRef = useRef(0);

  useEffect(() => {
    const seq = ++loadSeqRef.current;
    // Cleanup-ът за запис на стария профил (по-долу) вече е изпълнен в тази фаза
    pendingSaveRef.current = null;
    loadedForProfileRef.current = null;
    savedSnapshotRef.current = null;
    setIsLoaded(false);
    // Да не се показват (и редактират) транзакциите на стария профил под името на новия
    setTransactions([]);
    if (!profileId) return;
    loadByProfile(profileId).then((data) => {
      if (seq !== loadSeqRef.current) return;
      const sorted = sortByDate(data);
      loadedForProfileRef.current = profileId;
      savedSnapshotRef.current = sorted;
      // Транзакции, добавени докато трае зареждането, се пазят (одит 2026-10, 1А-03)
      setTransactions((prev) => {
        const loadedIds = new Set(sorted.map((t) => t.id));
        const addedWhileLoading = prev.filter((t) => t.profileId === profileId && !loadedIds.has(t.id));
        return addedWhileLoading.length > 0 ? sortByDate([...sorted, ...addedWhileLoading]) : sorted;
      });
      setIsLoaded(true);
    }).catch(() => {
      if (seq !== loadSeqRef.current) return;
      // isLoaded остава false: нищо не се записва и не се качва в облака
      reportDBError();
      console.error("Грешка при зареждане на транзакции от IndexedDB");
    });
  }, [profileId]);

  useEffect(() => {
    if (!isLoaded || !profileId || loadedForProfileRef.current !== profileId) { pendingSaveRef.current = null; return; }
    if (transactions === savedSnapshotRef.current) { pendingSaveRef.current = null; return; }
    pendingSaveRef.current = { profileId, transactions };
    const timer = setTimeout(() => {
      pendingSaveRef.current = null;
      saveAllToDB_forProfile(profileId, transactions);
    }, 300);
    return () => clearTimeout(timer);
  }, [transactions, isLoaded, profileId]);

  // При смяна на профил или затваряне: ако има незаписани данни на стария профил — запиши ги веднага
  useEffect(() => {
    return () => {
      if (pendingSaveRef.current) {
        const { profileId: pid, transactions: txs } = pendingSaveRef.current;
        pendingSaveRef.current = null;
        saveAllToDB_forProfile(pid, txs);
      }
    };
  }, [profileId]);

  const addTransaction = (transaction) => {
    const newTransaction = { ...transaction, id: generateId(), profileId };
    setTransactions((prev) => sortByDate([...prev, newTransaction]));
  };

  const editTransaction = (id, updatedTransaction) => {
    setTransactions((prev) =>
      sortByDate(prev.map((t) => (t.id === id ? { ...t, ...updatedTransaction, id } : t)))
    );
  };

  const deleteTransaction = (id) => {
    setTransactions((prev) => prev.filter((t) => t.id !== id));
  };

  const deleteTransactionsByCategory = (categoryName, type) => {
    setTransactions((prev) =>
      prev.filter((t) => !(t.category === categoryName && t.type === type))
    );
  };

  const reassignTransactionsCategory = (categoryName, type) => {
    setTransactions((prev) =>
      prev.map((t) =>
        t.category === categoryName && t.type === type
          ? { ...t, category: "Без категория" }
          : t
      )
    );
  };

  const replaceAllTransactions = async (newTransactions, overrideProfileId) => {
    const targetId = overrideProfileId || profileId;
    const withProfile = newTransactions.map((t) => ({ ...t, profileId: targetId }));
    const sorted = sortByDate(withProfile);
    if (targetId === profileId) {
      // Записът по-долу е окончателен: зареждане, което още тече, вече е остаряло
      loadSeqRef.current++;
      loadedForProfileRef.current = profileId;
      savedSnapshotRef.current = sorted; // auto-save да не го записва втори път
      setTransactions(sorted);
      setIsLoaded(true);
    }
    await saveAllToDB_forProfile(targetId, sorted);
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
    const { fromDate, toDate, categories, description } = filters;
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
      if (description && description.trim() !== "") {
        const desc = (t.description || "").toLowerCase();
        if (!desc.includes(description.toLowerCase().trim())) return false;
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
    isLoaded,
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