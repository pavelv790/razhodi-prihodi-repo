import { TrendingUp, TrendingDown, Wallet } from "lucide-react";
import { formatAmount } from "../utils/formatters";

const SummaryCards = ({ summary, isFiltered }) => {
  const { income, expense, balance } = summary;
  const isPositive = balance >= 0;

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

      <div className="bg-blue-50 rounded-2xl p-4 shadow-md border border-red-200">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-gray-500">Разходи</span>
          <div className="bg-red-100 p-1.5 rounded-xl">
            <TrendingDown className="w-4 h-4 text-red-500" />
          </div>
        </div>
        <p className="text-lg font-bold text-red-500">
          {formatAmount(expense)} EUR
        </p>
        {isFiltered && (
          <p className="text-xs text-gray-400 mt-1">за избрания период</p>
        )}
      </div>

      <div
        className={`col-span-2 bg-blue-50 rounded-2xl p-4 shadow-md border ${
          isPositive ? "border-emerald-200" : "border-orange-200"
        }`}
      >
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
    </div>
  );
};

export default SummaryCards;