import { useState, useEffect } from "react";
import { X, Copy, ChevronDown, Search, Calendar } from "lucide-react";
import { openDB } from "../utils/db";
import { parseDate, getFirstDayOfMonth, getLastDayOfMonth } from "../utils/formatters";
import DateInput from "./DateInput";

const CategoryDropdown = ({ label, color, categories, selected, selectedCategories, type, toggleCategory, setSelected, otherSelected }) => {
  const [search, setSearch] = useState("");
  const [show, setShow] = useState(false);
  const visibleList = categories.filter((c) => c.toLowerCase().startsWith(search.toLowerCase()));
  const allSelected = categories.length > 0 && categories.every((c) => selectedCategories.includes(`${c}::${type}`));

  const toggleAll = () => {
    const allKeys = categories.map((c) => `${c}::${type}`);
    const rest = selectedCategories.filter((k) => !k.endsWith(`::${type}`));
    setSelected(allSelected ? rest : [...rest, ...allKeys]);
  };

  return (
    <div className="flex-1 min-w-0">
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <button
        onClick={() => setShow((prev) => !prev)}
        className={`w-full flex items-center justify-between border rounded-xl px-3 py-2 text-sm bg-white transition ${
          selected.length > 0
            ? color === "red" ? "border-red-300 hover:bg-red-50" : "border-green-300 hover:bg-green-50"
            : "border-gray-200 hover:bg-gray-50"
        }`}
      >
        <span className={selected.length > 0 ? (color === "red" ? "text-red-500" : "text-green-600") : "text-gray-500"}>
          {selected.length === 0 ? (otherSelected > 0 ? "Няма избрани" : "Всички") : `${selected.length} избрани`}
        </span>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${show ? "rotate-180" : ""}`} />
      </button>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {selected.map((key) => {
            const [name] = key.split("::");
            return (
              <span key={key} className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs ${
                color === "red" ? "bg-red-100 text-red-600" : "bg-green-100 text-green-700"
              }`}>
                {name}
                <button onClick={() => toggleCategory(name, type)}><X className="w-3 h-3" /></button>
              </span>
            );
          })}
          <button
            onClick={() => setSelected(selectedCategories.filter((k) => !k.endsWith(`::${type}`)))}
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
            <input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-emerald-500" />
            Маркирай всички
          </label>
          <div className="max-h-48 overflow-y-auto">
            {visibleList.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-3">Няма намерени</p>
            ) : (
              visibleList.map((cat) => {
                const key = `${cat}::${type}`;
                return (
                  <label key={key} className={`flex items-center gap-2 px-3 py-2 cursor-pointer text-sm ${
                    color === "red" ? "hover:bg-red-50" : "hover:bg-green-50"
                  }`}>
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

const CopyTransactionsModal = ({ profiles, activeProfileId, activeProfileName, onClose, onAdd }) => {
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sourceTxs, setSourceTxs] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [duplicates, setDuplicates] = useState([]);
  const [unique, setUnique] = useState([]);
  const [selectedDuplicates, setSelectedDuplicates] = useState([]);
  const [step, setStep] = useState("select"); // "select" | "duplicates" | "done"
  const [activeTransactions, setActiveTransactions] = useState([]);

  const otherProfiles = profiles.filter((p) => p.id !== activeProfileId);

  // Уникални категории от транзакциите на избрания профил
  const expenseCategories = [...new Set(sourceTxs.filter((t) => t.type === "expense").map((t) => t.category))].sort();
  const incomeCategories = [...new Set(sourceTxs.filter((t) => t.type === "income").map((t) => t.category))].sort();

  const selectedExpenses = selectedCategories.filter((k) => k.endsWith("::expense"));
  const selectedIncomes = selectedCategories.filter((k) => k.endsWith("::income"));

  const toggleCategory = (name, type) => {
    const key = `${name}::${type}`;
    setSelectedCategories((prev) =>
      prev.includes(key) ? prev.filter((c) => c !== key) : [...prev, key]
    );
  };

  // Зареди транзакциите на избрания профил
  useEffect(() => {
    if (!selectedProfileId) { setSourceTxs([]); setSelectedCategories([]); return; }
    (async () => {
      const db = await openDB();
      const all = await new Promise((resolve) => {
        const tx = db.transaction("transactions", "readonly");
        const req = tx.objectStore("transactions").getAll();
        req.onsuccess = () => resolve(req.result || []);
      });
      setSourceTxs(all.filter((t) => t.profileId === selectedProfileId));
      setSelectedCategories([]);
    })();
  }, [selectedProfileId]);

  // Зареди транзакциите на активния профил (за проверка на дубликати)
  useEffect(() => {
    (async () => {
      const db = await openDB();
      const all = await new Promise((resolve) => {
        const tx = db.transaction("transactions", "readonly");
        const req = tx.objectStore("transactions").getAll();
        req.onsuccess = () => resolve(req.result || []);
      });
      setActiveTransactions(all.filter((t) => t.profileId === activeProfileId));
    })();
  }, [activeProfileId]);

  // Филтрирай по период и категории
  useEffect(() => {
    let result = sourceTxs;
    if (fromDate) {
      const from = parseDate(fromDate);
      if (from) result = result.filter((t) => { const d = parseDate(t.date); return d && d >= from; });
    }
    if (toDate) {
      const to = parseDate(toDate);
      if (to) result = result.filter((t) => { const d = parseDate(t.date); return d && d <= to; });
    }
    if (selectedCategories.length > 0) {
      result = result.filter((t) =>
        selectedCategories.some((key) => {
          const [name, type] = key.split("::");
          return t.category === name && t.type === type;
        })
      );
    }
    setFiltered(result);
  }, [sourceTxs, fromDate, toDate, selectedCategories]);

  const handleThisMonth = () => {
    const now = new Date();
    setFromDate(getFirstDayOfMonth(now));
    setToDate(getLastDayOfMonth(now));
  };

  const handleLastMonth = () => {
    const now = new Date();
    const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    setFromDate(getFirstDayOfMonth(last));
    setToDate(getLastDayOfMonth(last));
  };

  const handleThisYear = () => {
    const now = new Date();
    setFromDate(`01/01/${now.getFullYear()}`);
    setToDate(`31/12/${now.getFullYear()}`);
  };

  const handleLastYear = () => {
    const y = new Date().getFullYear() - 1;
    setFromDate(`01/01/${y}`);
    setToDate(`31/12/${y}`);
  };

  const handleCopy = () => {
    if (filtered.length === 0) return;

    const dupes = filtered.filter((bt) =>
      activeTransactions.some(
        (e) =>
          e.date === bt.date &&
          e.category === bt.category &&
          e.type === bt.type &&
          Math.abs(Number(e.amount) - Number(bt.amount)) < 0.01
      )
    );
    const uniq = filtered.filter((bt) => !dupes.some((d) => d.id === bt.id));

    if (dupes.length > 0) {
      setDuplicates(dupes);
      setUnique(uniq);
      setSelectedDuplicates([]);
      setStep("duplicates");
    } else {
      const toAdd = filtered.map((t) => ({
        ...t,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        profileId: activeProfileId,
      }));
      onAdd(toAdd);
      setStep("done");
    }
  };

  const handleConfirmDuplicates = () => {
    const toAdd = [
      ...unique,
      ...duplicates.filter((t) => selectedDuplicates.includes(t.id)),
    ].map((t) => ({
      ...t,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      profileId: activeProfileId,
    }));
    onAdd(toAdd);
    setStep("done");
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-blue-50 rounded-2xl shadow-xl w-full max-w-sm max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-blue-50 z-10">
          <div className="flex items-center gap-2">
            <Copy className="w-4 h-4 text-gray-500" />
            <h2 className="text-base font-semibold text-gray-700">Копирай от друг профил</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {step === "select" && (
          <div className="px-5 py-4 space-y-4">
            <div className="bg-blue-100 rounded-xl px-3 py-2 text-xs text-blue-700">
              Транзакциите ще бъдат копирани в профил <strong>{activeProfileName}</strong>.
            </div>

            {/* Избор на профил */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">От кой профил:</label>
              <div className="flex flex-col gap-1">
                {otherProfiles.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedProfileId(p.id)}
                    className={`flex items-center px-3 py-2 rounded-xl text-sm border transition ${
                      selectedProfileId === p.id
                        ? "border-blue-300 bg-blue-100 text-blue-700 font-medium"
                        : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>

            {selectedProfileId && (
              <>
                {/* Период */}
                <div>
                  <label className="block text-xs text-gray-500 mb-2">Период (незадължително)</label>
                  <div className="grid grid-cols-2 gap-3 mb-2">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">От дата</label>
                      <DateInput value={fromDate} onChange={setFromDate} />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">До дата</label>
                      <DateInput value={toDate} onChange={setToDate} />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { label: "Този месец", action: handleThisMonth },
                      { label: "Миналия месец", action: handleLastMonth },
                      { label: "Тази година", action: handleThisYear },
                      { label: "Миналата година", action: handleLastYear },
                    ].map(({ label, action }) => (
                      <button key={label} onClick={action} className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition">
                        <Calendar className="w-3 h-3" />{label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Категории */}
                <div>
                  <label className="block text-xs text-gray-500 mb-2">Категории (незадължително)</label>
                  <div className="flex gap-3">
                    <CategoryDropdown
                      label="Разходи"
                      color="red"
                      categories={expenseCategories}
                      selected={selectedExpenses}
                      selectedCategories={selectedCategories}
                      type="expense"
                      toggleCategory={toggleCategory}
                      setSelected={setSelectedCategories}
                      otherSelected={selectedIncomes.length}
                    />
                    <CategoryDropdown
                      label="Приходи"
                      color="green"
                      categories={incomeCategories}
                      selected={selectedIncomes}
                      selectedCategories={selectedCategories}
                      type="income"
                      toggleCategory={toggleCategory}
                      setSelected={setSelectedCategories}
                      otherSelected={selectedExpenses.length}
                    />
                  </div>
                </div>

                {/* Брой намерени */}
                <div className="bg-white rounded-xl px-3 py-2 border border-gray-200 text-sm text-gray-600">
                  Намерени транзакции: <strong>{filtered.length}</strong>
                </div>

                <button
                  onClick={handleCopy}
                  disabled={filtered.length === 0}
                  className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Напред {filtered.length > 0 ? `(${filtered.length})` : ""}
                </button>
              </>
            )}
          </div>
        )}

        {step === "duplicates" && (
          <div className="px-5 py-4 space-y-4">
            <div className="bg-orange-50 rounded-xl px-3 py-2 text-xs text-orange-700">
              ⚠️ Намерени са <strong>{duplicates.length}</strong> вероятни дубликата (същата дата, категория, тип и сума вече съществуват). Уникални за добавяне: <strong>{unique.length}</strong>.
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-gray-600">Вероятни дубликати:</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSelectedDuplicates(duplicates.map((t) => t.id))}
                    className="text-xs px-2 py-1 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition"
                  >
                    Избери всички
                  </button>
                  <button
                    onClick={() => setSelectedDuplicates([])}
                    className="text-xs px-2 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
                  >
                    Откажи всички
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
                {duplicates.map((t) => (
                  <label
                    key={t.id}
                    className={`flex items-center gap-3 px-3 py-2 rounded-xl border cursor-pointer transition ${
                      selectedDuplicates.includes(t.id)
                        ? "border-blue-300 bg-blue-50"
                        : "border-gray-200 bg-white"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedDuplicates.includes(t.id)}
                      onChange={() =>
                        setSelectedDuplicates((prev) =>
                          prev.includes(t.id) ? prev.filter((d) => d !== t.id) : [...prev, t.id]
                        )
                      }
                      className="accent-blue-500 flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-700 truncate">{t.category}</p>
                      <p className="text-xs text-gray-400">{t.date} · {Number(t.amount).toFixed(2)} EUR</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
                      t.type === "expense" ? "bg-red-100 text-red-600" : "bg-green-100 text-green-600"
                    }`}>
                      {t.type === "expense" ? "Разход" : "Приход"}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <button
              onClick={handleConfirmDuplicates}
              className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition"
            >
              Потвърди ({unique.length + selectedDuplicates.length} транзакции)
            </button>
            <button
              onClick={() => setStep("select")}
              className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
            >
              Назад
            </button>
          </div>
        )}

        {step === "done" && (
          <div className="px-5 py-4 space-y-4">
            <div className="bg-green-50 rounded-xl px-4 py-3 text-sm text-green-700 font-medium">
              ✅ Транзакциите са копирани успешно в профил <strong>{activeProfileName}</strong>.
            </div>
            <button
              onClick={onClose}
              className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 transition"
            >
              Затвори
            </button>
          </div>
        )}

      </div>
    </div>
  );
};

export default CopyTransactionsModal;