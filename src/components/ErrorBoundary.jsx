import { Component } from "react";
import { openDB } from "../utils/db";
import { getFirstDayOfMonth, getLastDayOfMonth } from "../utils/formatters";

const readAll = async (db, store) =>
  new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });

// Събира резервното копие директно от IndexedDB (без React state), във формата на buildBackupData (version "1.6").
// Активният профил е от localStorage "active_profile_id" (както в useProfiles), иначе първият.
const buildBackupFromDB = async () => {
  const db = await openDB();
  const [profiles, transactions, savedFilters, recurringItems, catRecords, currencyRecords, budgetRecords] =
    await Promise.all([
      readAll(db, "profiles"),
      readAll(db, "transactions"),
      readAll(db, "saved_filters"),
      readAll(db, "recurring"),
      readAll(db, "categories"),
      readAll(db, "currency"),
      readAll(db, "budgets"),
    ]);

  let savedId = null;
  try { savedId = localStorage.getItem("active_profile_id"); } catch { /* localStorage недостъпен */ }
  const activeProfile = profiles.find((p) => p.id === savedId) || profiles[0] || null;
  const activeProfileId = activeProfile ? activeProfile.id : null;

  const profileCategories = {};
  catRecords.forEach((entry) => {
    profileCategories[entry.type] = {
      expense: entry.categories?.expense || [],
      income: entry.categories?.income || [],
    };
  });
  const profileCurrencies = {};
  currencyRecords.forEach((entry) => {
    profileCurrencies[entry.id] = { currency: entry.currency, rate: entry.rate };
  });
  const profileBudgets = {};
  budgetRecords.forEach((entry) => {
    const { id, ...rest } = entry;
    profileBudgets[id] = rest;
  });

  const today = new Date();
  const activeCats = profileCategories[activeProfileId] || { expense: [], income: [] };
  const activeCurrency = profileCurrencies[activeProfileId] || { currency: "EUR", rate: 1 };
  const activeBudgets = profileBudgets[activeProfileId] || {
    totalLimit: "",
    categoryLimits: {},
    fromDate: getFirstDayOfMonth(today),
    toDate: getLastDayOfMonth(today),
  };

  return {
    backup: {
      version: "1.6",
      date: today.toISOString(),
      profiles,
      activeProfileId,
      transactions,
      expenseCategories: activeCats.expense,
      incomeCategories: activeCats.income,
      profileCategories,
      savedFilters,
      currency: activeCurrency.currency,
      rate: activeCurrency.rate,
      budgets: activeBudgets,
      profileCurrencies,
      profileBudgets,
      recurringItems,
    },
    profileName: activeProfile?.name || "",
  };
};

export default class ErrorBoundary extends Component {
  state = { hasError: false, downloading: false, downloadError: "" };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error("Грешка при рендер на приложението:", error, info?.componentStack);
  }

  handleDownload = async () => {
    this.setState({ downloading: true, downloadError: "" });
    try {
      const { backup, profileName } = await buildBackupFromDB();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const now = new Date();
      const day = String(now.getDate()).padStart(2, "0");
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const suffix = profileName ? `_${profileName.replace(/[/\\:*?"<>|]/g, "-")}` : "";
      a.href = url;
      a.download = `Финанси_Backup${suffix}_${day}.${month}.${now.getFullYear()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 100);
      this.setState({ downloading: false });
    } catch (err) {
      console.error("Грешка при сваляне на резервно копие от аварийния екран:", err);
      this.setState({
        downloading: false,
        downloadError: "Не успяхме да свалим резервното копие. Опитайте да презаредите страницата.",
      });
    }
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    const { downloading, downloadError } = this.state;
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg p-6 text-center">
          <div className="text-4xl mb-3">⚠️</div>
          <h1 className="text-xl font-bold text-gray-800 mb-2">Нещо се обърка</h1>
          <p className="text-sm text-gray-600 mb-5">
            Приложението не можа да се покаже. Данните на това устройство са запазени.
            Опитайте да презаредите страницата. Ако проблемът остане, свалете резервно копие.
          </p>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => location.reload()}
              className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 transition"
            >
              Презареди
            </button>
            <button
              onClick={this.handleDownload}
              disabled={downloading}
              className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-green-50 text-green-600 hover:bg-green-100 transition disabled:opacity-50"
            >
              {downloading ? "Подготвяне…" : "Свали резервно копие"}
            </button>
          </div>
          {downloadError && (
            <p className="mt-3 text-xs text-red-600 bg-red-50 rounded-xl px-3 py-2">{downloadError}</p>
          )}
        </div>
      </div>
    );
  }
}
