import { useState, useEffect } from "react";
import { X, FileDown } from "lucide-react";
import { formatAmount } from "../utils/formatters";
import { exportMonthlyStatsToExcel } from "../utils/excel";

// Връща последните rollingMonths ЗАВЪРШЕНИ месеца (текущият не се включва)
const getWindowMonths = (rollingMonths, targetYear, targetMonth) => {
  const months = [];
  for (let i = 1; i <= rollingMonths; i++) {
    let m = targetMonth - i;
    let y = targetYear;
    while (m <= 0) { m += 12; y--; }
    months.push({ year: y, month: m });
  }
  return months;
};

const getRollingAverage = (transactions, category, type, rollingMonths) => {
  const now = new Date();
  const lastMonth = now.getMonth() === 0 ? 12 : now.getMonth();
  const lastYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const window = getWindowMonths(rollingMonths, lastYear, lastMonth);
  const total = window.reduce((sum, { year, month }) => {
    return (
      sum +
      transactions
        .filter((t) => {
          if (t.type !== type || t.category !== category) return false;
          const [, tm, ty] = t.date.split("/").map(Number);
          return ty === year && tm === month;
        })
        .reduce((s, t) => s + Number(t.amount), 0)
    );
  }, 0);
  return total / rollingMonths;
};

const getTotalRollingAverage = (transactions, type, rollingMonths) => {
  const now = new Date();
  const lastMonth = now.getMonth() === 0 ? 12 : now.getMonth();
  const lastYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const window = getWindowMonths(rollingMonths, lastYear, lastMonth);
  const total = window.reduce((sum, { year, month }) => {
    return (
      sum +
      transactions
        .filter((t) => {
          if (t.type !== type) return false;
          const [, tm, ty] = t.date.split("/").map(Number);
          return ty === year && tm === month;
        })
        .reduce((s, t) => s + Number(t.amount), 0)
    );
  }, 0);
  return total / rollingMonths;
};

// Взима всички категории, които имат поне една транзакция в прозореца
const getCategoriesInWindow = (transactions, type, rollingMonths) => {
  const now = new Date();
  const lastMonth = now.getMonth() === 0 ? 12 : now.getMonth();
  const lastYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const window = getWindowMonths(rollingMonths, lastYear, lastMonth);
  const windowSet = new Set(window.map(({ year, month }) => `${year}-${month}`));
  const cats = new Set();
  transactions
    .filter((t) => {
      if (t.type !== type) return false;
      const [, tm, ty] = t.date.split("/").map(Number);
      return windowSet.has(`${ty}-${tm}`);
    })
    .forEach((t) => cats.add(t.category));
  return [...cats].sort((a, b) => a.localeCompare(b, "bg", { sensitivity: "base" }));
};

