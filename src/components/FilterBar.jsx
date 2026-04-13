import { Search, X, Calendar } from "lucide-react";
import { getFirstDayOfMonth, getLastDayOfMonth } from "../utils/formatters";
import DateInput from "./DateInput";

const FilterBar = ({
  filters,
  setFilters,
  onFilter,
  onClear,
  isFiltered,
  expenseCategories,
  incomeCategories,
}) => {
  const allCategories = [...new Set([...expenseCategories, ...incomeCategories])].sort((a, b) =>
    a.localeCompare(b, "bg", { sensitivity: "base" })
  );

  const handleDateChange = (field, value) => {
    setFilters((prev) => ({ ...prev, [field]: autoFormatDate(value) }));
  };

  const handleThisMonth = () => {
    const now = new Date();
    const from = getFirstDayOfMonth(now);
    const to = getLastDayOfMonth(now);
    setFilters((prev) => ({ ...prev, fromDate: from, toDate: to }));
    onFilter({ ...filters, fromDate: from, toDate: to });
  };

  const handleLastMonth = () => {
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const from = getFirstDayOfMonth(lastMonth);
    const to = getLastDayOfMonth(lastMonth);
    setFilters((prev) => ({ ...prev, fromDate: from, toDate: to }));
    onFilter({ ...filters, fromDate: from, toDate: to });
  };

  return (
    <div className="p-5">

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">От дата</label>
          <DateInput
            value={filters.fromDate}
            onChange={(val) => setFilters((prev) => ({ ...prev, fromDate: val }))}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">До дата</label>
          <DateInput
            value={filters.toDate}
            onChange={(val) => setFilters((prev) => ({ ...prev, toDate: val }))}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Категория</label>
          <select
            value={filters.category}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, category: e.target.value }))
            }
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
          >
            <option value="">Всички категории</option>
            {allCategories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleThisMonth}
          className="flex items-center gap-1 px-3 py-2 rounded-xl text-sm font-medium bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition"
        >
          <Calendar className="w-4 h-4" />
          Този месец
        </button>

        <button
          onClick={handleLastMonth}
          className="flex items-center gap-1 px-3 py-2 rounded-xl text-sm font-medium bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition"
        >
          <Calendar className="w-4 h-4" />
          Миналия месец
        </button>

        <button
          onClick={() => onFilter(filters)}
          className="flex items-center gap-1 px-3 py-2 rounded-xl text-sm font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition"
        >
          <Search className="w-4 h-4" />
          Филтрирай
        </button>

        {isFiltered && (
          <button
            onClick={onClear}
            className="flex items-center gap-1 px-3 py-2 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
          >
            <X className="w-4 h-4" />
            Изчисти филтър
          </button>
        )}
      </div>

      {isFiltered && (
        <div className="mt-3 text-xs text-emerald-600 bg-emerald-50 rounded-xl px-3 py-2">
          ⚡ Активен филтър
          {filters.fromDate && ` • От: ${filters.fromDate}`}
          {filters.toDate && ` • До: ${filters.toDate}`}
          {filters.category && ` • Категория: ${filters.category}`}
        </div>
      )}
    </div>
  );
};

export default FilterBar;