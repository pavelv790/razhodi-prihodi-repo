import { useState, useEffect } from "react";
import { Search, X, Calendar, ChevronDown, Bookmark, Trash2 } from "lucide-react";
import { getFirstDayOfMonth, getLastDayOfMonth } from "../utils/formatters";
import DateInput from "./DateInput";

const CategoryDropdown = ({
    label,
    color,
    categories,
    visibleList,
    search,
    setSearch,
    show,
    setShow,
    selected,
    selectedCategories,
    type,
    onToggleAll,
    toggleCategory,
    setFilters,
  }) => {
    const allSelected = categories.length > 0 && categories.every((c) => selectedCategories.includes(`${c}::${type}`));

    return (
      <div className="flex-1 min-w-0">
        <label className="block text-xs text-gray-500 mb-1">{label}</label>
        <button
          onClick={() => setShow((prev) => !prev)}
          className={`w-full flex items-center justify-between border rounded-xl px-3 py-2 text-sm bg-white transition ${
            selected.length > 0
              ? color === "red"
                ? "border-red-300 hover:bg-red-50"
                : "border-green-300 hover:bg-green-50"
              : "border-gray-200 hover:bg-gray-50"
          }`}
        >
          <span className={selected.length > 0 ? (color === "red" ? "text-red-500" : "text-green-600") : "text-gray-500"}>
            {selected.length === 0 ? "Всички" : `${selected.length} избрани`}
          </span>
          <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${show ? "rotate-180" : ""}`} />
        </button>

        {selected.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {selected.map((key) => {
              const [name] = key.split("::");
              return (
                <span
                  key={key}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs ${
                    color === "red" ? "bg-red-100 text-red-600" : "bg-green-100 text-green-700"
                  }`}
                >
                  {name}
                  <button onClick={() => toggleCategory(name, type)}><X className="w-3 h-3" /></button>
                </span>
              );
            })}
            <button
              onClick={() => setFilters((prev) => ({ ...prev, categories: selectedCategories.filter((k) => !k.endsWith(`::${type}`)) }))}
              className="text-xs text-gray-400 hover:text-gray-600 px-1"
            >
              Изчисти
            </button>
          </div>
        )}

        {show && (
          <div className="mt-1 border border-gray-200 rounded-xl bg-white shadow-lg z-10 relative">
            <div className="p-2 border-b border-gray-100">
              <div className="flex items-center gap-2 border border-gray-200 rounded-xl px-3 py-1.5">
                <Search className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                <input
                  type="text"
                  placeholder="Търси..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="text-sm w-full focus:outline-none bg-transparent"
                />
                {search && <button onClick={() => setSearch("")}><X className="w-3.5 h-3.5 text-gray-400" /></button>}
              </div>
            </div>
            <label className={`flex items-center gap-2 px-3 py-2 cursor-pointer text-sm border-b border-gray-100 font-medium ${
              color === "red" ? "hover:bg-red-50 text-red-500" : "hover:bg-green-50 text-green-600"
            }`}>
              <input
                type="checkbox"
                checked={allSelected}
                onChange={onToggleAll}
                className="accent-emerald-500"
              />
              Маркирай всички
            </label>
            <div className="max-h-48 overflow-y-auto">
              {visibleList.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-3">Няма намерени</p>
              ) : (
                visibleList.map((cat) => {
                  const key = `${cat}::${type}`;
                  return (
                    <label
                      key={key}
                      className={`flex items-center gap-2 px-3 py-2 cursor-pointer text-sm ${
                        color === "red" ? "hover:bg-red-50" : "hover:bg-green-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedCategories.includes(key)}
                        onChange={() => toggleCategory(cat, type)}
                        className="accent-emerald-500"
                      />
                      <span className="text-gray-700">{cat}</span>
                    </label>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

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
  const [expenseSearch, setExpenseSearch] = useState("");
  const [incomeSearch, setIncomeSearch] = useState("");
  const [showExpenseList, setShowExpenseList] = useState(false);
  const [showIncomeList, setShowIncomeList] = useState(false);
  const [filterName, setFilterName] = useState("");
  const [showSaved, setShowSaved] = useState(false);

  const selectedCategories = filters.categories || [];
  const selectedExpenses = selectedCategories.filter((k) => k.endsWith("::expense"));
  const selectedIncomes = selectedCategories.filter((k) => k.endsWith("::income"));

  const visibleExpenses = expenseCategories.filter((c) =>
    c.toLowerCase().startsWith(expenseSearch.toLowerCase())
  );
  const visibleIncomes = incomeCategories.filter((c) =>
    c.toLowerCase().startsWith(incomeSearch.toLowerCase())
  );

  useEffect(() => {
    onFilter(filters);
  }, [filters, onFilter]);

  const toggleCategory = (name, type) => {
    const key = `${name}::${type}`;
    setFilters((prev) => {
      const current = prev.categories || [];
      const updated = current.includes(key)
        ? current.filter((c) => c !== key)
        : [...current, key];
      return { ...prev, categories: updated };
    });
  };

  const toggleAllExpenses = () => {
    const allKeys = expenseCategories.map((c) => `${c}::expense`);
    const allSelected = allKeys.every((k) => selectedCategories.includes(k));
    const rest = selectedCategories.filter((k) => !k.endsWith("::expense"));
    setFilters((prev) => ({
      ...prev,
      categories: allSelected ? rest : [...rest, ...allKeys],
    }));
  };

  const toggleAllIncomes = () => {
    const allKeys = incomeCategories.map((c) => `${c}::income`);
    const allSelected = allKeys.every((k) => selectedCategories.includes(k));
    const rest = selectedCategories.filter((k) => !k.endsWith("::income"));
    setFilters((prev) => ({
      ...prev,
      categories: allSelected ? rest : [...rest, ...allKeys],
    }));
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

      {/* Две падащи менюта */}
      <div className="flex gap-3 mb-4">
        <CategoryDropdown
          label="Разходи"
          color="red"
          categories={expenseCategories}
          visibleList={visibleExpenses}
          search={expenseSearch}
          setSearch={setExpenseSearch}
          show={showExpenseList}
          setShow={setShowExpenseList}
          selected={selectedExpenses}
          selectedCategories={selectedCategories}
          type="expense"
          onToggleAll={toggleAllExpenses}
          toggleCategory={toggleCategory}
          setFilters={setFilters}
        />
        <CategoryDropdown
          label="Приходи"
          color="green"
          categories={incomeCategories}
          visibleList={visibleIncomes}
          search={incomeSearch}
          setSearch={setIncomeSearch}
          show={showIncomeList}
          setShow={setShowIncomeList}
          selected={selectedIncomes}
          selectedCategories={selectedCategories}
          type="income"
          onToggleAll={toggleAllIncomes}
          toggleCategory={toggleCategory}
          setFilters={setFilters}
        />
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
          {selectedExpenses.length > 0 && ` • Разходи: ${selectedExpenses.length}`}
          {selectedIncomes.length > 0 && ` • Приходи: ${selectedIncomes.length}`}
        </div>
      )}
    </div>
  );
};

export default FilterBar;