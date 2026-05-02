import { useState, useEffect, useMemo } from "react";
import { X } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
  PieChart, Pie, Cell, Tooltip as ReTooltip
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

const buildChartData = (transactions, mode, rollingMonths, categories = []) => {
  if (transactions.length === 0) return [];

  // Предварително групиране — един обход на всички транзакции
  const grouped = {};
  transactions.forEach((t) => {
    const [, tm, ty] = t.date.split("/").map(Number);
    const key = `${t.type}::${t.category}::${tm}::${ty}`;
    grouped[key] = (grouped[key] || 0) + Number(t.amount);
  });

  const getSum = (type, category, month, year) =>
    grouped[`${type}::${category}::${month}::${year}`] || 0;

  const getSumAllCats = (type, month, year) => {
    let total = 0;
    const prefix = `${type}::`;
    for (const key in grouped) {
      if (!key.startsWith(prefix)) continue;
      const parts = key.split("::");
      if (Number(parts[2]) === month && Number(parts[3]) === year) {
        total += grouped[key];
      }
    }
    return total;
  };

  const now = new Date();
  const currentMonthKey = `${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
  const allMonthKeys = [...new Set(transactions.map((t) => getMonthKey(t.date)))];
  const months = sortMonthKeys(
    (mode === "rolling" || mode === "rolling-categories")
      ? allMonthKeys.filter((mk) => mk !== currentMonthKey)
        : allMonthKeys
  );

  if (mode === "overall") {
    return months.map((mk) => {
      const [m, y] = mk.split("/").map(Number);
      const income = getSumAllCats("income", m, y);
      const expense = getSumAllCats("expense", m, y);
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
          total += getSumAllCats(type, mo, yr);
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

  if (mode === "rolling-categories") {
    return months.map((mk) => {
      const [m, y] = mk.split("/").map(Number);
      const point = { month: mk };
      categories.forEach((ck) => {
        const [cat, type] = ck.split("::");
        let total = 0;
        for (let i = 0; i < rollingMonths; i++) {
          let mo = m - i, yr = y;
          while (mo <= 0) { mo += 12; yr--; }
          total += getSum(type, cat, mo, yr);
        }
        point[ck] = Math.round((total / rollingMonths) * 100) / 100;
      });
      return point;
    });
  }

  // categories mode
  const cats = [...new Set(transactions.map((t) => `${t.category}::${t.type}`))];
  return months.map((mk) => {
    const [m, y] = mk.split("/").map(Number);
    const point = { month: mk };
    cats.forEach((ck) => {
      const [cat, type] = ck.split("::");
      point[ck] = Math.round((getSum(type, cat, m, y)) * 100) / 100;
    });
    return point;
  });
};

const buildPieData = (transactions, type, threshold) => {
  const filtered = transactions.filter((t) => t.type === type);
  const total = filtered.reduce((s, t) => s + Number(t.amount), 0);
  if (total === 0) return [];

  const byCategory = {};
  filtered.forEach((t) => {
    byCategory[t.category] = (byCategory[t.category] || 0) + Number(t.amount);
  });

  const entries = Object.entries(byCategory).map(([name, value]) => ({
    name,
    value: Math.round(value * 100) / 100,
    percent: total > 0 ? (value / total) * 100 : 0,
  }));

  const thresholdPct = threshold || 0;
  const main = entries.filter((e) => e.percent >= thresholdPct);
  const others = entries.filter((e) => e.percent < thresholdPct);

  if (others.length > 0) {
    const othersSum = others.reduce((s, e) => s + e.value, 0);
    main.push({
      name: "Други",
      value: Math.round(othersSum * 100) / 100,
      percent: (othersSum / total) * 100,
    });
  }

  return main.sort((a, b) => b.value - a.value);
};

const PIE_COLORS = [
  "#ef4444","#3b82f6","#f59e0b","#10b981","#8b5cf6",
  "#ec4899","#14b8a6","#f97316","#6366f1","#84cc16",
  "#06b6d4","#e11d48","#7c3aed","#059669","#d97706",
  "#64748b","#a855f7","#0ea5e9","#f43f5e","#22c55e",
];

const CustomPieTooltip = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg px-3 py-2 text-xs">
      <p className="font-semibold text-gray-700 mb-1">{d.name}</p>
      <p className="text-gray-600">{formatAmount(d.value)} EUR</p>
      <p className="text-gray-500">{d.percent.toFixed(1)}%</p>
    </div>
  );
};

const renderCustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent, value, payload }) => {
  if (percent < 0.04) return null;
  const RADIAN = Math.PI / 180;
  const r = innerRadius + (outerRadius - innerRadius) * 0.6;
  const x = cx + r * Math.cos(-midAngle * RADIAN);
  const y = cy + r * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight="600">
      {payload.percent.toFixed(1)}%
    </text>
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
  const [rollingSubMode, setRollingSubMode] = useState("overall");
  const [isCalculating, setIsCalculating] = useState(false);
  const [activePieIndex, setActivePieIndex] = useState(null);
  const [pieType, setPieType] = useState("expense");
  const [pieThreshold, setPieThreshold] = useState(() => {
    const saved = localStorage.getItem("pie_threshold");
    return saved !== null ? parseFloat(saved) : 3;
  });
  const [tooltipData, setTooltipData] = useState(null);
  const [pieThresholdInput, setPieThresholdInput] = useState(() => {
    const saved = localStorage.getItem("pie_threshold");
    return saved !== null ? saved : "3";
  });

  const data = isFiltered ? filteredTransactions : transactions;
  
  const [chartData, setChartData] = useState(null);

useEffect(() => {
  setIsCalculating(true);
  const timer = setTimeout(() => {
    const effectiveMode = viewMode === "rolling" && rollingSubMode === "categories"
      ? "rolling-categories"
      : viewMode;
    const cats = (activeFilters?.categories && activeFilters.categories.length > 0)
      ? activeFilters.categories
      : [...new Set(data.map((t) => `${t.category}::${t.type}`))];
    const result = buildChartData(data, effectiveMode, rollingMonths, cats);
    setChartData(result);
    setIsCalculating(false);
  }, 50);
  return () => clearTimeout(timer);
}, [data, viewMode, rollingMonths, rollingSubMode, activeFilters]);

  const pieData = useMemo(
    () => buildPieData(data, pieType, pieThreshold),
    [data, pieType, pieThreshold]
  );
  const pieTotal = useMemo(
    () => data.filter((t) => t.type === pieType).reduce((s, t) => s + Number(t.amount), 0),
    [data, pieType]
  );

  
  const lineKeys = useMemo(() => {
    if (!chartData || chartData.length === 0) return [];
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
            onClick={() => { setIsCalculating(true); setViewMode("overall"); }}
            className={`px-3 py-1.5 rounded-xl text-sm font-medium transition ${
              viewMode === "overall" ? "bg-blue-500 text-white" : "bg-blue-50 text-blue-500 hover:bg-blue-100"
            }`}
          >
            Общо
          </button>
          <button
            onClick={() => { setIsCalculating(true); setViewMode("rolling"); }}
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
            onClick={() => { setIsCalculating(true); setViewMode("pie"); }}
            className={`px-3 py-1.5 rounded-xl text-sm font-medium transition ${
              viewMode === "pie" ? "bg-orange-500 text-white" : "bg-orange-50 text-orange-500 hover:bg-orange-100"
            }`}
          >
            Pie chart
          </button>
          <button
            onClick={() => { setIsCalculating(true); setViewMode("categories"); }}
            className={`px-3 py-1.5 rounded-xl text-sm font-medium transition ${
              viewMode === "categories" ? "bg-purple-500 text-white" : "bg-purple-50 text-purple-500 hover:bg-purple-100"
            }`}
          >
            По категории
          </button>
        </div>

        {viewMode === "rolling" && (
          <div className="px-5 pt-2 flex items-center gap-2 flex-shrink-0">
            <span className="text-xs text-gray-400 mr-1">↳ Покажи:</span>
            <button
              onClick={() => { setIsCalculating(true); setRollingSubMode("overall"); }}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                rollingSubMode === "overall"
                  ? "bg-emerald-600 text-white"
                  : "bg-white text-emerald-600 border border-emerald-200 hover:bg-emerald-50"
              }`}
            >
              Rolling avg Общо
            </button>
            <button
              onClick={() => { setIsCalculating(true); setRollingSubMode("categories"); }}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                rollingSubMode === "categories"
                  ? "bg-emerald-600 text-white"
                  : "bg-white text-emerald-600 border border-emerald-200 hover:bg-emerald-50"
              }`}
            >
              Rolling avg По категории
            </button>
          </div>
        )}

        
        {/* Графика */}
        <div className="flex-1 overflow-auto px-5 py-4">
          {isCalculating ? (
            <p className="text-sm text-gray-400 text-center py-8 animate-pulse">⏳ Изчисляване...</p>
          ) : viewMode === "pie" ? (
            <div>
              {/* Контроли за pie */}
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <div className="flex gap-2">
                  <button
                    onClick={() => { setPieType("expense"); setActivePieIndex(null); }}
                    className={`px-3 py-1.5 rounded-xl text-sm font-medium transition border ${
                      pieType === "expense"
                        ? "bg-red-500 text-white border-red-500"
                        : "bg-white text-red-400 border-red-200 hover:bg-red-50"
                    }`}
                  >
                    Разходи
                  </button>
                  <button
                    onClick={() => { setPieType("income"); setActivePieIndex(null); }}
                    className={`px-3 py-1.5 rounded-xl text-sm font-medium transition border ${
                      pieType === "income"
                        ? "bg-emerald-500 text-white border-emerald-500"
                        : "bg-white text-emerald-600 border-emerald-200 hover:bg-emerald-50"
                    }`}
                  >
                    Приходи
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">Групирай под</span>
                  <input
                    type="number"
                    min="0"
                    max="50"
                    value={pieThresholdInput}
                    onChange={(e) => {
                      setPieThresholdInput(e.target.value);
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v) && v >= 0) {
                        setPieThreshold(v);
                        localStorage.setItem("pie_threshold", String(v));
                      }
                    }}
                    className="w-14 text-center text-sm border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-orange-300"
                  />
                  <span className="text-xs text-gray-500">% → "Други"</span>
                </div>
              </div>
              <p className="text-xs text-gray-400 mb-3">💡 Докосни категория от списъка за да я откроиш или плъзни върху сегмент от графиката за детайли</p>
              {pieData.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">Няма данни за показване</p>
              ) : (
                <div className="flex flex-col md:flex-row items-start gap-4">
                  <div className="w-full md:w-auto flex-shrink-0">
                    <PieChart width={280} height={280}>
                      <Pie
                        data={pieData}
                        cx={140}
                        cy={140}
                        dataKey="value"
                        labelLine={false}
                        label={renderCustomLabel}
                        isAnimationActive={false}
                        onMouseEnter={(_, index) => setActivePieIndex(index)}
                        onMouseLeave={() => setActivePieIndex(null)}
                        onClick={(_, index) => setActivePieIndex(index === activePieIndex ? null : index)}
                        onTouchEnd={(data, index) => {
                          if (index !== undefined) setActivePieIndex(index === activePieIndex ? null : index);
                        }}
                      >
                        {pieData.map((_, i) => {
                          const isActive = activePieIndex === i;
                          const hasActive = activePieIndex !== null;
                          return (
                            <Cell
                              key={i}
                              fill={PIE_COLORS[i % PIE_COLORS.length]}
                              opacity={hasActive && !isActive ? 0.4 : 1}
                              outerRadius={isActive ? 130 : 120}
                            />
                          );
                        })}
                      </Pie>
                      <ReTooltip content={<CustomPieTooltip />} />
                    </PieChart>
                  </div>
                  {/* Легенда */}
                  <div className="flex-1 overflow-auto max-h-64 md:max-h-72">
                    {pieData.map((entry, i) => (
                      <div
                        key={entry.name}
                        onClick={() => setActivePieIndex(i === activePieIndex ? null : i)}
                        className={`flex items-center gap-2 mb-1.5 px-2 py-1 rounded-lg cursor-pointer transition ${
                          activePieIndex === i ? "bg-gray-100" : "hover:bg-gray-50"
                        }`}
                      >
                        <div
                          className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                        />
                        <span className={`text-xs flex-1 ${activePieIndex === i ? "font-semibold text-gray-800" : "text-gray-700"}`}>{entry.name}</span>
                        <span className="text-xs text-gray-500 font-medium">{formatAmount(entry.value)} EUR</span>
                        <span className="text-xs text-gray-400 w-12 text-right">{entry.percent.toFixed(1)}%</span>
                      </div>
                    ))}
                    <div className="border-t border-gray-100 mt-2 pt-2 flex items-center gap-2">
                      <span className="text-xs font-semibold text-gray-600 flex-1">Общо</span>
                      <span className="text-xs font-semibold text-gray-700">{formatAmount(pieTotal)} EUR</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : chartData === null || isCalculating ? (
            <p className="text-sm text-gray-400 text-center py-8 animate-pulse">⏳ Изчисляване...</p>
          ) : chartData.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">Няма данни за показване</p>
          ) : (
            <>
            {tooltipData && (
              <div className="mb-3 bg-white border border-gray-200 rounded-xl shadow px-3 py-2 text-xs"
                style={{ maxHeight: "150px", overflowY: "auto" }}>
                <p className="font-semibold text-gray-600 mb-1">{tooltipData.label}</p>
                {tooltipData.items.length === 0 ? (
                  <p className="text-gray-400">Няма стойности</p>
                ) : (
                  tooltipData.items.map((p) => (
                    <p key={p.dataKey} style={{ color: p.color }}>
                      {p.name}: {formatAmount(p.value)} EUR
                    </p>
                  ))
                )}
              </div>
            )}
            <ResponsiveContainer width="100%" height={320}>
              <LineChart
                data={chartData}
                margin={{ top: 5, right: 20, left: 10, bottom: 60 }}
                
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                {(viewMode === "overall" || (viewMode === "rolling" && rollingSubMode === "overall")) && (
                  <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" strokeWidth={1.5} />
                )}
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11 }}
                  angle={-45}
                  textAnchor="end"
                  interval={0}
                />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatAmount(v)} width={80} label={{ value: "EUR", angle: -90, position: "insideLeft", offset: 10, style: { fontSize: 11, fill: "#9ca3af" } }} />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length > 0) {
                      const visible = payload.filter((p) => p.value !== 0 && p.value !== null && p.value !== undefined);
                      const newLabel = label;
                      const newItems = visible;
                      setTimeout(() => setTooltipData((prev) => {
                        if (prev?.label === newLabel && prev?.items?.length === newItems.length) return prev;
                        return { label: newLabel, items: newItems };
                      }), 0);
                    } else {
                      if (tooltipData !== null) setTimeout(() => setTooltipData(null), 0);
                    }
                    return null;
                  }}
                />
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
            </>
          )}
          {!isCalculating && viewMode !== "pie" && chartData && chartData.length > 0 && (
            <div className="mt-2">
              <p className="text-xs text-gray-400 mb-1 px-2">💡 Категории — скролвай за да видиш всички</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-2 py-2 max-h-32 overflow-y-auto">
                {lineKeys.map((key, i) => {
                  let color = COLORS[i % COLORS.length];
                  if (key === "Приходи" || key === "Приходи (avg)") color = "#10b981";
                  if (key === "Разходи" || key === "Разходи (avg)") color = "#ef4444";
                  if (key === "Баланс" || key === "Баланс (avg)") color = "#3b82f6";
                  const isExpense = key.endsWith("::expense");
                  const displayName = key.includes("::") ? key.split("::")[0] + (isExpense ? " (разход)" : " (приход)") : key;
                  return (
                    <div key={key} className="flex items-center gap-1.5 flex-shrink-0">
                      <div className="flex-shrink-0 rounded-full" style={{ backgroundColor: color, width: "12px", height: "2px" }} />
                      <span className="text-xs text-gray-600">{displayName}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChartsModal;