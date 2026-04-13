import { useState } from "react";
import { X, FileDown } from "lucide-react";
import { formatAmount } from "../utils/formatters";
import { exportMonthlyStatsToExcel } from "../utils/excel";

const MonthlyStats = ({ transactions, onClose }) => {
  const handleExport = () => {
    exportMonthlyStatsToExcel(transactions);
  };
  const [activeTab, setActiveTab] = useState("expense");

  // Генерираме последните 12 календарни месеца
  const getLast12Months = () => {
    const months = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        label: date.toLocaleString("bg-BG", { month: "short", year: "numeric" }),
      });
    }
    return months;
  };

  const months = getLast12Months();

  const getAmountForCategoryAndMonth = (category, year, month, type) => {
    return transactions
      .filter((t) => {
        if (t.type !== type || t.category !== category) return false;
        const [day, m, y] = t.date.split("/").map(Number);
        return y === year && m === month;
      })
      .reduce((sum, t) => sum + Number(t.amount), 0);
  };

  const getCategories = (type) => {
    const cats = new Set();
    transactions
      .filter((t) => {
        const [day, m, y] = t.date.split("/").map(Number);
        const date = new Date(y, m - 1, 1);
        const twelveMonthsAgo = new Date();
        twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
        twelveMonthsAgo.setDate(1);
        twelveMonthsAgo.setHours(0, 0, 0, 0);
        return t.type === type && date >= twelveMonthsAgo;
      })
      .forEach((t) => cats.add(t.category));
    return [...cats].sort((a, b) =>
      a.localeCompare(b, "bg", { sensitivity: "base" })
    );
  };

  const getTotalForMonth = (year, month, type) => {
    return transactions
      .filter((t) => {
        if (t.type !== type) return false;
        const [day, m, y] = t.date.split("/").map(Number);
        return y === year && m === month;
      })
      .reduce((sum, t) => sum + Number(t.amount), 0);
  };

  const categories = getCategories(activeTab);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-blue-50 rounded-2xl shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-700">
            Месечна статистика — последните 12 месеца
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExport}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium bg-green-50 text-green-600 hover:bg-green-100 transition"
            >
              <FileDown className="w-3.5 h-3.5" />
              Експорт
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-gray-100 transition"
            >
              <X className="w-4 h-4 text-gray-500" />
            </button>
          </div>
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

        {/* Table */}
        <div className="flex-1 overflow-auto px-5 py-4">
          {categories.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">
              Няма данни за последните 12 месеца
            </p>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left px-3 py-2 rounded-l-xl font-semibold text-gray-500 sticky left-0 bg-gray-50 min-w-32">
                    Категория
                  </th>
                  <th className="text-right px-3 py-2 font-semibold text-emerald-600 min-w-20 whitespace-nowrap">
                    Средно/месец
                  </th>
                  {months.map((m) => (
                    <th
                      key={`${m.year}-${m.month}`}
                      className="text-right px-3 py-2 font-semibold text-gray-500 min-w-20 whitespace-nowrap"
                    >
                      {m.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {categories.map((cat) => {
                  const monthlyAmounts = months.map((m) =>
                    getAmountForCategoryAndMonth(cat, m.year, m.month, activeTab)
                  );
                  const average = monthlyAmounts.reduce((s, a) => s + a, 0) / 12;
                  return (
                    <tr key={cat} className="border-t border-gray-50 hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-700 sticky left-0 bg-blue-50 hover:bg-gray-50">
                        {cat}
                      </td>
                      <td className={`px-3 py-2 text-right font-bold ${
                        activeTab === "expense" ? "text-red-500" : "text-green-500"
                      }`}>
                        {formatAmount(average)}
                      </td>
                      {monthlyAmounts.map((amount, i) => (
                        <td
                          key={i}
                          className={`px-3 py-2 text-right ${
                            amount > 0 ? "text-gray-700" : "text-gray-300"
                          }`}
                        >
                          {amount > 0 ? formatAmount(amount) : "—"}
                        </td>
                      ))}
                    </tr>
                  );
                })}

                {/* Общо ред */}
                <tr className="border-t-2 border-gray-200 bg-gray-50">
                  <td className="px-3 py-2 font-bold text-gray-700 sticky left-0 bg-gray-50">
                    ОБЩО
                  </td>
                  <td className={`px-3 py-2 text-right font-bold ${
                    activeTab === "expense" ? "text-red-500" : "text-green-500"
                  }`}>
                    {formatAmount(
                      months.reduce((sum, m) => sum + getTotalForMonth(m.year, m.month, activeTab), 0) / 12
                    )}
                  </td>
                  {months.map((m) => {
                    const total = getTotalForMonth(m.year, m.month, activeTab);
                    return (
                      <td
                        key={`${m.year}-${m.month}`}
                        className={`px-3 py-2 text-right font-bold ${
                          total > 0 ? "text-gray-700" : "text-gray-300"
                        }`}
                      >
                        {total > 0 ? formatAmount(total) : "—"}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default MonthlyStats;