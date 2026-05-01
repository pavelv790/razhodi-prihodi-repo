import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Settings, Info, Upload, FileDown, Trash2, TrendingUp, ChevronDown, Search, BarChart2, AlertTriangle, User, RefreshCw } from "lucide-react";
import { useTransactions } from "./hooks/useTransactions";
import { useCategories, deleteProfileCategories, saveToDB as saveCategoriesDirectly } from "./hooks/useCategories";
import { useProfiles } from "./hooks/useProfiles";
import { exportBackup, importBackup } from "./utils/backup";
import ProfileModal from "./components/ProfileModal";
import MergeProfileModal from "./components/MergeProfileModal";
import SummaryCards from "./components/SummaryCards";
import FilterBar from "./components/FilterBar";
import TransactionForm from "./components/TransactionForm";
import TransactionList from "./components/TransactionList";
import CategoryManager from "./components/CategoryManager";
import ImportExportModal from "./components/ImportExportModal";
import MonthlyStats from "./components/MonthlyStats";
import ChartsModal from "./components/ChartsModal";
import { useSavedFilters } from "./hooks/useSavedFilters";
import { useCurrency } from "./hooks/useCurrency";
import { useBudgets } from "./hooks/useBudgets";
import BudgetModal from "./components/BudgetModal";
import RecurringModal from "./components/RecurringModal";
import PendingRecurringModal from "./components/PendingRecurringModal";
import { useRecurring } from "./hooks/useRecurring";
import UserGuideModal from "./components/UserGuideModal";
import { useGoogleDrive } from "./hooks/useGoogleDrive";
import { openDB } from "./utils/db";

