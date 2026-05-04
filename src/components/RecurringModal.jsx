import { useState } from "react";
import { X, Plus, Trash2, Edit2, Check, RefreshCw } from "lucide-react";
import { getTodayString } from "../utils/formatters";
import DateInput from "./DateInput";

const PERIOD_LABELS = {
  daily: "Всеки ден",
  weekly: "Всяка седмица",
  monthly: "Всеки месец",
  yearly: "Всяка година",
  custom: "Персонализиран",
};

const emptyForm = () => ({
  type: "expense",
  category: "",
  amount: "",
  variableAmount: false,
  description: "",
  startDate: getTodayString(),
  endDate: "",
  period: "monthly",
  customDays: 1,
});

const RecurringModal = ({
  recurringItems,
  expenseCategories,
  incomeCategories,
  onAdd,
  onEdit,
  onDelete,
  onClose,
}) => {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [error, setError] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [categorySearch, setCategorySearch] = useState("");
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);

  const categories = form.type === "expense" ? expenseCategories : incomeCategories;
  const filteredCategories = categories.filter((c) =>
    c.toLowerCase().startsWith(categorySearch.toLowerCase())
  );

  const handleSubmit = async () => {
    if (!form.category.trim()) { setError("Изберете категория."); return; }
    if (!form.variableAmount && (!form.amount || isNaN(Number(form.amount)) || Number(form.amount) <= 0)) { setError("Въведете валидна сума."); return; }
    if (!form.startDate) { setError("Въведете начална дата."); return; }
    if (form.period === "custom" && (!form.customDays || Number(form.customDays) < 1)) { setError("Въведете брой дни."); return; }

    const item = {
      type: form.type,
      category: form.category.trim(),
      amount: form.variableAmount ? 0 : parseFloat(Number(form.amount).toFixed(2)),
      variableAmount: form.variableAmount || false,
      description: form.description.trim(),
      startDate: form.startDate,
      endDate: form.endDate || null,
      period: form.period,
      customDays: form.period === "custom" ? Number(form.customDays) : 1,
    };

    if (editingId) {
      await onEdit(editingId, item);
    } else {
      await onAdd(item);
    }
    setForm(emptyForm());
    setCategorySearch("");
    setShowForm(false);
    setEditingId(null);
    setError("");
  };

  const handleStartEdit = (item) => {
    setEditingId(item.id);
    setForm({
      type: item.type,
      category: item.category,
      amount: item.variableAmount ? "" : String(item.amount),
      variableAmount: item.variableAmount || false,
      description: item.description || "",
      startDate: item.startDate,
      endDate: item.endDate || "",
      period: item.period,
      customDays: item.customDays || 1,
    });
    setCategorySearch(item.category);
    setShowForm(true);
    setError("");
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm());
    setCategorySearch("");
    setError("");
  };

  const periodLabel = (item) => {
    if (item.period === "custom") return `Всеки ${item.customDays} ${item.customDays === 1 ? "ден" : "дни"}`;
    return PERIOD_LABELS[item.period] || item.period;
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-blue-50 rounded-2xl shadow-xl w-full max-w-md max-h-[85vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-gray-500" />
            <h2 className="text-base font-semibold text-gray-700">Повтарящи се транзакции</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {recurringItems.length === 0 && !showForm && (
            <p className="text-xs text-gray-400 text-center py-4">Няма зададени повтарящи се транзакции</p>
          )}

          {recurringItems.map((item) => (
            <div key={item.id} className={`rounded-xl border bg-white ${confirmDeleteId === item.id ? "border-red-200" : "border-gray-200"}`}>
              {confirmDeleteId === item.id ? (
                <div className="px-3 py-3 space-y-2">
                  <p className="text-xs text-red-600 font-medium">⚠️ Изтриване на „{item.category}"?</p>
                  <div className="flex gap-2">
                    <button onClick={() => { onDelete(item.id); setConfirmDeleteId(null); }} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500 text-white hover:bg-red-600 transition">
                      <Trash2 className="w-3 h-3" /> Да, изтрий
                    </button>
                    <button onClick={() => setConfirmDeleteId(null)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition">
                      <X className="w-3 h-3" /> Откажи
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${item.type === "expense" ? "bg-red-100 text-red-600" : "bg-green-100 text-green-600"}`}>
                        {item.type === "expense" ? "Разход" : "Приход"}
                      </span>
                      <span className="text-sm font-medium text-gray-700 truncate">{item.category}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {item.variableAmount ? "Променлива сума" : `${Number(item.amount).toFixed(2)} EUR`} · {periodLabel(item)}
                    </p>
                    <p className="text-xs text-gray-400">
                      От: {item.startDate}{item.endDate ? ` · До: ${item.endDate}` : ""}
                    </p>
                    {item.description && <p className="text-xs text-gray-400 italic">{item.description}</p>}
                  </div>
                  <div className="flex gap-1 ml-2">
                    <button onClick={() => handleStartEdit(item)} className="p-1.5 rounded-lg text-gray-400 hover:text-blue-500 hover:bg-blue-50 transition">
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setConfirmDeleteId(item.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Форма */}
          {showForm && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
              <p className="text-xs font-semibold text-gray-600">{editingId ? "Редактиране" : "Нова повтаряща се транзакция"}</p>

              {/* Тип */}
              <div className="flex gap-2">
                <button onClick={() => { setForm((p) => ({ ...p, type: "expense", category: "" })); setCategorySearch(""); }}
                  className={`flex-1 py-1.5 rounded-xl text-xs font-medium transition ${form.type === "expense" ? "bg-red-500 text-white" : "bg-red-50 text-red-400 hover:bg-red-100"}`}>
                  Разход
                </button>
                <button onClick={() => { setForm((p) => ({ ...p, type: "income", category: "" })); setCategorySearch(""); }}
                  className={`flex-1 py-1.5 rounded-xl text-xs font-medium transition ${form.type === "income" ? "bg-green-500 text-white" : "bg-green-50 text-green-400 hover:bg-green-100"}`}>
                  Приход
                </button>
              </div>

              {/* Категория */}
              <div className="relative">
                <label className="block text-xs text-gray-500 mb-1">Категория</label>
                <input
                  type="text"
                  placeholder="Търси категория..."
                  value={categorySearch}
                  onChange={(e) => { setCategorySearch(e.target.value); setForm((p) => ({ ...p, category: "" })); setShowCategoryDropdown(true); }}
                  onFocus={() => { setCategorySearch(""); setForm((p) => ({ ...p, category: "" })); setShowCategoryDropdown(true); }}
                  onBlur={() => setTimeout(() => setShowCategoryDropdown(false), 150)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-300"
                />
                {showCategoryDropdown && filteredCategories.length > 0 && (
                  <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-xl shadow-lg mt-1 max-h-36 overflow-y-auto">
                    {filteredCategories.map((cat) => (
                      <div key={cat} onMouseDown={() => { setForm((p) => ({ ...p, category: cat })); setCategorySearch(cat); setShowCategoryDropdown(false); }}
                        className="px-3 py-2 text-xs hover:bg-emerald-50 cursor-pointer">{cat}</div>
                    ))}
                  </div>
                )}
              </div>

              {/* Сума */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-gray-500">Сума (EUR)</label>
                  <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.variableAmount}
                      onChange={(e) => setForm((p) => ({ ...p, variableAmount: e.target.checked, amount: "" }))}
                      className="accent-blue-500"
                    />
                    Променлива сума
                  </label>
                </div>
                {form.variableAmount ? (
                  <div className="w-full border border-blue-200 rounded-xl px-3 py-2 text-xs text-blue-400 bg-blue-50">
                    Сумата ще се въвежда при всяко потвърждение
                  </div>
                ) : (
                  <input type="number" placeholder="0.00" value={form.amount}
                    onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
                    min="0" step="0.01"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-300"
                  />
                )}
              </div>

              {/* Описание */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">Описание <span className="text-gray-400">(по желание)</span></label>
                <input type="text" placeholder="Добави описание..." value={form.description}
                  onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-300"
                />
              </div>

              {/* Период */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">Повторение</label>
                <select value={form.period} onChange={(e) => setForm((p) => ({ ...p, period: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-300 bg-white">
                  <option value="daily">Всеки ден</option>
                  <option value="weekly">Всяка седмица</option>
                  <option value="monthly">Всеки месец</option>
                  <option value="yearly">Всяка година</option>
                  <option value="custom">Персонализиран (брой дни)</option>
                </select>
                {form.period === "custom" && (
                  <div className="mt-2">
                    <label className="block text-xs text-gray-500 mb-1">Брой дни</label>
                    <input type="number" min="1" value={form.customDays}
                      onChange={(e) => setForm((p) => ({ ...p, customDays: e.target.value }))}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-300"
                    />
                  </div>
                )}
              </div>

              {/* Начална дата */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">Начална дата</label>
                <DateInput value={form.startDate} onChange={(val) => setForm((p) => ({ ...p, startDate: val }))} />
              </div>

              {/* Крайна дата */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">Крайна дата <span className="text-gray-400">(оставете празно за безкрайна)</span></label>
                <DateInput value={form.endDate} onChange={(val) => setForm((p) => ({ ...p, endDate: val }))} />
              </div>

              {error && <p className="text-xs text-red-500">{error}</p>}

              <div className="flex gap-2">
                <button onClick={handleSubmit} className="flex items-center gap-1 px-4 py-2 rounded-xl text-xs font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition">
                  <Check className="w-3.5 h-3.5" /> {editingId ? "Запази" : "Добави"}
                </button>
                <button onClick={handleCancel} className="flex items-center gap-1 px-4 py-2 rounded-xl text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition">
                  <X className="w-3.5 h-3.5" /> Откажи
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {!showForm && (
          <div className="px-5 py-4 border-t border-gray-100 flex-shrink-0">
            <button onClick={() => { setShowForm(true); setEditingId(null); setForm(emptyForm()); setCategorySearch(""); setError(""); }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-green-50 text-green-600 hover:bg-green-100 transition">
              <Plus className="w-4 h-4" /> Добави повтаряща се транзакция
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default RecurringModal;