import { useState, useMemo } from "react";
import { X, BarChart2 } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer
} from "recharts";
import { formatAmount } from "../utils/formatters";

const COLORS = [
  "#ef4444","#3b82f6","#f59e0b","#10b981","#8b5cf6",
  "#ec4899","#14b8a6","#f97316","#6366f1","#84cc16",
  "#06b6d4","#e11d48","#7c3aed","#059669","#d97706",
];

const getMonthKey = (dateStr) => {
  const [, m, y] = dateStr.split("/");
  return `${m}/${y}`;
};

const sortMonthKeys = (keys) =>
  [...keys].sort((a, b) => {
    const [ma, ya] = a.split("/").map(Number);
    const [mb, yb] = b.split("/").map(Number);
    return new Date(ya, ma - 1) - new Date(yb, mb - 1);
  });

const buildChartData = (transactions, mode, rollingMonths) => {
  if (transactions.length === 0) return [];
  const months = sortMonthKeys([...new Set(transactions.map((t) => getMonthKey(t.date)))]);

  if (mode === "overall") {
    return months.map((mk) => {
      const income = transactions
        .filter((t) => t.type === "income" && getMonthKey(t.date) === mk)
        .reduce((s, t) => s + Number(t.amount), 0);
      const expense = transactions
        .filter((t) => t.type === "expense" && getMonthKey(t.date) === mk)
        .reduce((s, t) => s + Number(t.amount), 0);
      return {
        month: mk,
        "Приходи": Math.round(income * 100) / 100,
        "Разходи": Math.round(expense * 100) / 100,
        "Баланс": Math.round((income - expense) * 100) / 100,
      };
    });
  }

  if (mode === "rolling") {
    return months.map((mk) => {
      const [m, y] = mk.split("/").map(Number);
      const getAvg = (type) => {
        let total = 0;
        for (let i = 0; i < rollingMonths; i++) {
          let mo = m - i, yr = y;
          while (mo <= 0) { mo += 12; yr--; }
          total += transactions
            .filter((t) => {
              if (t.type !== type) return false;
              const [, tm, ty] = t.date.split("/").map(Number);
              return ty === yr && tm === mo;
            })
            .reduce((s, t) => s + Number(t.amount), 0);
        }
        return Math.round((total / rollingMonths) * 100) / 100;
      };
      const inc = getAvg("income");
      const exp = getAvg("expense");
      return {
        month: mk,
        "Приходи (avg)": inc,
        "Разходи (avg)": exp,
        "Баланс (avg)": Math.round((inc - exp) * 100) / 100,
      };
    });
  }

  // categories mode
  const cats = [...new Set(transactions.map((t) => `${t.category}::${t.type}`))];
  return months.map((mk) => {
    const point = { month: mk };
    cats.forEach((ck) => {
      const [cat, type] = ck.split("::");
      point[ck] = Math.round(
        transactions
          .filter((t) => t.category === cat && t.type === type && getMonthKey(t.date) === mk)
          .reduce((s, t) => s + Number(t.amount), 0) * 100
      ) / 100;
    });
    return point;
  });
};

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-gray-600 mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}: {formatAmount(p.value)}
        </p>
      ))}
    </div>
  );
};

const ChartsModal = ({
  transactions,
  filteredTransactions,
  isFiltered,
  activeFilters,
  onClose,
  rollingMonths = 12,
}) => {
  const [viewMode, setViewMode] = useState("overall");

  const data = isFiltered ? filteredTransactions : transactions;
  const hasCategories = isFiltered && activeFilters.categories && activeFilters.categories.length > 0;

  const chartData = useMemo(
    () => buildChartData(data, viewMode, rollingMonths),
    [data, viewMode, rollingMonths]
  );

  const lineKeys = useMemo(() => {
    if (chartData.length === 0) return [];
    return Object.keys(chartData[0]).filter((k) => k !== "month");
  }, [chartData]);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-700">Графики</h2>
            {isFiltered && (
              <p className="text-xs font-bold text-red-600 mt-0.5">⚠️ Показват се само филтрираните данни</p>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {/* Режим */}
        <div className="px-5 pt-4 flex gap-2 flex-wrap flex-shrink-0 items-center">
          <button
            onClick={() => setViewMode("overall")}
            className={`px-3 py-1.5 rounded-xl text-sm font-medium transition ${
              viewMode === "overall" ? "bg-blue-500 text-white" : "bg-blue-50 text-blue-500 hover:bg-blue-100"
            }`}
          >
            Общо
          </button>
          <button
            onClick={() => setViewMode("rolling")}
            className={`px-3 py-1.5 rounded-xl text-sm font-medium transition ${
              viewMode === "rolling" ? "bg-emerald-500 text-white" : "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
            }`}
          >
            Rolling avg ({rollingMonths} мес.)
          </button>
          {viewMode === "rolling" && (
            <p className="text-xs text-red-500 self-center">
              Периодът се задава в Месечна статистика
            </p>
          )}
          <button
            onClick={() => setViewMode("categories")}
            className={`px-3 py-1.5 rounded-xl text-sm font-medium transition ${
              viewMode === "categories" ? "bg-purple-500 text-white" : "bg-purple-50 text-purple-500 hover:bg-purple-100"
            }`}
          >
            По категории
          </button>
        </div>

        {viewMode === "categories" && !hasCategories && (
          <div className="px-5 pt-3 flex-shrink-0">
            <p className="text-xs text-amber-600 bg-amber-50 rounded-xl px-3 py-2">
              💡 Изберете категории от филтъра за да видите отделните линии
            </p>
          </div>
        )}

        {/* Графика */}
        <div className="flex-1 overflow-auto px-5 py-4">
          {chartData.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">Няма данни за показване</p>
          ) : (
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11 }}
                  angle={-45}
                  textAnchor="end"
                  interval={0}
                />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatAmount(v)} width={80} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "20px" }} />
                {lineKeys.map((key, i) => {
                  let color = COLORS[i % COLORS.length];
                  if (key === "Приходи" || key === "Приходи (avg)") color = "#10b981";
                  if (key === "Разходи" || key === "Разходи (avg)") color = "#ef4444";
                  if (key === "Баланс" || key === "Баланс (avg)") color = "#3b82f6";
                  const isExpense = key.endsWith("::expense");
                  const displayName = key.includes("::") ? key.split("::")[0] + (isExpense ? " (разход)" : " (приход)") : key;
                  return (
                    <Line
                      key={key}
                      type="monotone"
                      dataKey={key}
                      name={displayName}
                      stroke={color}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChartsModal;