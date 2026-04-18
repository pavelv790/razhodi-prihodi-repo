import { useState, useEffect } from "react";
import { Search, X, Calendar, ChevronDown, Bookmark, Trash2 } from "lucide-react";
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
  savedFilters,
  onSaveFilter,
  onDeleteFilter,
}) => {
  const [catSearch, setCatSearch] = useState("");
  const [showCatList, setShowCatList] = useState(false);
  const [filterName, setFilterName] = useState("");
  const [showSaved, setShowSaved] = useState(false);

  const expenseSet = new Set(expenseCategories);
  const incomeSet = new Set(incomeCategories);

  const allCategories = [...new Set([...expenseCategories, ...incomeCategories])].sort((a, b) =>
    a.localeCompare(b, "bg", { sensitivity: "base" })
  );

  const visibleCategories = allCategories.filter((c) =>
    c.toLowerCase().startsWith(catSearch.toLowerCase())
  );

  const selectedCategories = filters.categories || [];

  useEffect(() => {
    onFilter(filters);
  }, [filters, onFilter]);

  const toggleCategory = (cat) => {
    const current = filters.categories || [];
    const updated = current.includes(cat)
      ? current.filter((c) => c !== cat)
      : [...current, cat];
    setFilters((prev) => ({ ...prev, categories: updated }));
  };

  const handleThisMonth = () => {
    const now = new Date();
    setFilters((prev) => ({ ...prev, fromDate: getFirstDayOfMonth(now), toDate: getLastDayOfMonth(now) }));
  };

  const handleLastMonth = () => {
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    setFilters((prev) => ({ ...prev, fromDate: getFirstDayOfMonth(lastMonth), toDate: getLastDayOfMonth(lastMonth) }));
  };

  const handleSave = () => {
    const name = filterName.trim();
    if (!name) return;
    onSaveFilter(name, { fromDate: filters.fromDate, toDate: filters.toDate, categories: filters.categories });
    setFilterName("");
  };

  const handleLoad = (f) => {
    setFilters({ fromDate: f.fromDate, toDate: f.toDate, categories: f.categories });
  };

  return (
    <div className="p-5">

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
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
      </div>

      {/* Категории */}
      <div className="mb-4">
        <label className="block text-xs text-gray-500 mb-1">Категории</label>
        <button
          onClick={() => setShowCatList((prev) => !prev)}
          className="w-full flex items-center justify-between border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white hover:bg-gray-50 transition"
        >
          <span className="text-gray-500">
            {selectedCategories.length === 0 ? "Всички категории" : `${selectedCategories.length} избрани`}
          </span>
          <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showCatList ? "rotate-180" : ""}`} />
        </button>

        {selectedCategories.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {selectedCategories.map((cat) => (
              <span key={cat} className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs bg-emerald-100 text-emerald-700">
                {cat}
                <button onClick={() => toggleCategory(cat)}><X className="w-3 h-3" /></button>
              </span>
            ))}
            <button
              onClick={() => setFilters((prev) => ({ ...prev, categories: [] }))}
              className="text-xs text-gray-400 hover:text-gray-600 px-1"
            >
              Изчисти всички
            </button>
          </div>
        )}

        {showCatList && (
          <div className="mt-1 border border-gray-200 rounded-xl bg-white shadow-lg">
            <div className="p-2 border-b border-gray-100">
              <div className="flex items-center gap-2 border border-gray-200 rounded-xl px-3 py-1.5">
                <Search className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                <input
                  type="text"
                  placeholder="Търси категория..."
                  value={catSearch}
                  onChange={(e) => setCatSearch(e.target.value)}
                  className="text-sm w-full focus:outline-none bg-transparent"
                />
                {catSearch && <button onClick={() => setCatSearch("")}><X className="w-3.5 h-3.5 text-gray-400" /></button>}
              </div>
            </div>
            <div className="px-3 py-1.5 flex gap-3 border-b border-gray-100">
              <span className="text-xs text-red-400">● разход</span>
              <span className="text-xs text-green-500">● приход</span>
              <span className="text-xs text-blue-400">● разход и приход</span>
            </div>
            <div className="max-h-52 overflow-y-auto">
              {visibleCategories.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-3">Няма намерени категории</p>
              ) : (
                visibleCategories.map((cat) => (
                  <label key={cat} className="flex items-center gap-2 px-3 py-2 hover:bg-emerald-50 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={selectedCategories.includes(cat)}
                      onChange={() => toggleCategory(cat)}
                      className="accent-emerald-500"
                    />
                    <span className="text-gray-700">{cat}</span>
                    {expenseSet.has(cat) && incomeSet.has(cat) ? (
                      <span className="ml-auto text-xs text-blue-400">разход и приход</span>
                    ) : expenseSet.has(cat) ? (
                      <span className="ml-auto text-xs text-red-400">разход</span>
                    ) : (
                      <span className="ml-auto text-xs text-green-500">приход</span>
                    )}
                  </label>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Бутони */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button onClick={handleThisMonth} className="flex items-center gap-1 px-3 py-2 rounded-xl text-sm font-medium bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition">
          <Calendar className="w-4 h-4" />Този месец
        </button>
        <button onClick={handleLastMonth} className="flex items-center gap-1 px-3 py-2 rounded-xl text-sm font-medium bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition">
          <Calendar className="w-4 h-4" />Миналия месец
        </button>
        {isFiltered && (
          <button onClick={onClear} className="flex items-center gap-1 px-3 py-2 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition">
            <X className="w-4 h-4" />Изчисти филтър
          </button>
        )}
      </div>

      {/* Запази филтър */}
      {isFiltered && (
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            placeholder="Име на филтъра..."
            value={filterName}
            onChange={(e) => setFilterName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
          />
          <button
            onClick={handleSave}
            disabled={!filterName.trim()}
            className="flex items-center gap-1 px-3 py-2 rounded-xl text-sm font-medium bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition disabled:opacity-40"
          >
            <Bookmark className="w-4 h-4" />Запази
          </button>
        </div>
      )}

      {/* Запазени филтри */}
      {savedFilters.length > 0 && (
        <div>
          <button
            onClick={() => setShowSaved((prev) => !prev)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition mb-2"
          >
            <Bookmark className="w-4 h-4" />
            Запазени филтри ({savedFilters.length})
            <ChevronDown className={`w-4 h-4 transition-transform ${showSaved ? "rotate-180" : ""}`} />
          </button>
          {showSaved && (
            <div className="flex flex-col gap-1">
              {savedFilters.map((f) => (
                <div key={f.id} className="flex items-center justify-between bg-white border border-gray-200 rounded-xl px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-gray-700">{f.name}</p>
                    <p className="text-xs text-gray-400">
                      {f.fromDate && `От: ${f.fromDate} `}
                      {f.toDate && `До: ${f.toDate} `}
                      {f.categories?.length > 0 && `• ${f.categories.length} категории`}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleLoad(f)}
                      className="text-xs px-2 py-1 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                    >
                      Зареди
                    </button>
                    <button
                      onClick={() => onDeleteFilter(f.id)}
                      className="text-xs px-2 py-1 rounded-lg bg-red-50 text-red-400 hover:bg-red-100"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {isFiltered && (
        <div className="mt-3 text-xs text-emerald-600 bg-emerald-50 rounded-xl px-3 py-2">
          ⚡ Активен филтър
          {filters.fromDate && ` • От: ${filters.fromDate}`}
          {filters.toDate && ` • До: ${filters.toDate}`}
          {selectedCategories.length > 0 && ` • Категории: ${selectedCategories.join(", ")}`}
        </div>
      )}
    </div>
  );
};

export default FilterBar;