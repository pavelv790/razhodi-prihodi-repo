import { useState } from "react";
import { Pencil, Trash2, Plus, X, Check } from "lucide-react";

const CategoryManager = ({
  expenseCategories,
  incomeCategories,
  onAdd,
  onEdit,
  onDelete,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState("expense");
  const [editingCategory, setEditingCategory] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [addingNew, setAddingNew] = useState(false);
  const [newValue, setNewValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [error, setError] = useState("");

  const categories =
    activeTab === "expense" ? expenseCategories : incomeCategories;

  const handleEdit = (cat) => {
    setEditingCategory(cat);
    setEditValue(cat);
    setAddingNew(false);
    setError("");
  };

  const handleEditSave = () => {
    if (!editValue.trim()) {
      setError("Името не може да е празно");
      return;
    }
    const success = onEdit(activeTab, editingCategory, editValue.trim());
    if (!success) {
      setError("Категория с това име вече съществува");
      return;
    }
    setEditingCategory(null);
    setEditValue("");
    setError("");
  };

  const handleAddSave = () => {
    if (!newValue.trim()) {
      setError("Името не може да е празно");
      return;
    }
    const success = onAdd(activeTab, newValue.trim());
    if (!success) {
      setError("Категория с това име вече съществува");
      return;
    }
    setAddingNew(false);
    setNewValue("");
    setError("");
  };

  const handleDeleteConfirm = (choice) => {
    if (choice === "delete") {
      onDelete(activeTab, confirmDelete, "delete");
    } else {
      onDelete(activeTab, confirmDelete, "reassign");
    }
    setConfirmDelete(null);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-blue-50 rounded-2xl shadow-xl w-full max-w-md max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-700">
            Управление на категории
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 px-5 pt-4">
          <button
            onClick={() => {
              setActiveTab("expense");
              setEditingCategory(null);
              setAddingNew(false);
              setError("");
            }}
            className={`flex-1 py-2 rounded-xl text-sm font-medium transition ${
              activeTab === "expense"
                ? "bg-red-500 text-white"
                : "bg-red-50 text-red-400 hover:bg-red-100"
            }`}
          >
            Разходи
          </button>
          <button
            onClick={() => {
              setActiveTab("income");
              setEditingCategory(null);
              setAddingNew(false);
              setError("");
            }}
            className={`flex-1 py-2 rounded-xl text-sm font-medium transition ${
              activeTab === "income"
                ? "bg-green-500 text-white"
                : "bg-green-50 text-green-400 hover:bg-green-100"
            }`}
          >
            Приходи
          </button>
        </div>

        <p className="text-xs text-gray-400 px-5 pt-2">
          Категориите са сортирани по азбучен ред
        </p>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-1">
          {categories.map((cat) => (
            <div key={cat}>
              {editingCategory === cat ? (
                <div className="flex items-center gap-2 py-1">
                  <input
                    type="text"
                    value={editValue}
                    onChange={(e) => {
                      setEditValue(e.target.value);
                      setError("");
                    }}
                    className="flex-1 border border-gray-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                    autoFocus
                  />
                  <button
                    onClick={handleEditSave}
                    className="p-1.5 rounded-lg bg-blue-50 text-blue-500 hover:bg-blue-100 transition"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => {
                      setEditingCategory(null);
                      setError("");
                    }}
                    className="p-1.5 rounded-lg bg-gray-100 text-gray-500 hover:bg-gray-200 transition"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : confirmDelete === cat ? (
                <div className="bg-red-50 rounded-xl p-3 space-y-2">
                  <p className="text-xs text-red-600">
                    Какво да стане с транзакциите в категория &quot;{cat}&quot;?
                  </p>
                  <div className="flex flex-col gap-1.5">
                    <button
                      onClick={() => handleDeleteConfirm("reassign")}
                      className="w-full px-3 py-1.5 rounded-lg text-xs font-medium bg-orange-100 text-orange-600 hover:bg-orange-200 transition"
                    >
                      Запази транзакциите като &quot;Без категория&quot;
                    </button>
                    <button
                      onClick={() => handleDeleteConfirm("delete")}
                      className="w-full px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500 text-white hover:bg-red-600 transition"
                    >
                      Изтрий всички транзакции
                    </button>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="w-full px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
                    >
                      Откажи
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between py-1.5 px-2 rounded-xl hover:bg-gray-50 transition">
                  <span className="text-sm text-gray-700">{cat}</span>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => handleEdit(cat)}
                      className="p-1.5 rounded-lg bg-blue-50 text-blue-500 hover:bg-blue-100 transition"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        setConfirmDelete(cat);
                        setEditingCategory(null);
                        setError("");
                      }}
                      className="p-1.5 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {addingNew && (
            <div className="flex items-center gap-2 py-1">
              <input
                type="text"
                value={newValue}
                onChange={(e) => {
                  setNewValue(e.target.value);
                  setError("");
                }}
                placeholder="Нова категория..."
                className="flex-1 border border-gray-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                autoFocus
              />
              <button
                onClick={handleAddSave}
                className="p-1.5 rounded-lg bg-green-50 text-green-500 hover:bg-green-100 transition"
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  setAddingNew(false);
                  setNewValue("");
                  setError("");
                }}
                className="p-1.5 rounded-lg bg-gray-100 text-gray-500 hover:bg-gray-200 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {error && <p className="text-xs text-red-500 px-2">{error}</p>}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100">
          <button
            onClick={() => {
              setAddingNew(true);
              setEditingCategory(null);
              setError("");
            }}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-green-50 text-green-600 hover:bg-green-100 transition"
          >
            <Plus className="w-4 h-4" />
            Добави нова категория
          </button>
        </div>
      </div>
    </div>
  );
};

export default CategoryManager;