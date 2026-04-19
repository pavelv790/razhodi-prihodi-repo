import { useState, useEffect, useRef } from "react";
import { PlusCircle, Save, CheckCircle, ChevronDown, Calendar, Globe } from "lucide-react";
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
  currency,
  rate,
  onUpdateCurrency,
  onResetToEur,
  convert,
  isLoaded,
}) => {
  const [type, setType] = useState("expense");
  const [category, setCategory] = useState("");
  const [stickyDate, setStickyDate] = useState(false);
  const [categorySearch, setCategorySearch] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(getTodayString());
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState({});
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showExtra, setShowExtra] = useState(false);
  const [showCurrencyPanel, setShowCurrencyPanel] = useState(false);
  const [newCurrency, setNewCurrency] = useState("");
  const [newRate, setNewRate] = useState("");
  const [showCurrencyNotice, setShowCurrencyNotice] = useState(false);
  const amountRef = useRef(null);
  const descriptionRef = useRef(null);
  const successTimerRef = useRef(null);

  const categories = type === "expense" ? expenseCategories : incomeCategories;

  const categoriesWithCount = categories.map((cat) => ({
    name: cat,
    count: (transactions || []).filter((t) => t.category === cat).length,
  }));

  const filteredCategories = categoriesWithCount
    .filter((cat) => cat.name.toLowerCase().startsWith(categorySearch.toLowerCase()))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name, "bg", { sensitivity: "base" });
    })
    .map((cat) => cat.name);

  // Показва известие при зареждане ако валутата не е EUR
  useEffect(() => {
    if (isLoaded && currency !== "EUR") {
      setShowCurrencyNotice(true);
      setTimeout(() => setShowCurrencyNotice(false), 1500);
    }
  }, [isLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (!isValidDate(date))
      newErrors.date = "Въведете валидна дата (ДД/ММ/ГГГГ)";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    const transaction = {
      type,
      category,
      amount: convert(amount),
      date,
      description: description.trim(),
    };
    if (editingTransaction) {
      onEdit(editingTransaction.id, transaction);
    } else {
      onAdd(transaction);
    }
    if (!editingTransaction) {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      setShowSuccess(true);
      successTimerRef.current = setTimeout(() => setShowSuccess(false), 1000);
    }
    handleReset();
  };

  const handleReset = () => {
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    setType("expense");
    setCategory("");
    setCategorySearch("");
    setAmount("");
    setDate(stickyDate ? date : getTodayString());
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

  const handleCurrencySave = () => {
    const trimmed = newCurrency.trim().toUpperCase();
    const parsedRate = parseFloat(newRate);
    if (!trimmed || isNaN(parsedRate) || parsedRate <= 0) return;
    onUpdateCurrency(trimmed, parsedRate);
    setShowCurrencyPanel(false);
    setNewCurrency("");
    setNewRate("");
  };

  const handleResetToEur = () => {
    onResetToEur();
    setShowCurrencyPanel(false);
    setNewCurrency("");
    setNewRate("");
  };

  return (
    <div className="bg-blue-50 rounded-2xl p-5 shadow-md mb-6">

      {/* Известие за валута */}
      {showCurrencyNotice && (
        <div className="mb-4 bg-orange-50 border border-orange-200 rounded-xl px-4 py-2 text-sm text-orange-600 font-medium text-center">
          Избраната валута е {currency}
        </div>
      )}
      {stickyDate && (
        <div className="mb-4 bg-orange-50 border border-orange-200 rounded-xl px-4 py-2 text-sm text-orange-600 font-medium text-center animate-pulse">
          📅 Всички транзакции се въвеждат за дата {date}
        </div>
      )}

      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
        {editingTransaction ? "Редактиране на транзакция" : "Нова транзакция"}
      </h2>

      {/* Тип */}
      <div className="flex gap-3 mb-4">
        <button
          onClick={() => setType("expense")}
          className={`flex-1 py-2 rounded-xl font-medium text-sm transition ${
            type === "expense" ? "bg-red-500 text-white shadow" : "bg-red-50 text-red-400 hover:bg-red-100"
          }`}
        >
          Разход
        </button>
        <button
          onClick={() => setType("income")}
          className={`flex-1 py-2 rounded-xl font-medium text-sm transition ${
            type === "income" ? "bg-green-500 text-white shadow" : "bg-green-50 text-green-400 hover:bg-green-100"
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
            onChange={(e) => { setCategorySearch(e.target.value); setCategory(""); setShowCategoryDropdown(true); }}
            onFocus={() => { setCategorySearch(""); setCategory(""); setShowCategoryDropdown(true); }}
            onBlur={() => setTimeout(() => setShowCategoryDropdown(false), 150)}
            className={`w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 ${
              errors.category ? "border-red-400" : "border-gray-200"
            }`}
          />
          {errors.category && <p className="text-xs text-red-500 mt-1">{errors.category}</p>}
          {showCategoryDropdown && filteredCategories.length > 0 && (
            <div className="absolute z-10 w-full bg-blue-50 border border-gray-200 rounded-xl shadow-lg mt-1 max-h-48 overflow-y-auto">
              {filteredCategories.map((cat) => (
                <div key={cat} onMouseDown={() => handleCategorySelect(cat)} className="px-3 py-2 text-sm hover:bg-emerald-50 cursor-pointer">
                  {cat}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Сума */}
        <div>
          <label className={`block text-xs font-medium mb-1 ${currency !== "EUR" ? "text-red-500" : "text-gray-500"}`}>
            {currency !== "EUR" ? `ВЪВЕДИ СУМАТА В ${currency}` : "Сума (EUR)"}
          </label>
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
          {errors.amount && <p className="text-xs text-red-500 mt-1">{errors.amount}</p>}
          {currency !== "EUR" && amount && !isNaN(Number(amount)) && Number(amount) > 0 && (
            <p className="text-xs text-gray-400 mt-1">
              = {convert(amount)} EUR (курс {rate})
            </p>
          )}
        </div>
      </div>

      
      {/* Бутон за дата и описание */}
      <div className="mt-4 bg-blue-50 rounded-2xl shadow-sm overflow-hidden border border-gray-200">
        <button
          onClick={() => setShowExtra((prev) => !prev)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-blue-100 transition"
        >
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-gray-400" />
            <span className="text-sm font-semibold text-gray-600">Дата, описание и валута</span>
          </div>
          <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showExtra ? "rotate-180" : ""}`} />
        </button>
      </div>

      {showExtra && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-4 pb-4 border border-t-0 border-gray-200 rounded-b-2xl bg-blue-50">
          <div className="mt-3 md:col-span-2 border-t border-gray-200" />
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs text-gray-500">Дата</label>
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={stickyDate}
                  onChange={(e) => setStickyDate(e.target.checked)}
                  className="accent-orange-500 w-3.5 h-3.5"
                />
                <span className="text-xs text-gray-500">Запази датата</span>
              </label>
            </div>
            <DateInput
              value={date}
              onChange={(val) => { setDate(val); if (val.length === 10) descriptionRef.current?.focus(); }}
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
          <div className="md:col-span-2">
            <button
              onClick={() => { setShowCurrencyPanel((prev) => !prev); setNewCurrency(currency !== "EUR" ? currency : ""); setNewRate(currency !== "EUR" ? String(rate) : ""); }}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-blue-100 text-blue-600 hover:bg-blue-200 transition"
            >
              <Globe className="w-4 h-4" />
              Промени валутата
              {currency !== "EUR" && <span className="ml-1 text-xs bg-blue-200 px-2 py-0.5 rounded-lg">{currency}</span>}
            </button>
            {showCurrencyPanel && (
              <div className="mt-2 border border-gray-200 rounded-xl bg-white p-4 flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Валута (напр. BGN)</label>
                    <input
                      type="text"
                      placeholder="BGN"
                      value={newCurrency}
                      onChange={(e) => setNewCurrency(e.target.value.toUpperCase())}
                      maxLength={10}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Курс EUR/{newCurrency || "?"}</label>
                    <input
                      type="number"
                      placeholder="1.95583"
                      value={newRate}
                      onChange={(e) => setNewRate(e.target.value)}
                      min="0"
                      step="0.00001"
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleCurrencySave}
                    disabled={!newCurrency.trim() || !newRate || isNaN(parseFloat(newRate)) || parseFloat(newRate) <= 0}
                    className="flex-1 px-3 py-2 rounded-xl text-sm font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition disabled:opacity-40"
                  >
                    Запази
                  </button>
                  <button
                    onClick={handleResetToEur}
                    className="flex-1 px-3 py-2 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
                  >
                    Върни към EUR
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Бутони */}
      <div className="flex gap-3 mt-4">
        <button
          onClick={handleSubmit}
          className={`flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-medium text-white transition shadow ${
            editingTransaction ? "bg-blue-500 hover:bg-blue-600"
            : showSuccess ? "bg-blue-600 hover:bg-blue-700"
            : type === "expense" ? "bg-red-500 hover:bg-red-600"
            : "bg-green-500 hover:bg-green-600"
          }`}
        >
          {editingTransaction ? <><Save className="w-4 h-4" /> Запази</>
          : showSuccess ? <><CheckCircle className="w-4 h-4" /> Добавено!</>
          : <><PlusCircle className="w-4 h-4" /> Добави</>}
        </button>
        {editingTransaction && (
          <button onClick={handleReset} className="px-5 py-2 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition">
            Отказ
          </button>
        )}
      </div>
    </div>
  );
};

export default TransactionForm;