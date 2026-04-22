import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Settings, Info, Upload, FileDown, Trash2, TrendingUp, ChevronDown, Search, BarChart2, AlertTriangle } from "lucide-react";
import { useTransactions } from "./hooks/useTransactions";
import { useCategories } from "./hooks/useCategories";
import { exportBackup, importBackup } from "./utils/backup";
import SummaryCards from "./components/SummaryCards";
import FilterBar from "./components/FilterBar";
import TransactionForm from "./components/TransactionForm";
import TransactionList from "./components/TransactionList";
import CategoryManager from "./components/CategoryManager";
import AboutModal from "./components/AboutModal";
import ImportExportModal from "./components/ImportExportModal";
import MonthlyStats from "./components/MonthlyStats";
import ChartsModal from "./components/ChartsModal";
import { useSavedFilters } from "./hooks/useSavedFilters";
import { useCurrency } from "./hooks/useCurrency";
import { useBudgets } from "./hooks/useBudgets";
import BudgetModal from "./components/BudgetModal";

const App = () => {
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
  } = useTransactions();

  const {
    expenseCategories,
    incomeCategories,
    addCategory,
    editCategory,
    deleteCategory,
    addCategoriesFromImport,
    setExpenseCategoriesFromBackup,
    setIncomeCategoriesFromBackup,
  } = useCategories();
  const { savedFilters, saveFilter, deleteFilter, restoreFilters, setSavedFilters } = useSavedFilters();
  const { currency, rate, updateCurrency, resetToEur, convert, isLoaded: currencyLoaded, restoreCurrency } = useCurrency();
  const { budgets, updateBudgets, restoreBudgets } = useBudgets();

  const [editingTransaction, setEditingTransaction] = useState(null);
  const [filters, setFilters] = useState({ fromDate: "", toDate: "", categories: [] });
  const [activeFilters, setActiveFilters] = useState({ fromDate: "", toDate: "", categories: [] });
  const [isFiltered, setIsFiltered] = useState(false);
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showImportExport, setShowImportExport] = useState(false);
  const [importExportMode, setImportExportMode] = useState(null);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [pendingBackup, setPendingBackup] = useState(null);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [showMonthlyStats, setShowMonthlyStats] = useState(false);
  const [showCharts, setShowCharts] = useState(false);
  const [rollingMonths, setRollingMonths] = useState(12);
  const [showBudget, setShowBudget] = useState(false);
  const [showDataPanel, setShowDataPanel] = useState(false);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [showWeeklyBackup, setShowWeeklyBackup] = useState(false);
  const backupFileRef = useRef(null);

  const filteredTransactions = useMemo(
    () => getFilteredTransactions(activeFilters),
    [activeFilters, getFilteredTransactions]
  );
  const summary = useMemo(
    () => getSummary(filteredTransactions),
    [filteredTransactions]
  );

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

  const handleCategoriesImported = (newCategories) => {
    addCategoriesFromImport("expense", newCategories.expense);
    addCategoriesFromImport("income", newCategories.income);
  };

  const handleBackupExport = () => {
    exportBackup(transactions, expenseCategories, incomeCategories, savedFilters, currency, rate);
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
    replaceAllTransactions(pendingBackup.transactions);
    setExpenseCategoriesFromBackup(pendingBackup.expenseCategories);
    setIncomeCategoriesFromBackup(pendingBackup.incomeCategories);
    handleClearFilter();
    if (pendingBackup.savedFilters) {
      await restoreFilters(pendingBackup.savedFilters);
      setSavedFilters(pendingBackup.savedFilters);
    }
    if (pendingBackup.currency) {
      restoreCurrency(pendingBackup.currency, pendingBackup.rate);
    }
    setPendingBackup(null);
    setShowRestoreConfirm(false);
  };

  return (
    <div className="min-h-screen bg-transparent">
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
            onClick={() => setShowAbout(true)}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-medium bg-blue-50 text-blue-500 hover:bg-blue-100 transition shadow-sm"
          >
            <Info className="w-4 h-4" />
            За приложението
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

      {showAbout && (
        <AboutModal onClose={() => setShowAbout(false)} />
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
                  Всички съществуващи данни ({transactions.length} транзакции) ще бъдат заменени с данните от backup файла ({pendingBackup.transactions.length} транзакции).
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
                  exportBackup(transactions, expenseCategories, incomeCategories, savedFilters, currency, rate);
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