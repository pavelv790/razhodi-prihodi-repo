import { useState } from "react";
import { X, RefreshCw } from "lucide-react";

const PendingRecurringModal = ({ pendingItems, onConfirm, onClose }) => {
  const [selected, setSelected] = useState(
    pendingItems.map((_, i) => i)
  );

  const toggle = (i) => {
    setSelected((prev) =>
      prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]
    );
  };

  const selectAll = () => setSelected(pendingItems.map((_, i) => i));
  const deselectAll = () => setSelected([]);

  const handleConfirm = () => {
    const toAdd = pendingItems.filter((_, i) => selected.includes(i));
    onConfirm(toAdd);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-blue-50 rounded-2xl shadow-xl w-full max-w-sm max-h-[85vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-gray-500" />
            <h2 className="text-base font-semibold text-gray-700">Чакащи транзакции</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <div className="px-5 py-3 flex-shrink-0">
          <p className="text-xs text-gray-500 mb-3">
            Имате <strong>{pendingItems.length}</strong> чакащи повтарящи се транзакции. Изберете кои да добавите.
          </p>
          <div className="flex gap-2">
            <button onClick={selectAll} className="text-xs px-2 py-1 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition">
              Избери всички
            </button>
            <button onClick={deselectAll} className="text-xs px-2 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition">
              Откажи всички
            </button>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-5 space-y-1.5 pb-3">
          {pendingItems.map((item, i) => (
            <label key={i}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition ${
                selected.includes(i) ? "border-blue-300 bg-blue-50" : "border-gray-200 bg-white"
              }`}
            >
              <input type="checkbox" checked={selected.includes(i)} onChange={() => toggle(i)}
                className="accent-blue-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-700 truncate">{item.category}</p>
                <p className="text-xs text-gray-400">{item.date} · {Number(item.amount).toFixed(2)} EUR</p>
                {item.description && <p className="text-xs text-gray-400 italic truncate">{item.description}</p>}
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
                item.type === "expense" ? "bg-red-100 text-red-600" : "bg-green-100 text-green-600"
              }`}>
                {item.type === "expense" ? "Разход" : "Приход"}
              </span>
            </label>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 flex-shrink-0 flex gap-2">
          <button onClick={handleConfirm} disabled={selected.length === 0}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition disabled:opacity-40">
            Добави избраните ({selected.length})
          </button>
          <button onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition">
            Затвори
          </button>
        </div>
      </div>
    </div>
  );
};

export default PendingRecurringModal;