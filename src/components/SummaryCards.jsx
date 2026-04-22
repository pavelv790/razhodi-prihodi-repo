import { useState } from "react";
import { TrendingUp, TrendingDown, Wallet, AlertTriangle, ChevronDown } from "lucide-react";
import { formatAmount } from "../utils/formatters";

const parseDate = (s) => {
  if (!s) return null;
  const [d, m, y] = s.split("/");
  return new Date(y, m - 1, d);
};

const SummaryCards = ({ summary, isFiltered, budgets, filteredTransactions, allTransactions }) => {
  const { income, expense, balance } = summary;
  const isPositive = balance >= 0;
  const [warningsOpen, setWarningsOpen] = useState(true);

  const budgetFrom = budgets?.fromDate ? parseDate(budgets.fromDate) : null;
  const budgetTo = budgets?.toDate ? parseDate(budgets.toDate) : null;

  const isInBudgetPeriod = (t) => {
    const date = parseDate(t.date);
    if (!date) return false;
    if (budgetFrom && date < budgetFrom) return false;
    if (budgetTo && date > budgetTo) return false;
    return true;
  };

  // Общ лимит — от filteredTransactions за бюджетния период
  const filteredBudgetExpense = (filteredTransactions || [])
    .filter((t) => t.type === "expense" && isInBudgetPeriod(t))
    .reduce((sum, t) => sum + t.amount, 0);

  // Лимити по категории — от allTransactions за бюджетния период
  const expenseByCategory = {};
  (allTransactions || [])
    .filter((t) => t.type === "expense" && isInBudgetPeriod(t))
    .forEach((t) => {
      expenseByCategory[t.category] = (expenseByCategory[t.category] || 0) + t.amount;
    });

  const totalLimit = budgets?.totalLimit ? parseFloat(budgets.totalLimit) : null;
  const totalExceeded = totalLimit !== null && filteredBudgetExpense > totalLimit;
  const totalPercent = totalLimit ? Math.round((filteredBudgetExpense / totalLimit) * 100) : null;

  const categoryLimits = budgets?.categoryLimits || {};
  const exceededCategories = Object.entries(categoryLimits)
    .filter(([cat, lim]) => {
      const limit = parseFloat(lim);
      return !isNaN(limit) && limit > 0 && (expenseByCategory[cat] || 0) > limit;
    })
    .map(([cat, lim]) => ({
      cat,
      spent: expenseByCategory[cat] || 0,
      limit: parseFloat(lim),
      percent: Math.round(((expenseByCategory[cat] || 0) / parseFloat(lim)) * 100),
    }));

  return (
    <div className="grid grid-cols-2 gap-3 mb-6">
      <div className="bg-blue-50 rounded-2xl p-4 shadow-md border border-green-200">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-gray-500">Приходи</span>
          <div className="bg-green-100 p-1.5 rounded-xl">
            <TrendingUp className="w-4 h-4 text-green-500" />
          </div>
        </div>
        <p className="text-lg font-bold text-green-500">
          {formatAmount(income)} EUR
        </p>
        {isFiltered && (
          <p className="text-xs text-gray-400 mt-1">за избрания период</p>
        )}
      </div>

      <div className={`bg-blue-50 rounded-2xl p-4 shadow-md border ${totalExceeded ? "border-orange-400" : "border-red-200"}`}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-gray-500">Разходи</span>
          <div className={`p-1.5 rounded-xl ${totalExceeded ? "bg-orange-100" : "bg-red-100"}`}>
            {totalExceeded
              ? <AlertTriangle className="w-4 h-4 text-orange-500" />
              : <TrendingDown className="w-4 h-4 text-red-500" />
            }
          </div>
        </div>
        <p className={`text-lg font-bold ${totalExceeded ? "text-orange-500" : "text-red-500"}`}>
          {formatAmount(expense)} EUR
        </p>
        {totalLimit !== null && (
          <p className={`text-xs mt-1 ${totalExceeded ? "text-orange-500 font-semibold" : "text-gray-400"}`}>
            {totalExceeded ? `⚠️ ` : ""}{formatAmount(filteredBudgetExpense)} / {formatAmount(totalLimit)} EUR ({totalPercent}%)
          </p>
        )}
        {isFiltered && !totalLimit && (
          <p className="text-xs text-gray-400 mt-1">за избрания период</p>
        )}
      </div>

      <div className={`col-span-2 bg-blue-50 rounded-2xl p-4 shadow-md border ${isPositive ? "border-emerald-200" : "border-orange-200"}`}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-gray-500">Баланс</span>
          <div className={`p-1.5 rounded-xl ${isPositive ? "bg-emerald-100" : "bg-orange-100"}`}>
            <Wallet className={`w-4 h-4 ${isPositive ? "text-emerald-500" : "text-orange-500"}`} />
          </div>
        </div>
        <p className={`text-lg font-bold ${isPositive ? "text-emerald-500" : "text-orange-500"}`}>
          {isPositive ? "+" : ""}{formatAmount(balance)} EUR
        </p>
        {isFiltered && (
          <p className="text-xs text-gray-400 mt-1">за избрания период</p>
        )}
      </div>

      {/* Предупреждения по категории */}
      {exceededCategories.length > 0 && (
        <div className="col-span-2 bg-orange-50 border border-orange-200 rounded-2xl shadow-md overflow-hidden">
          <button
            onClick={() => setWarningsOpen((prev) => !prev)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-orange-100 transition"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-orange-500" />
              <span className="text-sm font-semibold text-orange-600">
                Надскочени лимити ({exceededCategories.length + (totalExceeded ? 1 : 0)})
              </span>
            </div>
            <ChevronDown className={`w-4 h-4 text-orange-400 transition-transform ${warningsOpen ? "rotate-180" : ""}`} />
          </button>
          {warningsOpen && (
            <div className="px-4 pb-3 space-y-2 border-t border-orange-100">
              {totalExceeded && (
                <div className="flex items-center justify-between text-xs pt-2">
                  <span className="text-gray-700 font-medium">Общо разходи</span>
                  <span className="text-orange-600 font-semibold">
                    {formatAmount(filteredBudgetExpense)} / {formatAmount(totalLimit)} EUR ({totalPercent}%)
                  </span>
                </div>
              )}
              {exceededCategories.map(({ cat, spent, limit, percent }) => (
                <div key={cat} className="flex items-center justify-between text-xs pt-2">
                  <span className="text-gray-700 font-medium">{cat}</span>
                  <span className="text-orange-600 font-semibold">
                    {formatAmount(spent)} / {formatAmount(limit)} EUR ({percent}%)
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SummaryCards;