const App = () => {
  const {
    profiles,
    activeProfileId,
    activeProfile,
    isLoaded: profilesLoaded,
    createProfile,
    switchProfile,
    deleteProfile,
    renameProfile,
    restoreProfiles,
    addOrUpdateProfile,
  } = useProfiles();
  const {
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
  } = useTransactions(activeProfileId);

  const {
    expenseCategories,
    incomeCategories,
    addCategory,
    editCategory,
    deleteCategory,
    addCategoriesFromImport,
    setExpenseCategoriesFromBackup,
    setIncomeCategoriesFromBackup,
  } = useCategories(activeProfileId);
  const { savedFilters, saveFilter, deleteFilter, restoreFilters, setSavedFilters } = useSavedFilters(activeProfileId);
  const { currency, rate, updateCurrency, resetToEur, convert, isLoaded: currencyLoaded, restoreCurrency } = useCurrency(activeProfileId);
  const { budgets, updateBudgets, restoreBudgets } = useBudgets(activeProfileId);
  const {
    recurringItems,
    addRecurring,
    editRecurring,
    deleteRecurring,
    markAsAdded,
    deleteAllByProfile: deleteAllRecurringByProfile,
    restoreRecurring,
    getPendingTransactions,
  } = useRecurring(activeProfileId);

  const [editingTransaction, setEditingTransaction] = useState(null);
  const [filters, setFilters] = useState({ fromDate: "", toDate: "", categories: [] });
  const [activeFilters, setActiveFilters] = useState({ fromDate: "", toDate: "", categories: [] });
  const [isFiltered, setIsFiltered] = useState(false);
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [showImportExport, setShowImportExport] = useState(false);
  const [importExportMode, setImportExportMode] = useState(null);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [pendingBackup, setPendingBackup] = useState(null);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [showMonthlyStats, setShowMonthlyStats] = useState(false);
  const [showCharts, setShowCharts] = useState(false);
  const [rollingMonths, setRollingMonths] = useState(12);
  const [showBudget, setShowBudget] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [showRecurringModal, setShowRecurringModal] = useState(false);
  const [showPendingModal, setShowPendingModal] = useState(false);
  const [pendingRecurring, setPendingRecurring] = useState([]);
  const [showDataPanel, setShowDataPanel] = useState(false);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [showWeeklyBackup, setShowWeeklyBackup] = useState(false);
  const [showUserGuide, setShowUserGuide] = useState(false);
  const [showRestoreDone, setShowRestoreDone] = useState(false);
  const [restoreDoneType, setRestoreDoneType] = useState("restore"); // "restore" | "merge"
  const [conflictProfiles, setConflictProfiles] = useState([]);
  const [conflictChoices, setConflictChoices] = useState({});
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [showRestoreDuplicates, setShowRestoreDuplicates] = useState(false);
  const [restoreDuplicates, setRestoreDuplicates] = useState([]);
  const [restoreUniqueTransactions, setRestoreUniqueTransactions] = useState([]);
  const [restoreSelectedDuplicates, setRestoreSelectedDuplicates] = useState([]);
  const [pendingNewProfiles, setPendingNewProfiles] = useState([]);
  const [addNewProfiles, setAddNewProfiles] = useState(null);
  const [showAddNewProfilesConfirm, setShowAddNewProfilesConfirm] = useState(false);
  const [pendingMergeProfileId, setPendingMergeProfileId] = useState(null);
  const [pendingRemainingProfiles, setPendingRemainingProfiles] = useState([]);
  const {
    connected: driveConnected,
    autoSync: driveAutoSync,
    loading: driveLoading,
    message: driveMessage,
    setMessage: driveSetMessage,
    connect: driveConnect,
    disconnect: driveDisconnect,
    toggleAutoSync: driveToggleAutoSync,
    uploadBackup: driveUploadBackup,
    downloadBackup: driveDownloadBackup,
  } = useGoogleDrive();
  
  useEffect(() => {
    if (!profilesLoaded) return;
    if (profiles.length === 0) {
      setShowProfileModal(true);
    }
  }, [profilesLoaded, profiles.length]);
  useEffect(() => {
    if (!activeProfileId || recurringItems.length === 0) return;
    const pending = getPendingTransactions();
    if (pending.length > 0) {
      setPendingRecurring(pending);
      setShowPendingModal(true);
    }
  }, [activeProfileId, getPendingTransactions]);
  const backupFileRef = useRef(null);

  const filteredTransactions = useMemo(
    () => getFilteredTransactions(activeFilters),
    [activeFilters, getFilteredTransactions]
  );
  const summary = useMemo(
    () => getSummary(filteredTransactions),
    [filteredTransactions, getSummary]
  );
  useEffect(() => {
    if (!driveAutoSync || !driveConnected) return;
    if (transactions.length === 0) return;
    if (!activeProfile?.name) return;
    const timer = setTimeout(async () => {
      driveUploadBackup(await buildBackupData(), activeProfile.name);
    }, 1500);
    return () => clearTimeout(timer);
  }, [transactions, expenseCategories, incomeCategories, savedFilters, profiles]);

  useEffect(() => {
    if (transactions.length === 0 || expenseCategories.length === 0 || incomeCategories.length === 0) return;

    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    const weekKey = `auto_export_${monday.getFullYear()}_${monday.getMonth() + 1}_${monday.getDate()}`;

    const alreadyExported = localStorage.getItem(weekKey);
    if (!alreadyExported) {
      localStorage.setItem(weekKey, "true");
      setTimeout(() => setShowWeeklyBackup(true), 500);
    }
  }, [transactions, expenseCategories, incomeCategories]);

  const handleFilter = useCallback((newFilters) => {
    setActiveFilters(newFilters);
    setIsFiltered(
      !!(newFilters.fromDate || newFilters.toDate || (newFilters.categories && newFilters.categories.length > 0))
    );
  }, []);
          
  const handleClearFilter = useCallback(() => {
    const empty = { fromDate: "", toDate: "", categories: [] };
    setFilters(empty);
    setActiveFilters(empty);
    setIsFiltered(false);
  }, []);

  const handleDeleteCategory = (type, name, choice) => {
    if (choice === "delete") {
      deleteTransactionsByCategory(name);
    } else {
      reassignTransactionsCategory(name);
    }
    deleteCategory(type, name);
  };
  const handleDeleteProfile = async (id) => {
    await deleteAllTransactionsByProfile(id);
    await deleteAllRecurringByProfile(id);
    await deleteProfileCategories(id);
    deleteProfile(id);
  };

  const handleCategoriesImported = (newCategories) => {
    addCategoriesFromImport("expense", newCategories.expense);
    addCategoriesFromImport("income", newCategories.income);
  };
  const handleConfirmPending = async (toAdd) => {
    for (const item of toAdd) {
      await addTransaction({
        type: item.type,
        category: item.category,
        amount: item.amount,
        date: item.date,
        description: item.description,
      });
    }
    // Маркираме последната дата за ВСЕКИ recurringId независимо дали е добавен или пропуснат
    const allIds = [...new Set(pendingRecurring.map((p) => p.recurringId))];
    for (const id of allIds) {
      const lastDate = pendingRecurring
        .filter((p) => p.recurringId === id)
        .at(-1)?.date;
      if (lastDate) await markAsAdded(id, lastDate);
    }
    setShowPendingModal(false);
    setPendingRecurring([]);
  };
  const handleAddNewProfilesConfirm = async (doAdd) => {
    if (doAdd) {
      for (const bp of pendingNewProfiles) {
        await addOrUpdateProfile(bp);
        // Транзакции
        const backupTxs = (pendingBackup.transactions || [])
          .filter((t) => t.profileId === bp.id)
          .map((t) => ({ ...t, profileId: bp.id, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }));
        await replaceAllTransactions(backupTxs, bp.id);
        // Категории
        const cats = pendingBackup.profileCategories?.[bp.id]
          ? pendingBackup.profileCategories[bp.id]
          : { expense: pendingBackup.expenseCategories || [], income: pendingBackup.incomeCategories || [] };
        await saveCategoriesDirectly(bp.id, cats.expense, cats.income);
        // Филтри
        if (pendingBackup.savedFilters) {
          const profileFilters = pendingBackup.savedFilters.filter((f) => f.profileId === bp.id);
          await restoreFilters(profileFilters);
        }
        // Повтарящи се
        if (pendingBackup.recurringItems) {
          const profileRecurring = pendingBackup.recurringItems.filter((r) => r.profileId === bp.id);
          await restoreRecurring(profileRecurring);
        }
      }
    }
    setConflictProfiles([]);
    setConflictChoices({});
    setPendingNewProfiles([]);
    setAddNewProfiles(null);
    setPendingBackup(null);
    setShowAddNewProfilesConfirm(false);
    setShowRestoreDone(true);
  };
  const handleRestoreDuplicatesConfirm = async () => {
    const toAdd = [
      ...restoreUniqueTransactions,
      ...restoreDuplicates.filter((t) => restoreSelectedDuplicates.includes(t.id)),
    ];
    if (toAdd.length > 0) {
      const existingTxs = pendingMergeProfileId === activeProfileId
        ? transactions
        : await (async () => {
            const db = await openDB();
            return new Promise((resolve) => {
              const tx = db.transaction("transactions", "readonly");
              const req = tx.objectStore("transactions").getAll();
              req.onsuccess = () => resolve((req.result || []).filter((t) => t.profileId === pendingMergeProfileId));
            });
          })();
      await replaceAllTransactions([...existingTxs, ...toAdd], pendingMergeProfileId);
    }

    // Довърши категории, филтри, повтарящи се за текущия профил
    const currentBp = (pendingBackup.profiles || []).find((p) => p.id === pendingMergeProfileId);
    if (currentBp) {
      await finishRestoreForProfile(currentBp, "merge", pendingBackup);
      await addOrUpdateProfile(currentBp);
    }
    setRestoreDuplicates([]);
    setRestoreUniqueTransactions([]);
    setRestoreSelectedDuplicates([]);
    setPendingMergeProfileId(null);
    setShowRestoreDuplicates(false);

    // Продължи с останалите профили
    await finishRestore(pendingRemainingProfiles, pendingBackup);
  };
  const handleMergeImport = (transactions, expenseCategories, incomeCategories) => {
    addTransactions(transactions);
    addCategoriesFromImport("expense", expenseCategories);
    addCategoriesFromImport("income", incomeCategories);
  };
  const buildBackupData = async () => {
    const { openDB } = await import("./utils/db");
    const db = await openDB();
    const allCats = await new Promise((resolve) => {
      const tx = db.transaction("categories", "readonly");
      const req = tx.objectStore("categories").getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
    const allProfileCategories = {};
    allCats.forEach((entry) => {
      allProfileCategories[entry.type] = {
        expense: entry.categories?.expense || [],
        income: entry.categories?.income || [],
      };
    });
    // Категориите на активния профил се вземат от state за да са най-актуални
    allProfileCategories[activeProfileId] = { expense: expenseCategories, income: incomeCategories };
    return {
      version: "1.5",
      date: new Date().toISOString(),
      profiles,
      activeProfileId,
      transactions,
      expenseCategories,
      incomeCategories,
      profileCategories: allProfileCategories,
      savedFilters,
      currency,
      rate,
      budgets,
      recurringItems,
    };
  };
  
  const handleDriveUpload = async () => {
    await driveUploadBackup(await buildBackupData(), activeProfile?.name);
  };

  const handleBackupExport = async () => {
    const data = await buildBackupData();
    exportBackup(data.transactions, data.expenseCategories, data.incomeCategories, data.savedFilters, data.currency, data.rate, data.budgets, data.profiles, data.activeProfileId, data.recurringItems, activeProfile?.name, data.profileCategories);
  };

  const handleBackupFileSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = await importBackup(file);
      setPendingBackup(data);

      // Намери профили които съществуват и в приложението, и в backup файла
      const conflicts = (data.profiles || []).filter((bp) =>
        profiles.some((lp) => lp.id === bp.id || lp.name.toLowerCase() === bp.name.toLowerCase())
      );
      const newProfiles = (data.profiles || []).filter((bp) =>
        !profiles.some((lp) => lp.id === bp.id || lp.name.toLowerCase() === bp.name.toLowerCase())
      );

      if (conflicts.length > 0) {
        const initialChoices = {};
        conflicts.forEach((p) => { initialChoices[p.id] = "backup"; });
        setConflictProfiles(conflicts);
        setConflictChoices(initialChoices);
        setShowConflictModal(true);
      } else {
        setShowRestoreConfirm(true);
      }
      // Запомни новите профили (само в backup файла) отделно
      setPendingNewProfiles(newProfiles);
    } catch (err) {
      alert(err.message);
    }
  };
  const finishRestoreForProfile = async (bp, choice, backupData) => {
    const cats = backupData.profileCategories?.[bp.id]
      ? backupData.profileCategories[bp.id]
      : { expense: backupData.expenseCategories || [], income: backupData.incomeCategories || [] };

    if (choice === "backup") {
      await saveCategoriesDirectly(bp.id, cats.expense, cats.income);
      if (bp.id === activeProfileId) {
        setExpenseCategoriesFromBackup(cats.expense || []);
        setIncomeCategoriesFromBackup(cats.income || []);
        if (backupData.currency) restoreCurrency(backupData.currency, backupData.rate);
        if (backupData.budgets) restoreBudgets(backupData.budgets);
      }
    }

    if (choice === "merge") {
      const existingCats = await (async () => {
        const db = await openDB();
        return new Promise((resolve) => {
          const tx = db.transaction("categories", "readonly");
          const req = tx.objectStore("categories").get(bp.id);
          req.onsuccess = () => resolve(req.result || null);
        });
      })();
      const existingExpense = existingCats?.categories?.expense || [];
      const existingIncome = existingCats?.categories?.income || [];
      const mergedExpense = [...new Set([...existingExpense, ...(cats.expense || [])])];
      const mergedIncome = [...new Set([...existingIncome, ...(cats.income || [])])];
      await saveCategoriesDirectly(bp.id, mergedExpense, mergedIncome);
      if (bp.id === activeProfileId) {
        setExpenseCategoriesFromBackup(mergedExpense);
        setIncomeCategoriesFromBackup(mergedIncome);
      }
    }

    if (backupData.savedFilters) {
      const profileFilters = backupData.savedFilters.filter((f) => f.profileId === bp.id);
      await restoreFilters(profileFilters, bp.id);
      if (bp.id === activeProfileId) setSavedFilters(profileFilters);
    }
    if (backupData.recurringItems) {
      const profileRecurring = backupData.recurringItems.filter((r) => r.profileId === bp.id);
      await restoreRecurring(profileRecurring, bp.id);
    }
  };

  const finishRestore = async (remainingProfiles, backupData) => {
    for (const bp of remainingProfiles) {
      const isNew = pendingNewProfiles.some((np) => np.id === bp.id);
      if (isNew) continue;
      const choice = conflictChoices[bp.id] || "backup";
      if (choice === "local") continue;

      const db = await openDB();
      const localTxsForProfile = await new Promise((resolve) => {
        const tx = db.transaction("transactions", "readonly");
        const req = tx.objectStore("transactions").getAll();
        req.onsuccess = () => resolve((req.result || []).filter((t) => t.profileId === bp.id));
      });

      const backupTxs = (backupData.transactions || [])
        .filter((t) => t.profileId === bp.id)
        .map((t) => ({ ...t, profileId: bp.id, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }));

      if (choice === "merge") {
        const dupes = backupTxs.filter((bt) =>
          localTxsForProfile.some(
            (e) =>
              e.date === bt.date &&
              e.category === bt.category &&
              e.type === bt.type &&
              Math.abs(Number(e.amount) - Number(bt.amount)) < 0.01
          )
        );
        const unique = backupTxs.filter((bt) => !dupes.includes(bt));
        if (dupes.length > 0) {
          setRestoreUniqueTransactions(unique);
          setRestoreDuplicates(dupes);
          setRestoreSelectedDuplicates([]);
          setPendingMergeProfileId(bp.id);
          const idx = remainingProfiles.findIndex((p) => p.id === bp.id);
          setPendingRemainingProfiles(remainingProfiles.slice(idx + 1));
          setShowRestoreConfirm(false);
          setShowConflictModal(false);
          setShowRestoreDuplicates(true);
          return;
        }
        if (unique.length > 0) {
          const existingTxs = bp.id === activeProfileId
            ? transactions
            : await (async () => {
                const db = await openDB();
                return new Promise((resolve) => {
                  const tx = db.transaction("transactions", "readonly");
                  const req = tx.objectStore("transactions").getAll();
                  req.onsuccess = () => resolve((req.result || []).filter((t) => t.profileId === bp.id));
                });
              })();
          await replaceAllTransactions([...existingTxs, ...unique], bp.id);
        }
      } else {
        await replaceAllTransactions(backupTxs, bp.id);
      }
      await finishRestoreForProfile(bp, choice, backupData);
      await addOrUpdateProfile(bp);
    }

    if (pendingNewProfiles.length > 0) {
      setShowAddNewProfilesConfirm(true);
      return;
    }

    handleClearFilter();
    setConflictProfiles([]);
    setConflictChoices({});
    setPendingNewProfiles([]);
    setAddNewProfiles(null);
    setPendingBackup(null);
    setShowRestoreConfirm(false);
    setShowConflictModal(false);
    const allLocal = (pendingBackup?.profiles || []).every((bp) => (conflictChoices[bp.id] || "backup") === "local");
    const hasMerge = (pendingBackup?.profiles || []).some((bp) => (conflictChoices[bp.id] || "backup") === "merge");
    setRestoreDoneType(allLocal ? "local" : hasMerge ? "merge" : "restore");
    setShowRestoreDone(true);
  };

  const handleRestoreConfirm = async () => {
    await finishRestore(pendingBackup.profiles || [], pendingBackup);
  };

  return (
    <div className="min-h-screen bg-transparent">
      {driveMessage === "blocked" && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] bg-white border border-orange-200 rounded-xl shadow-lg px-4 py-3 max-w-sm w-full mx-4">
          <div className="flex justify-between items-start gap-2">
            <p className="text-sm text-orange-700">⚠️ Свързването е отменено. Натиснете <strong>'Свържи с Google Drive'</strong> за да опитате отново.</p>
            <button onClick={() => driveSetMessage("")} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
          </div>
        </div>
      )}
      {driveMessage && driveMessage !== "allow" && driveMessage !== "blocked" && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-3 max-w-sm w-full mx-4">
          <p className="text-sm text-gray-700 text-center">{driveMessage}</p>
        </div>
      )}
      <div className="max-w-3xl mx-auto px-4 py-6">

        {/* Transaction Form */}
        <TransactionForm
          onAdd={addTransaction}
          onEdit={editTransaction}
          editingTransaction={editingTransaction}
          onCancelEdit={() => setEditingTransaction(null)}
          expenseCategories={expenseCategories}
          incomeCategories={incomeCategories}
          transactions={transactions}
          currency={currency}
          rate={rate}
          onUpdateCurrency={updateCurrency}
          onResetToEur={resetToEur}
          convert={convert}
          isLoaded={currencyLoaded}
          activeProfile={activeProfile}
          onOpenProfileModal={() => setShowProfileModal(true)}
        />

        {/* Summary Cards */}
        <SummaryCards
          summary={summary}
          isFiltered={isFiltered}
          budgets={budgets}
          filteredTransactions={filteredTransactions}
          allTransactions={transactions}
        />

        {/* Filter Bar */}
        <div className="bg-blue-50 rounded-2xl shadow-md overflow-hidden mb-6">
          <button
            onClick={() => setShowFilterPanel((prev) => !prev)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition"
          >
            <div className="flex items-center gap-2">
              <Search className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-semibold text-gray-600">Филтриране</span>
              {isFiltered && (
                <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-lg font-bold animate-pulse">
                  ⚠️ АКТИВЕН ФИЛТЪР
                </span>
              )}
            </div>
            <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showFilterPanel ? "rotate-180" : ""}`} />
          </button>
          {showFilterPanel && (
            <div className="border-t border-gray-100">
              <FilterBar
                filters={filters}
                setFilters={setFilters}
                onFilter={handleFilter}
                onClear={handleClearFilter}
                isFiltered={isFiltered}
                expenseCategories={expenseCategories}
                incomeCategories={incomeCategories}
                savedFilters={savedFilters}
                onSaveFilter={saveFilter}
                onDeleteFilter={deleteFilter}
              />
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col gap-3 mb-6">

          {/* Данни */}
          <div className="bg-blue-50 rounded-2xl shadow-md overflow-hidden">
            <button
              onClick={() => setShowDataPanel((prev) => !prev)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition"
            >
              <div className="flex items-center gap-2">
                <FileDown className="w-4 h-4 text-gray-400" />
                <span className="text-sm font-semibold text-gray-600">Данни</span>
              </div>
              <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showDataPanel ? "rotate-180" : ""}`} />
            </button>
            {showDataPanel && (
              <div className="px-4 pb-4 flex flex-col gap-2 border-t border-gray-100 pt-3">
                <button
                  onClick={() => setShowMonthlyStats(true)}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition"
                >
                  <TrendingUp className="w-4 h-4" />
                  Месечна статистика
                </button>
                <button
                  onClick={() => setShowCharts(true)}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-purple-50 text-purple-500 hover:bg-purple-100 transition"
                >
                  <BarChart2 className="w-4 h-4" />
                  Графики
                </button>
                <button
                  onClick={() => { setImportExportMode("import"); setShowImportExport(true); }}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-orange-50 text-orange-500 hover:bg-orange-100 transition"
                >
                  <Upload className="w-4 h-4" />
                  Импорт от Excel
                </button>
                <button
                  onClick={() => { setImportExportMode("export"); setShowImportExport(true); }}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-green-50 text-green-600 hover:bg-green-100 transition"
                >
                  <FileDown className="w-4 h-4" />
                  Експорт към Excel
                </button>
                <button
                  onClick={handleBackupExport}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-blue-50 text-blue-500 hover:bg-blue-100 transition"
                >
                  <FileDown className="w-4 h-4" />
                  Backup
                </button>
                <button
                  onClick={() => { backupFileRef.current.value = ""; backupFileRef.current.click(); }}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-blue-50 text-blue-500 hover:bg-blue-100 transition"
                >
                  <Upload className="w-4 h-4" />
                  Restore
                </button>
                <button
                  onClick={() => setShowDeleteAll(true)}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-red-50 text-red-500 hover:bg-red-100 transition"
                >
                  <Trash2 className="w-4 h-4" />
                  Изтрий всички данни
                </button>
                <div className="border-t border-gray-200 pt-2 mt-1">
                  <p className="text-xs font-semibold text-gray-400 mb-2 px-1">Google Drive</p>
                  {!driveConnected ? (
                    <>
                      <div className="text-xs text-orange-500 font-medium px-1 mb-2 bg-orange-50 rounded-lg py-1">
                        ⚠️ ако браузърът поиска разрешение за cookies - разрешете и натиснете бутона "Свържи с Google Drive" отново
                      </div>
                      <button
                        onClick={() => { setShowDataPanel(true); driveConnect(); }}
                        disabled={driveLoading}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-blue-50 text-blue-500 hover:bg-blue-100 transition w-full"
                      >
                        🔗 {driveLoading ? "Свързване..." : "Свържи с Google Drive"}
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center justify-between px-1 py-1 mb-1">
                        <span className="text-xs text-gray-500">Авто при всяка промяна</span>
                        <button
                          onClick={() => driveToggleAutoSync(!driveAutoSync)}
                          className={`w-10 h-5 rounded-full transition-colors ${driveAutoSync ? "bg-blue-400" : "bg-gray-300"}`}
                        >
                          <span className={`block w-4 h-4 bg-white rounded-full shadow transition-transform mx-0.5 ${driveAutoSync ? "translate-x-5" : "translate-x-0"}`} />
                        </button>
                      </div>
                      <button
                        onClick={handleDriveUpload}
                        disabled={driveLoading}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-blue-50 text-blue-500 hover:bg-blue-100 transition w-full mb-1"
                      >
                        ☁️ {driveLoading ? "Качване..." : "Запази в Drive"}
                      </button>
                      <button
                        onClick={async () => {
                          const data = await driveDownloadBackup(activeProfile?.name);
                          if (data) {
                            setPendingBackup(data);
                            const conflicts = (data.profiles || []).filter((bp) =>
                              profiles.some((lp) => lp.id === bp.id || lp.name.toLowerCase() === bp.name.toLowerCase())
                            );
                            const newProfiles = (data.profiles || []).filter((bp) =>
                              !profiles.some((lp) => lp.id === bp.id || lp.name.toLowerCase() === bp.name.toLowerCase())
                            );
                            setPendingNewProfiles(newProfiles);
                            if (conflicts.length > 0) {
                              const initialChoices = {};
                              conflicts.forEach((p) => { initialChoices[p.id] = "backup"; });
                              setConflictProfiles(conflicts);
                              setConflictChoices(initialChoices);
                              setShowConflictModal(true);
                            } else {
                              setShowRestoreConfirm(true);
                            }
                          }
                        }}
                        disabled={driveLoading}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-green-50 text-green-600 hover:bg-green-100 transition w-full mb-1"
                      >
                        ⬇️ {driveLoading ? "Изтегляне..." : "Възстанови от Drive"}
                      </button>
                      <button
                        onClick={driveDisconnect}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-red-50 text-red-400 hover:bg-red-100 transition w-full"
                      >
                        🔌 Изключи Google Drive
                      </button>
                    </>
                  )}
                  {null}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Бутони над историята */}
        <div className="flex flex-col gap-3 mb-3">
          <button
            onClick={() => setShowBudget(true)}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-medium bg-orange-50 text-orange-500 hover:bg-orange-100 transition shadow-sm"
          >
            <AlertTriangle className="w-4 h-4" />
            Бюджетни лимити
          </button>
          <button
            onClick={() => setShowCategoryManager(true)}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-medium bg-green-50 text-green-600 hover:bg-green-100 transition shadow-sm"
          >
            <Settings className="w-4 h-4" />
            Управление на категории
          </button>
          <button
            onClick={() => setShowRecurringModal(true)}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-medium bg-purple-50 text-purple-500 hover:bg-purple-100 transition shadow-sm"
          >
            <RefreshCw className="w-4 h-4" />
            Повтарящи се транзакции
          </button>
          
          <button
            onClick={() => setShowUserGuide(true)}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-medium bg-blue-50 text-blue-500 hover:bg-blue-100 transition shadow-sm"
          >
            <Info className="w-4 h-4" />
            Ръководство за потребителя
          </button>
        </div>

        {/* Transaction List */}
        <TransactionList
          transactions={filteredTransactions}
          isFiltered={isFiltered}
          onEdit={(t) => {
            setEditingTransaction(t);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          onDelete={deleteTransaction}
        />
      </div>

      {/* Modals */}
      {showCategoryManager && (
        <CategoryManager
          expenseCategories={expenseCategories}
          incomeCategories={incomeCategories}
          onAdd={addCategory}
          onEdit={editCategory}
          onDelete={handleDeleteCategory}
          onClose={() => setShowCategoryManager(false)}
        />
      )}

      
      {showImportExport && (
        <ImportExportModal
          onClose={() => setShowImportExport(false)}
          transactions={transactions}
          filteredTransactions={filteredTransactions}
          isFiltered={isFiltered}
          activeFilters={activeFilters}
          onImportAdd={addTransactions}
          onImportReplace={replaceAllTransactions}
          onCategoriesImported={handleCategoriesImported}
          mode={importExportMode}
          expenseCategories={expenseCategories}
          incomeCategories={incomeCategories}
          profileName={activeProfile?.name}
        />
      )}

      {showMonthlyStats && (
        <MonthlyStats
          transactions={transactions}
          filteredTransactions={filteredTransactions}
          isFiltered={isFiltered}
          activeFilters={activeFilters}
          onClose={() => setShowMonthlyStats(false)}
          rollingMonths={rollingMonths}
          onRollingMonthsChange={setRollingMonths}
          profileName={activeProfile?.name}
        />
      )}

      {showCharts && (
        <ChartsModal
          transactions={transactions}
          filteredTransactions={filteredTransactions}
          isFiltered={isFiltered}
          activeFilters={activeFilters}
          onClose={() => setShowCharts(false)}
          rollingMonths={rollingMonths}
        />
      )}

      <input
        ref={backupFileRef}
        type="file"
        accept=".json"
        onChange={handleBackupFileSelect}
        className="hidden"
      />
      {showRestoreDuplicates && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-blue-50 rounded-2xl shadow-xl w-full max-w-sm max-h-[90vh] overflow-y-auto">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-700">Вероятни дубликати</h2>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div className="bg-orange-50 rounded-xl px-3 py-2 text-xs text-orange-700">
                ⚠️ Намерени са <strong>{restoreDuplicates.length}</strong> вероятни дубликата (същата дата, категория, тип и сума вече съществуват). Уникални транзакции за добавяне: <strong>{restoreUniqueTransactions.length}</strong>.
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-gray-600">Вероятни дубликати:</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setRestoreSelectedDuplicates(restoreDuplicates.map((t) => t.id))}
                      className="text-xs px-2 py-1 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition"
                    >
                      Избери всички дубликати
                    </button>
                    <button
                      onClick={() => setRestoreSelectedDuplicates([])}
                      className="text-xs px-2 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
                    >
                      Откажи всички дубликати
                    </button>
                  </div>
                </div>
                <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
                  {restoreDuplicates.map((t) => (
                    <label
                      key={t.id}
                      className={`flex items-center gap-3 px-3 py-2 rounded-xl border cursor-pointer transition ${
                        restoreSelectedDuplicates.includes(t.id)
                          ? "border-blue-300 bg-blue-50"
                          : "border-gray-200 bg-white"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={restoreSelectedDuplicates.includes(t.id)}
                        onChange={() => setRestoreSelectedDuplicates((prev) =>
                          prev.includes(t.id) ? prev.filter((d) => d !== t.id) : [...prev, t.id]
                        )}
                        className="accent-blue-500 flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-700 truncate">{t.category}</p>
                        <p className="text-xs text-gray-400">{t.date} · {Number(t.amount).toFixed(2)} EUR</p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
                        t.type === "expense" ? "bg-red-100 text-red-600" : "bg-green-100 text-green-600"
                      }`}>
                        {t.type === "expense" ? "Разход" : "Приход"}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <button
                onClick={handleRestoreDuplicatesConfirm}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition"
              >
                Потвърди ({restoreUniqueTransactions.length + restoreSelectedDuplicates.length} транзакции)
              </button>
            </div>
          </div>
        </div>
      )}
      {showAddNewProfilesConfirm && pendingNewProfiles.length > 0 && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-blue-50 rounded-2xl shadow-xl w-full max-w-sm">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-700">Нови профили в backup файла</h2>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-sm text-gray-600">
                Следните профили са в backup файла, но не съществуват локално. Искате ли да ги добавите заедно с техните данни?
              </p>
              <div className="flex flex-col gap-1.5">
                {pendingNewProfiles.map((p) => (
                  <div key={p.id} className="bg-white rounded-xl px-3 py-2 border border-gray-200 text-sm text-gray-700">
                    👤 {p.name}
                  </div>
                ))}
              </div>
              <button
                onClick={() => handleAddNewProfilesConfirm(true)}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 transition"
              >
                Да, добави ги
              </button>
              <button
                onClick={() => handleAddNewProfilesConfirm(false)}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
              >
                Не, пропусни ги
              </button>
            </div>
          </div>
        </div>
      )}
      {showConflictModal && conflictProfiles.length > 0 && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-blue-50 rounded-2xl shadow-xl w-full max-w-sm">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-700">Съвпадащи профили</h2>
            </div>
            <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
              <p className="text-sm text-gray-600">
                Следните профили съществуват и в приложението, и в backup файла. Изберете какво да се направи за всеки:
              </p>
              {conflictProfiles.map((p) => (
                <div key={p.id} className="bg-white rounded-xl p-3 border border-gray-200">
                  <p className="text-sm font-semibold text-gray-700 mb-2">👤 {p.name}</p>
                  <div className="flex flex-col gap-1.5">
                    <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                      <input
                        type="radio"
                        name={`conflict_${p.id}`}
                        value="backup"
                        checked={conflictChoices[p.id] === "backup"}
                        onChange={() => setConflictChoices((prev) => ({ ...prev, [p.id]: "backup" }))}
                      />
                      Зареди данните от backup файла (замести локалните)
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                      <input
                        type="radio"
                        name={`conflict_${p.id}`}
                        value="local"
                        checked={conflictChoices[p.id] === "local"}
                        onChange={() => setConflictChoices((prev) => ({ ...prev, [p.id]: "local" }))}
                      />
                      Запази само локалните данни (игнорирай backup-а)
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                      <input
                        type="radio"
                        name={`conflict_${p.id}`}
                        value="merge"
                        checked={conflictChoices[p.id] === "merge"}
                        onChange={() => setConflictChoices((prev) => ({ ...prev, [p.id]: "merge" }))}
                      />
                      Обедини (добави транзакциите от backup-а към съществуващите)
                    </label>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-5 py-4 border-t border-gray-100 flex flex-col gap-2">
              <button
                onClick={() => { setShowConflictModal(false); setShowRestoreConfirm(true); }}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 transition"
              >
                Продължи
              </button>
              <button
                onClick={() => { setShowConflictModal(false); setConflictProfiles([]); setConflictChoices({}); setPendingBackup(null); }}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
              >
                Откажи
              </button>
            </div>
          </div>
        </div>
      )}

      {showRestoreConfirm && pendingBackup && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-blue-50 rounded-2xl shadow-xl w-full max-w-sm">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-700">
                Restore от Backup
              </h2>
            </div>
            <div className="px-5 py-5 space-y-3">
              {conflictChoices[pendingBackup.activeProfileId || activeProfileId] !== "local" &&
               conflictChoices[pendingBackup.activeProfileId || activeProfileId] !== "merge" && (
                <div className="bg-orange-50 rounded-xl p-4">
                  <p className="text-sm text-orange-700 font-medium mb-1">⚠️ Внимание!</p>
                  <p className="text-sm text-orange-600">
                    Всички съществуващи данни ({transactions.length} транзакции) ще бъдат заменени с данните от backup файла ({pendingBackup.transactions.filter(t => t.profileId === (pendingBackup.activeProfileId || activeProfileId)).length} транзакции).
                  </p>
                  <p className="text-sm text-orange-600 mt-2">
                    Това действие не може да бъде отменено.
                  </p>
                </div>
              )}
              {conflictChoices[pendingBackup.activeProfileId || activeProfileId] === "merge" && (
                <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
                  <p className="text-sm text-blue-700 font-medium mb-1">ℹ️ Обединяване</p>
                  <p className="text-sm text-blue-600">
                    Транзакциите от backup файла ще бъдат добавени към съществуващите. Вероятните дубликати ще бъдат показани за преглед.
                  </p>
                </div>
              )}
              {conflictChoices[pendingBackup.activeProfileId || activeProfileId] === "local" && (
                <div className="bg-green-50 rounded-xl p-4 border border-green-200">
                  <p className="text-sm text-green-700 font-medium mb-1">✅ Локалните данни се запазват</p>
                  <p className="text-sm text-green-600">
                    Данните от backup файла за този профил няма да бъдат заредени.
                  </p>
                </div>
              )}
              <button
                onClick={handleRestoreConfirm}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 transition"
              >
                Потвърди
              </button>
              <button
                onClick={() => { setShowRestoreConfirm(false); setPendingBackup(null); }}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
              >
                Откажи
              </button>
            </div>
          </div>
        </div>
      )}

      {showWeeklyBackup && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-blue-50 rounded-2xl shadow-xl w-full max-w-sm">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-700">
                Седмичен backup
              </h2>
            </div>
            <div className="px-5 py-5 space-y-3">
              <p className="text-sm text-gray-600">
                Искате ли да свалите седмичния backup файл с всички данни?
              </p>
              <button
                onClick={async () => {
                  const data = await buildBackupData();
                  exportBackup(data.transactions, data.expenseCategories, data.incomeCategories, data.savedFilters, data.currency, data.rate, data.budgets, data.profiles, data.activeProfileId, data.recurringItems, activeProfile?.name, data.profileCategories);
                  setShowWeeklyBackup(false);
                }}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 transition"
              >
                Да, свали backup
              </button>
              <button
                onClick={() => setShowWeeklyBackup(false)}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
              >
                Не сега
              </button>
            </div>
          </div>
        </div>
      )}

      {showBudget && (
        <BudgetModal
          budgets={budgets}
          onSave={updateBudgets}
          onClose={() => setShowBudget(false)}
          expenseCategories={expenseCategories}
          activeFilterCategories={activeFilters.categories}
          isFiltered={isFiltered}
        />
      )}

      {showProfileModal && (
        <ProfileModal
          profiles={profiles}
          activeProfileId={activeProfileId}
          onSwitch={switchProfile}
          onCreate={createProfile}
          onDelete={handleDeleteProfile}
          onRename={renameProfile}
          onClose={() => setShowProfileModal(false)}
          onOpenMerge={() => setShowMergeModal(true)}
        />
      )}
      {showRecurringModal && (
        <RecurringModal
          recurringItems={recurringItems}
          expenseCategories={expenseCategories}
          incomeCategories={incomeCategories}
          onAdd={addRecurring}
          onEdit={editRecurring}
          onDelete={deleteRecurring}
          onClose={() => setShowRecurringModal(false)}
        />
      )}

      {showPendingModal && pendingRecurring.length > 0 && (
        <PendingRecurringModal
          pendingItems={pendingRecurring}
          onConfirm={handleConfirmPending}
          onClose={() => {
            // При затваряне без потвърждение — маркираме всички като видяни
            handleConfirmPending([]);
          }}
        />
      )}
      {showUserGuide && (
        <UserGuideModal onClose={() => setShowUserGuide(false)} />
      )}

      {showRestoreDone && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-blue-50 rounded-2xl shadow-xl w-full max-w-sm">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-700">
                Restore завършен
              </h2>
            </div>
            <div className="px-5 py-5 space-y-3">
              <div className="bg-green-50 rounded-xl p-4">
                <p className="text-sm text-green-700 font-medium mb-1">
                  {restoreDoneType === "merge" ? "✅ Данните са обединени успешно." : restoreDoneType === "local" ? "✅ Локалните данни са запазени." : "✅ Данните са възстановени успешно."}
                </p>
              </div>
              <button
                onClick={() => setShowRestoreDone(false)}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 transition"
              >
                Разбрах
              </button>
            </div>
          </div>
        </div>
      )}

      {showMergeModal && (
        <MergeProfileModal
          onClose={() => setShowMergeModal(false)}
          onMerge={handleMergeImport}
          activeProfile={activeProfile}
          existingTransactions={transactions}
        />
      )}

      {showDeleteAll && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-blue-50 rounded-2xl shadow-xl w-full max-w-sm">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-700">
                Изтриване на всички данни
              </h2>
            </div>
            <div className="px-5 py-5 space-y-3">
              <div className="bg-red-50 rounded-xl p-4">
                <p className="text-sm text-red-700 font-medium mb-1">⚠️ Внимание!</p>
                <p className="text-sm text-red-600">
                  Всички транзакции ({transactions.length}) ще бъдат изтрити. Категориите ще останат.
                </p>
                <p className="text-sm text-red-600 mt-2">
                  Това действие не може да бъде отменено.
                </p>
              </div>
              <button
                onClick={() => {
                  replaceAllTransactions([]);
                  setShowDeleteAll(false);
                }}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-red-500 text-white hover:bg-red-600 transition"
              >
                Да, изтрий всичко
              </button>
              <button
                onClick={() => setShowDeleteAll(false)}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
              >
                Откажи
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;