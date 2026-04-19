import { TrendingUp, TrendingDown, Pencil, Trash2, ArrowUpDown } from "lucide-react";
import { formatAmount, parseDate } from "../utils/formatters";
import { useState } from "react";

const PAGE_SIZE = 50;

const TransactionList = ({ transactions, onEdit, onDelete, isFiltered }) => {
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [sortField, setSortField] = useState("date");
  const [sortDirection, setSortDirection] = useState("desc");
  const [typeFilter, setTypeFilter] = useState("all");

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection(field === "amount" ? "desc" : field === "date" ? "desc" : "asc");
    }
    setVisibleCount(PAGE_SIZE);
  };

  const filteredByType = transactions.filter((t) => {
    if (typeFilter === "all") return true;
    if (typeFilter === "expense") return t.type === "expense";
    if (typeFilter === "income") return t.type === "income";
    return true;
  });

  const sortedTransactions = [...filteredByType].sort((a, b) => {
    let comparison = 0;
    if (sortField === "date") {
      const dateA = parseDate(a.date);
      const dateB = parseDate(b.date);
      comparison = (dateA || 0) - (dateB || 0);
    } else if (sortField === "amount") {
      comparison = Number(a.amount) - Number(b.amount);
    } else if (sortField === "category") {
      comparison = a.category.localeCompare(b.category, "bg", { sensitivity: "base" });
    }
    return sortDirection === "asc" ? comparison : -comparison;
  });

  const visibleTransactions = sortedTransactions.slice(0, visibleCount);
  const hasMore = visibleCount < sortedTransactions.length;

  const handleDeleteClick = (id) => setConfirmDeleteId(id);
  const handleConfirmDelete = () => { onDelete(confirmDeleteId); setConfirmDeleteId(null); };
  const handleCancelDelete = () => setConfirmDeleteId(null);

  const SortButton = ({ field, label }) => (
    <button
      onClick={() => handleSort(field)}
      className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition ${
        sortField === field
          ? "bg-emerald-100 text-emerald-600"
          : "bg-gray-100 text-gray-500 hover:bg-gray-200"
      }`}
    >
      {label}
      <ArrowUpDown className="w-3 h-3" />
      {sortField === field && (
        <span>{sortDirection === "asc" ? "↑" : "↓"}</span>
      )}
    </button>
  );

  return (
    <div className="bg-blue-50 rounded-2xl shadow-md overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
            История{" "}
            <span className="text-emerald-500">({sortedTransactions.length})</span>
          </h2>
          {isFiltered && (
            <div className="mt-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
              <p className="text-sm font-bold text-red-600">⚠️ Активен филтър — показват се само филтрираните транзакции!</p>
            </div>
          )}
        </div>

        {/* Филтър по тип */}
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => { setTypeFilter("all"); setVisibleCount(PAGE_SIZE); }}
            className={`flex-1 py-1.5 rounded-xl text-xs font-medium transition ${
              typeFilter === "all"
                ? "bg-gray-700 text-white"
                : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >
            Всички
          </button>
          <button
            onClick={() => { setTypeFilter("expense"); setVisibleCount(PAGE_SIZE); }}
            className={`flex-1 py-1.5 rounded-xl text-xs font-medium transition ${
              typeFilter === "expense"
                ? "bg-red-500 text-white"
                : "bg-red-50 text-red-400 hover:bg-red-100"
            }`}
          >
            Разходи
          </button>
          <button
            onClick={() => { setTypeFilter("income"); setVisibleCount(PAGE_SIZE); }}
            className={`flex-1 py-1.5 rounded-xl text-xs font-medium transition ${
              typeFilter === "income"
                ? "bg-green-500 text-white"
                : "bg-green-50 text-green-400 hover:bg-green-100"
            }`}
          >
            Приходи
          </button>
        </div>

        {/* Сортиране */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-400">Сортирай по:</span>
          <SortButton field="date" label="Дата" />
          <SortButton field="amount" label="Сума" />
          <SortButton field="category" label="Категория" />
        </div>
      </div>

      {sortedTransactions.length === 0 ? (
        <div className="p-8 text-center text-gray-400">
          <p className="text-sm">Няма транзакции</p>
        </div>
      ) : (
        <>
          <div className="divide-y divide-gray-50">
            {visibleTransactions.map((t) => (
              <div key={t.id}>
                {confirmDeleteId === t.id ? (
                  <div className="px-5 py-4 bg-red-50 flex flex-col sm:flex-row sm:items-center gap-3">
                    <p className="text-sm text-red-600 flex-1">
                      Сигурни ли сте, че искате да изтриете тази транзакция?
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={handleConfirmDelete}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500 text-white hover:bg-red-600 transition"
                      >
                        Да, изтрий
                      </button>
                      <button
                        onClick={handleCancelDelete}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-200 text-gray-600 hover:bg-gray-300 transition"
                      >
                        Не, откажи
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="px-5 py-4 flex items-center gap-4 hover:bg-gray-50 transition">
                    <div
                      className={`p-2 rounded-xl flex-shrink-0 ${
                        t.type === "expense" ? "bg-red-100" : "bg-green-100"
                      }`}
                    >
                      {t.type === "expense" ? (
                        <TrendingDown className="w-4 h-4 text-red-500" />
                      ) : (
                        <TrendingUp className="w-4 h-4 text-green-500" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-700 truncate">
                        {t.category}
                      </p>
                      {t.description && (
                        <p className="text-xs text-gray-400 truncate">
                          {t.description}
                        </p>
                      )}
                      <p className="text-xs text-gray-400">{t.date}</p>
                    </div>

                    <div className="text-right flex-shrink-0">
                      <p
                        className={`text-sm font-bold ${
                          t.type === "expense" ? "text-red-500" : "text-green-500"
                        }`}
                      >
                        {t.type === "expense" ? "-" : "+"}
                        {formatAmount(t.amount)} EUR
                      </p>
                    </div>

                    <div className="flex gap-2 flex-shrink-0">
                      <button
                        onClick={() => onEdit(t)}
                        className="p-1.5 rounded-lg bg-blue-50 text-blue-500 hover:bg-blue-100 transition"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteClick(t.id)}
                        className="p-1.5 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 transition"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {hasMore && (
            <div className="px-5 py-4 border-t border-gray-100 text-center">
              <button
                onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
                className="px-5 py-2 rounded-xl text-sm font-medium bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition"
              >
                Зареди още ({sortedTransactions.length - visibleCount} останали)
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default TransactionList;