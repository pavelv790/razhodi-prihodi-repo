import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Settings, Info, Upload, FileDown, Trash2, TrendingUp, ChevronDown, Search, BarChart2, AlertTriangle, User, RefreshCw } from "lucide-react";
import { useTransactions } from "./hooks/useTransactions";
import { useCategories, deleteProfileCategories } from "./hooks/useCategories";
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
    driveUploadBackup(buildBackupData(), activeProfile.name);
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
  const handleMergeImport = (transactions, expenseCategories, incomeCategories) => {
    addTransactions(transactions);
    addCategoriesFromImport("expense", expenseCategories);
    addCategoriesFromImport("income", incomeCategories);
  };
  const buildBackupData = () => ({
    version: "1.5",
    date: new Date().toISOString(),
    profiles,
    activeProfileId,
    transactions,
    expenseCategories,
    incomeCategories,
    profileCategories: { [activeProfileId]: { expense: expenseCategories, income: incomeCategories } },
    savedFilters,
    currency,
    rate,
    budgets,
    recurringItems,
  });
  
  const handleDriveUpload = async () => {
    await driveUploadBackup(buildBackupData(), activeProfile?.name);
  };

  const handleBackupExport = () => {
    exportBackup(transactions, expenseCategories, incomeCategories, savedFilters, currency, rate, budgets, profiles, activeProfileId, recurringItems, activeProfile?.name);
  };

  const handleBackupFileSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = await importBackup(file);
      setPendingBackup(data);
      setShowRestoreConfirm(true);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleRestoreConfirm = async () => {
    const targetProfileId = pendingBackup.activeProfileId || activeProfileId;

    // 1. ПЪРВО записваме транзакциите в IndexedDB — ПРЕДИ да сменяме профила
    const transactionsToRestore = pendingBackup.transactions
      .filter((t) => t.profileId === targetProfileId)
      .map((t) => ({ ...t, profileId: targetProfileId }));
    await replaceAllTransactions(transactionsToRestore);

    // 2. СЛЕД това записваме профилите — смяната на activeProfileId
    // ще предизвика презареждане, но транзакциите вече са в IndexedDB
    if (pendingBackup.profiles) {
      await restoreProfiles(pendingBackup.profiles, targetProfileId);
    }

    // 4. Категории — per-profile ако има, иначе стар формат
    if (pendingBackup.profileCategories?.[targetProfileId]) {
      const cats = pendingBackup.profileCategories[targetProfileId];
      setExpenseCategoriesFromBackup(cats.expense || []);
      setIncomeCategoriesFromBackup(cats.income || []);
    } else {
      setExpenseCategoriesFromBackup(pendingBackup.expenseCategories || []);
      setIncomeCategoriesFromBackup(pendingBackup.incomeCategories || []);
    }

    // 5. Филтри
    handleClearFilter();
    if (pendingBackup.savedFilters) {
      await restoreFilters(pendingBackup.savedFilters);
      setSavedFilters(pendingBackup.savedFilters.filter(
        (f) => f.profileId === targetProfileId
      ));
    }

    // 6. Валута и бюджети
    if (pendingBackup.currency) {
      restoreCurrency(pendingBackup.currency, pendingBackup.rate);
    }
    if (pendingBackup.budgets) {
      restoreBudgets(pendingBackup.budgets);
    }
    if (pendingBackup.recurringItems) {
      await restoreRecurring(pendingBackup.recurringItems);
    }

    setPendingBackup(null);
    setShowRestoreConfirm(false);
    setShowRestoreDone(true);
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
                          if (data) { setPendingBackup(data); setShowRestoreConfirm(true); }
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
                  {driveMessage && driveMessage !== "blocked" && (
                    <p className="text-xs text-gray-500 mt-2 px-1">{driveMessage}</p>
                  )}
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

      {showRestoreConfirm && pendingBackup && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-blue-50 rounded-2xl shadow-xl w-full max-w-sm">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-700">
                Restore от Backup
              </h2>
            </div>
            <div className="px-5 py-5 space-y-3">
              <div className="bg-orange-50 rounded-xl p-4">
                <p className="text-sm text-orange-700 font-medium mb-1">⚠️ Внимание!</p>
                <p className="text-sm text-orange-600">
                  Всички съществуващи данни ({transactions.length} транзакции) ще бъдат заменени с данните от backup файла ({pendingBackup.transactions.filter(t => t.profileId === (pendingBackup.activeProfileId || activeProfileId)).length} транзакции).
                </p>
                <p className="text-sm text-orange-600 mt-2">
                  Това действие не може да бъде отменено.
                </p>
              </div>
              <button
                onClick={handleRestoreConfirm}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 transition"
              >
                Да, зареди backup-а
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
                onClick={() => {
                  exportBackup(transactions, expenseCategories, incomeCategories, savedFilters, currency, rate, budgets, profiles, activeProfileId, recurringItems, activeProfile?.name);
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
                <p className="text-sm text-green-700 font-medium mb-1">✅ Данните са възстановени успешно.</p>
                <p className="text-sm text-green-600">
                  Ако backup файлът съдържа и други профили, влезте в съответния профил и направете Restore отново за да възстановите и неговите данни.
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