import { useState, useRef, useEffect } from "react";
import { Wallet, Settings, Info, Upload, FileDown, Trash2, TrendingUp, ChevronDown, Search } from "lucide-react";
import { useTransactions } from "./hooks/useTransactions";
import { useCategories } from "./hooks/useCategories";
import { exportBackup, importBackup } from "./utils/backup";
import { exportToExcel } from "./utils/excel";
import SummaryCards from "./components/SummaryCards";
import FilterBar from "./components/FilterBar";
import TransactionForm from "./components/TransactionForm";
import TransactionList from "./components/TransactionList";
import CategoryManager from "./components/CategoryManager";
import AboutModal from "./components/AboutModal";
import ImportExportModal from "./components/ImportExportModal";
import MonthlyStats from "./components/MonthlyStats";
import { useSavedFilters } from "./hooks/useSavedFilters";
import { useCurrency } from "./hooks/useCurrency";

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
  const { savedFilters, saveFilter, deleteFilter } = useSavedFilters();
  const { currency, rate, updateCurrency, resetToEur, convert, isLoaded: currencyLoaded } = useCurrency();

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
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [showDataPanel, setShowDataPanel] = useState(false);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const backupFileRef = useRef(null);

  const filteredTransactions = getFilteredTransactions(activeFilters);
  const summary = getSummary(filteredTransactions);

  useEffect(() => {
    if (transactions.length === 0) return;

    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    const weekKey = `auto_export_${monday.getFullYear()}_${monday.getMonth() + 1}_${monday.getDate()}`;

    const alreadyExported = localStorage.getItem(weekKey);
    if (!alreadyExported) {
      const confirm = window.confirm("Искате ли да свалите седмичния Excel файл с всички транзакции?");
      if (confirm) {
        exportToExcel(transactions, expenseCategories, incomeCategories);
      }
      localStorage.setItem(weekKey, "true");
    }
  }, [transactions]);

  const handleFilter = (newFilters) => {
    setActiveFilters(newFilters);
    setIsFiltered(
        !!(newFilters.fromDate || newFilters.toDate || (newFilters.categories && newFilters.categories.length > 0))
        );
          };
          
  const handleClearFilter = () => {
      const empty = { fromDate: "", toDate: "", categories: [] };
    setFilters(empty);
    setActiveFilters(empty);
    setIsFiltered(false);
  };

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
    exportBackup(transactions, expenseCategories, incomeCategories);
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

  const handleRestoreConfirm = () => {
    replaceAllTransactions(pendingBackup.transactions);
    setExpenseCategoriesFromBackup(pendingBackup.expenseCategories);
    setIncomeCategoriesFromBackup(pendingBackup.incomeCategories);
    setPendingBackup(null);
    setShowRestoreConfirm(false);
  };

  return (
    <div className="min-h-screen bg-transparent">
      <div className="max-w-3xl mx-auto px-4 py-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <div className="bg-emerald-100 p-2 rounded-xl">
              <Wallet className="w-5 h-5 text-emerald-500" />
            </div>
            <h1 className="text-lg font-bold text-gray-700">
              Разходи-Приходи
            </h1>
          </div>
          <button
            onClick={() => setShowAbout(true)}
            className="p-2 rounded-xl hover:bg-gray-100 transition"
          >
            <Info className="w-5 h-5 text-gray-400" />
          </button>
        </div>

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
        <SummaryCards summary={summary} isFiltered={isFiltered} />

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
                <span className="text-xs bg-emerald-100 text-emerald-600 px-2 py-0.5 rounded-lg">
                  Активен
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
          onClose={() => setShowMonthlyStats(false)}
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