const MonthlyStats = ({ transactions, filteredTransactions, isFiltered, activeFilters, onClose, rollingMonths: initialRollingMonths = 12, onRollingMonthsChange, profileName }) => {
  const [activeTab, setActiveTab] = useState("expense");
  const [rollingMonths, setRollingMonths] = useState(initialRollingMonths);
  const [inputMonths, setInputMonths] = useState(String(initialRollingMonths));
  const [isCalculating, setIsCalculating] = useState(false);

  const handleRollingMonthsChange = (e) => {
    const val = e.target.value.replace(/\D/g, "");
    setInputMonths(val);
    const num = Number(val);
    if (num >= 1) {
      setRollingMonths(num);
      if (onRollingMonthsChange) onRollingMonthsChange(num);
    }
  };

  const data = isFiltered ? filteredTransactions : transactions;
  const [noDataMessage, setNoDataMessage] = useState(false);
  const [showExportWarning, setShowExportWarning] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);

  const handleExport = async () => {
    if (!data || data.length === 0) {
      setNoDataMessage(true);
      setTimeout(() => setNoDataMessage(false), 3000);
      return;
    }
    if (isFiltered) {
      setShowExportWarning(true);
    } else {
      setExportLoading(true);
      await exportMonthlyStatsToExcel(data, rollingMonths, profileName);
      setExportLoading(false);
    }
  };

  const [categories, setCategories] = useState([]);
  const [categoryAverages, setCategoryAverages] = useState({});
  const [totalAvg, setTotalAvg] = useState(0);

  useEffect(() => {
    setIsCalculating(true);
    const timer = setTimeout(() => {
      const cats = getCategoriesInWindow(data, activeTab, rollingMonths);
      const avgs = {};
      cats.forEach((cat) => {
        avgs[cat] = getRollingAverage(data, cat, activeTab, rollingMonths);
      });
      const total = getTotalRollingAverage(data, activeTab, rollingMonths);
      setCategories(cats);
      setCategoryAverages(avgs);
      setTotalAvg(total);
      setIsCalculating(false);
    }, 50);
    return () => clearTimeout(timer);
  }, [data, activeTab, rollingMonths]);
  const isExpense = activeTab === "expense";

  const modal = (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-700">
              Месечна статистика
            </h2>
            {isFiltered && (
              <p className="text-xs font-bold text-red-600 mt-0.5">⚠️ Показват се само филтрираните данни • Периодът за осредняване се брои от днес</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            
            {exportLoading ? (
              <p className="text-xs text-gray-400 animate-pulse">⏳ Генериране...</p>
            ) : (
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-green-500 text-white hover:bg-green-600 transition"
            >
              <FileDown className="w-3.5 h-3.5" />
              Експорт към Excel
            </button>
            )}
            {noDataMessage && (
              <span className="text-xs text-red-500 font-medium">Няма данни за експорт</span>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-gray-100 transition"
            >
              <X className="w-4 h-4 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Период */}
        <div className="px-5 pt-4 flex items-center gap-3 flex-shrink-0">
          <label className="text-xs text-gray-500 font-medium">
            Период за осредняване:
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={inputMonths}
            onChange={handleRollingMonthsChange}
            maxLength={3}
            className="w-14 border border-gray-200 rounded-xl px-3 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-emerald-300 bg-blue-50"
          />
          <span className="text-xs text-gray-500">месеца</span>
          {Number(inputMonths) < 1 && inputMonths !== "" && (
            <span className="text-xs text-red-500">Въведете число по-голямо от 0</span>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-2 px-5 pt-4 flex-shrink-0">
          <button
            onClick={() => setActiveTab("expense")}
            className={`flex-1 py-2 rounded-xl text-sm font-medium transition ${
              activeTab === "expense"
                ? "bg-red-500 text-white"
                : "bg-red-50 text-red-400 hover:bg-red-100"
            }`}
          >
            Разходи
          </button>
          <button
            onClick={() => setActiveTab("income")}
            className={`flex-1 py-2 rounded-xl text-sm font-medium transition ${
              activeTab === "income"
                ? "bg-green-500 text-white"
                : "bg-green-50 text-green-400 hover:bg-green-100"
            }`}
          >
            Приходи
          </button>
        </div>

        {/* Таблица */}
        <div className="flex-1 overflow-auto px-5 py-4">
          {isCalculating ? (
            <p className="text-sm text-gray-400 text-center py-8 animate-pulse">⏳ Изчисляване...</p>
          ) : categories.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">
              Няма данни за последните {rollingMonths} месеца
            </p>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left px-3 py-2 rounded-l-xl font-semibold text-gray-500">
                    Категория
                  </th>
                  <th className="text-right px-3 py-2 rounded-r-xl font-semibold text-emerald-600 whitespace-nowrap">
                    Средно / {rollingMonths} мес.
                  </th>
                </tr>
              </thead>
              <tbody>
                {categories.map((cat) => {
                  const avg = categoryAverages[cat];
                  return (
                    <tr key={cat} className="border-t border-gray-50 hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-700">{cat}</td>
                      <td className={`px-3 py-2 text-right font-bold ${
                        isExpense ? "text-red-500" : "text-green-500"
                      }`}>
                        {formatAmount(avg)}
                      </td>
                    </tr>
                  );
                })}

                {/* Общо */}
                <tr className="border-t-2 border-gray-200 bg-gray-50">
                  <td className="px-3 py-2 font-bold text-gray-700">ОБЩО</td>
                  <td className={`px-3 py-2 text-right font-bold ${
                    isExpense ? "text-red-500" : "text-green-500"
                  }`}>
                    {formatAmount(totalAvg)}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
        {showExportWarning && (
          <div className="px-5 py-4 border-t border-gray-100 flex-shrink-0">
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-3">
              <p className="text-sm font-bold text-red-600 mb-1">⚠️ Активен филтър!</p>
              <p className="text-sm text-red-600">Excel файлът ще съдържа само филтрираните данни, не всички.</p>
            </div>
            <div className="flex gap-2">
              {exportLoading ? (
                <p className="text-sm text-gray-400 animate-pulse flex-1 text-center py-2">⏳ Генериране...</p>
              ) : (
              <button
                onClick={async () => { setExportLoading(true); await exportMonthlyStatsToExcel(data, rollingMonths, profileName); setExportLoading(false); setShowExportWarning(false); }}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-green-500 text-white hover:bg-green-600 transition"
              >
                Разбирам, експортирай
              </button>
              )}
              <button
                onClick={() => setShowExportWarning(false)}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
              >
                Откажи
              </button>
            </div>
          </div>
        )}
      </div>      
    </div>
  );

  return modal;
};

export default MonthlyStats;
