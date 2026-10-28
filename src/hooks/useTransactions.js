import { useState, useEffect, useCallback, useRef } from "react";
import { parseDate } from "../utils/formatters";
import { runTx, replaceByProfile, reportDBError } from "../utils/db";

const STORE = "transactions";

// При грешка отхвърля (не връща []), за да не се приеме провалено четене за „няма транзакции“
// и празното да не се запише върху реалните данни (одит 2026-10, 1Б-01)
const loadByProfile = async (profileId) => {
  const all = (await runTx(STORE, "readonly", (store) => store.getAll())) || [];
  return all.filter((t) => t.profileId === profileId);
};

// Връща true при успешен запис; при грешка — червена лента и false (не отхвърля)
const saveAllToDB_forProfile = async (profileId, newTransactions) => {
  try {
    // Транзакциите на другите профили остават непокътнати
    await replaceByProfile(STORE, profileId, newTransactions);
    return true;
  } catch (err) {
    reportDBError();
    console.error("Грешка при запис в IndexedDB", err);
    return false;
  }
};

// При затваряне/презареждане на страницата IndexedDB транзакциите се прекъсват (дори отворени синхронно),
// затова чакащото се пази и в localStorage, което се записва синхронно. При следващото зареждане на
// профила снимката се възстановява и записва в базата; изтрива се чак след успешен запис
// (одит 2026-10, 1А-08)
const PENDING_KEY = "pending_transactions_flush";

const writePendingSnapshot = (profileId, newTransactions) => {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ profileId, ts: Date.now(), transactions: newTransactions }));
  } catch { /* няма място/недостъпно — остава само обикновеният запис */ }
};

const readPendingSnapshot = (profileId) => {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw);
    return snap && snap.profileId === profileId && Array.isArray(snap.transactions) ? snap : null;
  } catch {
    return null;
  }
};

// upTo: изтрива снимката само ако е писана не по-късно от началото на записа, който току-що е успял
const clearPendingSnapshot = (profileId, upTo = Infinity) => {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return;
    const snap = JSON.parse(raw);
    if (snap && snap.profileId === profileId && snap.ts <= upTo) localStorage.removeItem(PENDING_KEY);
  } catch { /* нищо */ }
};

const saveAndSettle = (profileId, newTransactions) => {
  const startedAt = Date.now();
  return saveAllToDB_forProfile(profileId, newTransactions).then((ok) => {
    if (ok) clearPendingSnapshot(profileId, startedAt);
  });
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

// Нови id-та за поредица транзакции с пазен ред: при равна дата sortByDate подрежда по id
// (по-голямото отгоре), затова първата в подадения масив получава най-голямото id.
// Поредният номер е преди случайната част — иначе редът в рамките на деня се решава от нея
// (одит 2026-10, 2А-16). Началото е 13-цифрен Date.now() като при generateId.
export const assignOrderedIds = (ordered, extraFields = {}) => {
  const base = Date.now();
  const width = String(ordered.length).length;
  return ordered.map((t, i) => ({
    ...t,
    ...extraFields,
    id: `${base}-${String(ordered.length - 1 - i).padStart(width, "0")}-${Math.random().toString(36).slice(2, 8)}`,
  }));
};

// Същото за копирани/възстановени транзакции: редът е както в източника (като се виждат там)
export const copyWithNewIds = (transactions, extraFields = {}) =>
  assignOrderedIds(sortByDate(transactions), extraFields);

export const useTransactions = (profileId) => {
  const [transactions, setTransactions] = useState([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const pendingSaveRef = useRef(null);
  // Таймерът на отложения запис — флъшът при скриване на таба го спира, за да няма двоен запис (одит 2026-10, 1А-08)
  const saveTimerRef = useRef(null);
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
      // Последните промени не са стигнали до базата при затваряне — възстановяват се и се записват наново (одит 2026-10, 1А-08)
      const recovered = readPendingSnapshot(profileId);
      const sorted = sortByDate(recovered ? recovered.transactions : data);
      loadedForProfileRef.current = profileId;
      savedSnapshotRef.current = recovered ? null : sorted;
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
      saveAndSettle(profileId, transactions);
    }, 300);
    saveTimerRef.current = timer;
    return () => clearTimeout(timer);
  }, [transactions, isLoaded, profileId]);

  // При смяна на профил или затваряне: ако има незаписани данни на стария профил — запиши ги веднага
  useEffect(() => {
    return () => {
      if (pendingSaveRef.current) {
        const { profileId: pid, transactions: txs } = pendingSaveRef.current;
        pendingSaveRef.current = null;
        saveAndSettle(pid, txs);
      }
    };
  }, [profileId]);

  // При скриване на таба/приложението (PWA във фон) или затваряне/презареждане запиши чакащото веднага,
  // вместо да чакаш 300-те ms на таймера, който иначе би се изгубил (одит 2026-10, 1А-08)
  useEffect(() => {
    const flushPending = () => {
      if (!pendingSaveRef.current) return;
      clearTimeout(saveTimerRef.current);
      const { profileId: pid, transactions: txs } = pendingSaveRef.current;
      pendingSaveRef.current = null;
      writePendingSnapshot(pid, txs);
      saveAndSettle(pid, txs);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushPending();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", flushPending);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", flushPending);
    };
  }, []);

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
    // Заместването е окончателно — по-стара снимка от затваряне не бива да го презапише (одит 2026-10, 1А-08)
    clearPendingSnapshot(targetId);
    // true/false — възстановяването спира при провал (одит 2026-10, 2А-01)
    return saveAllToDB_forProfile(targetId, sorted);
  };

  // При преименуване на категория транзакциите ѝ минават под новото име (одит 2026-10, 4-01).
  // Записва директно и връща true/false, за да се каже на потребителя, ако не е записано (Б6-1в);
  // незаредените транзакции не се пипат (false — в базата са със старото име)
  const renameTransactionsCategory = async (oldName, newName, type) => {
    if (!isLoaded || loadedForProfileRef.current !== profileId) return false;
    const matches = (t) => t.category === oldName && t.type === type;
    if (!transactions.some(matches)) return true;
    return replaceAllTransactions(transactions.map((t) => (matches(t) ? { ...t, category: newName } : t)));
  };

  const addTransactions = (newTransactions) => {
    const withProfile = newTransactions.map((t) => ({ ...t, profileId }));
    setTransactions((prev) => sortByDate([...prev, ...withProfile]));
  };
  // При грешка отхвърля, за да спре изтриването на профила (иначе профилът изчезва, а транзакциите му остават)
  const deleteAllTransactionsByProfile = async (targetProfileId) => {
    clearPendingSnapshot(targetProfileId);
    try {
      await replaceByProfile(STORE, targetProfileId);
    } catch (err) {
      reportDBError();
      console.error("Грешка при изтриване на транзакции по профил", err);
      throw err;
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
    renameTransactionsCategory,
    replaceAllTransactions,
    addTransactions,
    getFilteredTransactions,
    getSummary,
    deleteAllTransactionsByProfile,
  };
};