import { useState, useEffect, useRef } from "react";
import { PlusCircle, Save, CheckCircle, ChevronDown, ChevronUp } from "lucide-react";
import { getTodayString, isValidDate } from "../utils/formatters";
import DateInput from "./DateInput";

const TransactionForm = ({
  onAdd,
  onEdit,
  editingTransaction,
  onCancelEdit,
  expenseCategories,
  incomeCategories,
  transactions,
}) => {
  const [type, setType] = useState("expense");
  const [category, setCategory] = useState("");
  const [categorySearch, setCategorySearch] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(getTodayString());
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState({});
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showExtra, setShowExtra] = useState(false);
  const amountRef = useRef(null);
  const dateRef = useRef(null);
  const descriptionRef = useRef(null);

  const categories = type === "expense" ? expenseCategories : incomeCategories;

  const categoriesWithCount = categories.map((cat) => ({
    name: cat,
    count: (transactions || []).filter((t) => t.category === cat).length,
  }));

  const filteredCategories = categoriesWithCount
    .filter((cat) =>
      cat.name.toLowerCase().includes(categorySearch.toLowerCase())
    )
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name, "bg", { sensitivity: "base" });
    })
    .map((cat) => cat.name);

  useEffect(() => {
    if (editingTransaction) {
      setType(editingTransaction.type);
      setCategory(editingTransaction.category);
      setCategorySearch(editingTransaction.category);
      setAmount(String(editingTransaction.amount));
      setDate(editingTransaction.date);
      setDescription(editingTransaction.description || "");
      setErrors({});
      setShowExtra(true);
    }
  }, [editingTransaction]);

  useEffect(() => {
    setCategory("");
    setCategorySearch("");
    setErrors({});
  }, [type]);

  const validate = () => {
    const newErrors = {};
    if (!category) newErrors.category = "Изберете категория";
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0)
      newErrors.amount = "Въведете валидна сума";
    if (showExtra && !isValidDate(date))
      newErrors.date = "Въведете валидна дата (ДД/ММ/ГГГГ)";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    const transaction = {
      type,
      category,
      amount: parseFloat(Number(amount).toFixed(2)),
      date,
      description: description.trim(),
    };
    if (editingTransaction) {
      onEdit(editingTransaction.id, transaction);
    } else {
      onAdd(transaction);
    }
    if (!editingTransaction) setShowSuccess(true);
    handleReset();
    setTimeout(() => setShowSuccess(false), 1000);
  };

  const handleReset = () => {
    setType("expense");
    setCategory("");
    setCategorySearch("");
    setAmount("");
    setDate(getTodayString());
    setDescription("");
    setErrors({});
    setShowCategoryDropdown(false);
    setShowExtra(false);
    if (onCancelEdit) onCancelEdit();
  };

  const handleCategorySelect = (cat) => {
    setCategory(cat);
    setCategorySearch(cat);
    setShowCategoryDropdown(false);
    setErrors((prev) => ({ ...prev, category: undefined }));
    setTimeout(() => amountRef.current?.focus(), 50);
  };

  return (
    <div className="bg-blue-50 rounded-2xl p-5 shadow-md mb-6">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
        {editingTransaction ? "Редактиране на транзакция" : "Нова транзакция"}
      </h2>

      {/* Тип */}
      <div className="flex gap-3 mb-4">
        <button
          onClick={() => setType("expense")}
          className={`flex-1 py-2 rounded-xl font-medium text-sm transition ${
            type === "expense"
              ? "bg-red-500 text-white shadow"
              : "bg-red-50 text-red-400 hover:bg-red-100"
          }`}
        >
          Разход
        </button>
        <button
          onClick={() => setType("income")}
          className={`flex-1 py-2 rounded-xl font-medium text-sm transition ${
            type === "income"
              ? "bg-green-500 text-white shadow"
              : "bg-green-50 text-green-400 hover:bg-green-100"
          }`}
        >
          Приход
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Категория */}
        <div className="relative">
          <label className="block text-xs text-gray-500 mb-1">Категория</label>
          <input
            type="text"
            placeholder="Търси категория..."
            value={categorySearch}
            onChange={(e) => {
              setCategorySearch(e.target.value);
              setCategory("");
              setShowCategoryDropdown(true);
            }}
            onFocus={() => {
              setCategorySearch("");
              setCategory("");
              setShowCategoryDropdown(true);
            }}
            onBlur={() => setTimeout(() => setShowCategoryDropdown(false), 150)}
            className={`w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 ${
              errors.category ? "border-red-400" : "border-gray-200"
            }`}
          />
          {errors.category && (
            <p className="text-xs text-red-500 mt-1">{errors.category}</p>
          )}
          {showCategoryDropdown && filteredCategories.length > 0 && (
            <div className="absolute z-10 w-full bg-blue-50 border border-gray-200 rounded-xl shadow-lg mt-1 max-h-48 overflow-y-auto">
              {filteredCategories.map((cat) => (
                <div
                  key={cat}
                  onMouseDown={() => handleCategorySelect(cat)}
                  className="px-3 py-2 text-sm hover:bg-emerald-50 cursor-pointer"
                >
                  {cat}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Сума */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">Сума (EUR)</label>
          <input
            ref={amountRef}
            type="number"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            min="0"
            step="0.01"
            className={`w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 ${
              errors.amount ? "border-red-400" : "border-gray-200"
            }`}
          />
          {errors.amount && (
            <p className="text-xs text-red-500 mt-1">{errors.amount}</p>
          )}
        </div>
      </div>

      {/* Бутон за дата и описание */}
      <button
        onClick={() => setShowExtra((prev) => !prev)}
        className="flex items-center gap-1 mt-3 text-xs text-gray-400 hover:text-gray-600 transition"
      >
        {showExtra ? (
          <>
            <ChevronUp className="w-3.5 h-3.5" /> Скрий дата и описание
          </>
        ) : (
          <>
            <ChevronDown className="w-3.5 h-3.5" /> + Дата и описание
          </>
        )}
      </button>

      {/* Дата и описание */}
      {showExtra && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Дата</label>
            <DateInput
              value={date}
              onChange={(val) => {
                setDate(val);
                if (val.length === 10) descriptionRef.current?.focus();
              }}
              hasError={!!errors.date}
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Описание <span className="text-gray-400">(по желание)</span>
            </label>
            <input
              ref={descriptionRef}
              type="text"
              placeholder="Добави описание..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
            />
          </div>
        </div>
      )}

      {/* Бутони */}
      <div className="flex gap-3 mt-4">
        <button
          onClick={handleSubmit}
          className={`flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-medium text-white transition shadow ${
            editingTransaction
              ? "bg-blue-500 hover:bg-blue-600"
              : showSuccess
              ? "bg-blue-600 hover:bg-blue-700"
              : type === "expense"
              ? "bg-red-500 hover:bg-red-600"
              : "bg-green-500 hover:bg-green-600"
          }`}
        >
          {editingTransaction ? (
            <>
              <Save className="w-4 h-4" /> Запази
            </>
          ) : showSuccess ? (
            <>
              <CheckCircle className="w-4 h-4" /> Добавено!
            </>
          ) : (
            <>
              <PlusCircle className="w-4 h-4" /> Добави
            </>
          )}
        </button>

        {editingTransaction && (
          <button
            onClick={handleReset}
            className="px-5 py-2 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
          >
            Отказ
          </button>
        )}
      </div>
    </div>
  );
};

export default TransactionForm;