import { useState } from "react";
import { X, Plus, Trash2 } from "lucide-react";
import { getFirstDayOfMonth, getLastDayOfMonth } from "../utils/formatters";
import DateInput from "./DateInput";

const BudgetModal = ({ budgets, onSave, onClose, expenseCategories, activeFilterCategories, isFiltered }) => {
  const [totalLimit, setTotalLimit] = useState(budgets.totalLimit || "");
  const [categoryLimits, setCategoryLimits] = useState(budgets.categoryLimits || {});
  const [fromDate, setFromDate] = useState(budgets.fromDate || "");
  const [toDate, setToDate] = useState(budgets.toDate || "");
  const [newCategory, setNewCategory] = useState("");
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [search, setSearch] = useState("");

  const handleSetCurrentMonth = () => {
    const today = new Date();
    setFromDate(getFirstDayOfMonth(today));
    setToDate(getLastDayOfMonth(today));
  };

  const handleAddCategory = (cat) => {
    if (!categoryLimits[cat]) {
      setCategoryLimits((prev) => ({ ...prev, [cat]: "" }));
    }
    setShowCategoryPicker(false);
    setSearch("");
  };

  const handleRemoveCategory = (cat) => {
    setCategoryLimits((prev) => {
      const copy = { ...prev };
      delete copy[cat];
      return copy;
    });
  };

  const handleCategoryLimitChange = (cat, value) => {
    setCategoryLimits((prev) => ({ ...prev, [cat]: value }));
  };

  const handleSave = () => {
    onSave({ totalLimit, categoryLimits, fromDate, toDate });
    onClose();
  };

  const filteredExpenseCategories = isFiltered && activeFilterCategories.length > 0
    ? expenseCategories.filter((cat) =>
        activeFilterCategories
          .filter((c) => c.endsWith("::expense"))
          .map((c) => c.replace("::expense", ""))
          .includes(cat)
      )
    : expenseCategories;

  const availableCategories = filteredExpenseCategories.filter(
    (cat) => !categoryLimits[cat] && cat !== "Без категория"
  );

  const filteredCategories = availableCategories.filter((cat) =>
    cat.toLowerCase().startsWith(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-blue-50 rounded-2xl shadow-xl w-full max-w-md max-h-[85vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-700">Бюджетни лимити</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* Период */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-gray-600">Период</span>
              <button
                onClick={handleSetCurrentMonth}
                className="text-xs px-3 py-1 rounded-lg bg-blue-100 text-blue-600 hover:bg-blue-200 transition"
              >
                Текущ месец
              </button>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 w-6">от</span>
                <DateInput value={fromDate} onChange={setFromDate} />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 w-6">до</span>
                <DateInput value={toDate} onChange={setToDate} />
              </div>
            </div>
          </div>

          {/* Общ лимит */}
          <div>
            <span className="text-sm font-semibold text-gray-600 block mb-2">
              Общ лимит за разходи
            </span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                value={totalLimit}
                onChange={(e) => setTotalLimit(e.target.value)}
                placeholder="няма лимит"
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
              <span className="text-sm text-gray-400">EUR</span>
            </div>
          </div>

          {/* Лимити по категории */}
          <div>
            <span className="text-sm font-semibold text-gray-600 block mb-2">
              Лимити по категории
            </span>

            {/* Съществуващи лимити */}
            <div className="space-y-2 mb-3">
              {Object.keys(categoryLimits).length === 0 && (
                <p className="text-xs text-gray-400">Няма зададени лимити по категории</p>
              )}
              {Object.entries(categoryLimits).map(([cat, val]) => (
                <div key={cat} className="flex items-center gap-2">
                  <span className="flex-1 text-sm text-gray-700 bg-red-50 rounded-xl px-3 py-2 truncate">
                    {cat}
                  </span>
                  <input
                    type="number"
                    min="0"
                    value={val}
                    onChange={(e) => handleCategoryLimitChange(cat, e.target.value)}
                    placeholder="лимит"
                    className="w-24 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                  <span className="text-xs text-gray-400">EUR</span>
                  <button
                    onClick={() => handleRemoveCategory(cat)}
                    className="p-1.5 rounded-lg bg-red-50 text-red-400 hover:bg-red-100 transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {/* Бутон за добавяне на категория */}
            {!showCategoryPicker ? (
              <button
                onClick={() => setShowCategoryPicker(true)}
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-red-50 text-red-500 hover:bg-red-100 transition"
              >
                <Plus className="w-4 h-4" />
                Добави категория
              </button>
            ) : (
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Търси категория..."
                  className="w-full px-3 py-2 text-sm focus:outline-none border-b border-gray-100"
                  autoFocus
                />
                <div className="max-h-40 overflow-y-auto">
                  {filteredCategories.length === 0 && (
                    <p className="text-xs text-gray-400 px-3 py-2">Няма резултати</p>
                  )}
                  {filteredCategories.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => handleAddCategory(cat)}
                      className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-red-50 transition"
                    >
                      {cat}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => { setShowCategoryPicker(false); setSearch(""); }}
                  className="w-full px-3 py-2 text-xs text-gray-400 hover:bg-gray-50 transition border-t border-gray-100"
                >
                  Откажи
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 flex gap-2">
          <button
            onClick={handleSave}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 transition"
          >
            Запази
          </button>
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
          >
            Откажи
          </button>
        </div>
      </div>
    </div>
  );
};

export default BudgetModal;