import { useState, useRef } from "react";
import { X, Upload, ChevronDown, Search, Calendar } from "lucide-react";
import { importBackup } from "../utils/backup";
import { parseDate } from "../utils/formatters";
import DateInput from "./DateInput";
import { getFirstDayOfMonth, getLastDayOfMonth } from "../utils/formatters";

// Преизползваме CategoryDropdown логиката от FilterBar
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

const MergeProfileModal = ({ onClose, onMerge, activeProfile, existingTransactions }) => {
  const fileRef = useRef(null);
  const [backupData, setBackupData] = useState(null);
  const [selectedProfileId, setSelectedProfileId] = useState(null);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [error, setError] = useState("");
  const [step, setStep] = useState(1); // 1=избор на файл, 2=филтриране, 3=дубликати
  const [duplicates, setDuplicates] = useState([]);
  const [uniqueTransactions, setUniqueTransactions] = useState([]);
  const [selectedDuplicates, setSelectedDuplicates] = useState([]);

  const handleFileSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = await importBackup(file);
      setBackupData(data);
      // Избираме активния профил от backup-а по подразбиране
      const defaultId = data.activeProfileId || (data.profiles?.[0]?.id ?? null);
      setSelectedProfileId(defaultId);
      setStep(2);
      setError("");
    } catch (err) {
      setError(err.message);
    }
  };

  // Категориите на избрания профил от backup файла
  const backupExpenseCategories = backupData?.expenseCategories || [];
  const backupIncomeCategories = backupData?.incomeCategories || [];

  const selectedExpenses = selectedCategories.filter((k) => k.endsWith("::expense"));
  const selectedIncomes = selectedCategories.filter((k) => k.endsWith("::income"));

  const toggleCategory = (name, type) => {
    const key = `${name}::${type}`;
    setSelectedCategories((prev) =>
      prev.includes(key) ? prev.filter((c) => c !== key) : [...prev, key]
    );
  };

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

  const getFilteredTransactions = () => {
    if (!backupData) return [];
    let txs;
    if (!backupData.profiles || backupData.profiles.length === 0) {
      // Стар backup без профили — взимаме всички транзакции
      txs = backupData.transactions;
    } else {
      // Нов backup — взимаме само транзакциите на избрания профил
      txs = backupData.transactions.filter((t) => t.profileId === selectedProfileId);
    }
    return txs.filter((t) => {
      const date = parseDate(t.date);
      if (fromDate) {
        const from = parseDate(fromDate);
        if (from && date && date < from) return false;
      }
      if (toDate) {
        const to = parseDate(toDate);
        if (to && date && date > to) return false;
      }
      if (selectedCategories.length > 0) {
        const match = selectedCategories.some((key) => {
          const [name, type] = key.split("::");
          return t.category === name && t.type === type;
        });
        if (!match) return false;
      }
      return true;
    });
  };

  const filteredCount = step === 2 ? getFilteredTransactions().length : 0;

  const isDuplicate = (t) => {
    return existingTransactions.some(
      (e) =>
        e.date === t.date &&
        e.category === t.category &&
        e.type === t.type &&
        Math.abs(Number(e.amount) - Number(t.amount)) < 0.01
    );
  };

  const handleMerge = () => {
    const txs = getFilteredTransactions();
    if (txs.length === 0) { setError("Няма транзакции за избрания период и категории."); return; }
    const dupes = txs.filter((t) => isDuplicate(t));
    const unique = txs.filter((t) => !isDuplicate(t));
    if (dupes.length > 0) {
      setDuplicates(dupes);
      setUniqueTransactions(unique);
      setSelectedDuplicates([]);
      setStep(3);
    } else {
      onMerge(txs, backupData.expenseCategories, backupData.incomeCategories);
      onClose();
    }
  };

  const handleConfirmMerge = () => {
    const toImport = [
      ...uniqueTransactions,
      ...duplicates.filter((t) => selectedDuplicates.includes(t.id)),
    ];
    if (toImport.length === 0) { setError("Няма избрани транзакции за импорт."); setStep(2); return; }
    onMerge(toImport, backupData.expenseCategories, backupData.incomeCategories);
    onClose();
  };

  const toggleDuplicate = (id) => {
    setSelectedDuplicates((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]
    );
  };

  const selectAllDuplicates = () => setSelectedDuplicates(duplicates.map((t) => t.id));
  const deselectAllDuplicates = () => setSelectedDuplicates([]);

  const selectedBackupProfile = backupData?.profiles?.find((p) => p.id === selectedProfileId);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-blue-50 rounded-2xl shadow-xl w-full max-w-sm max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-blue-50 z-10">
          <h2 className="text-base font-semibold text-gray-700">Импортирай данни от друг профил</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">

          {/* Стъпка 1: избор на файл */}
          <div>
            <p className="text-xs text-gray-500 mb-2">
              Избери backup файл (.json) от другия профил
            </p>
            <button
              onClick={() => { fileRef.current.value = ""; fileRef.current.click(); }}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-blue-100 text-blue-600 hover:bg-blue-200 transition"
            >
              <Upload className="w-4 h-4" />
              {backupData ? "Избери друг файл" : "Избери файл"}
            </button>
            <input ref={fileRef} type="file" accept=".json" onChange={handleFileSelect} className="hidden" />
          </div>

          {error && <p className="text-xs text-red-500 bg-red-50 rounded-xl px-3 py-2">{error}</p>}

          {/* Стъпка 2: филтриране */}
          {step === 2 && backupData && (
            <>
              {/* Избор на профил от backup-а */}
              {backupData.profiles?.length > 1 && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Профил от backup файла</label>
                  <div className="flex flex-col gap-1">
                    {backupData.profiles.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => setSelectedProfileId(p.id)}
                        className={`flex items-center justify-between px-3 py-2 rounded-xl text-sm border transition ${
                          selectedProfileId === p.id
                            ? "border-blue-300 bg-blue-100 text-blue-700 font-medium"
                            : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                        }`}
                      >
                        <span>{p.name}</span>
                        {p.id === backupData.activeProfileId && (
                          <span className="text-xs text-blue-400 bg-blue-50 px-2 py-0.5 rounded-full">активен</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Целеви профил */}
              <div className="bg-emerald-50 rounded-xl px-3 py-2 text-xs text-emerald-700">
                Транзакциите ще се добавят към: <strong>{activeProfile?.name}</strong>
                {selectedBackupProfile && (
                  <span className="ml-1">от профил <strong>{selectedBackupProfile.name}</strong></span>
                )}
              </div>

              {/* Период */}
              <div>
                <label className="block text-xs text-gray-500 mb-2">Период</label>
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
                <label className="block text-xs text-gray-500 mb-2">Категории</label>
                <div className="flex gap-3">
                  <CategoryDropdown
                    label="Разходи"
                    color="red"
                    categories={backupExpenseCategories}
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
                    categories={backupIncomeCategories}
                    selected={selectedIncomes}
                    selectedCategories={selectedCategories}
                    type="income"
                    toggleCategory={toggleCategory}
                    setSelected={setSelectedCategories}
                    otherSelected={selectedExpenses.length}
                  />
                </div>
              </div>

              {/* Брой транзакции */}
              <div className="bg-blue-100 rounded-xl px-3 py-2 text-xs text-blue-700">
                Намерени транзакции за импорт: <strong>{filteredCount}</strong>
              </div>

              {/* Бутон Импортирай */}
              <button
                onClick={handleMerge}
                disabled={filteredCount === 0}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition disabled:opacity-40"
              >
                Напред {filteredCount > 0 ? `(${filteredCount} транзакции)` : ""}
              </button>
            </>
          )}

          {/* Стъпка 3: дубликати */}
          {step === 3 && (
            <>
              <div className="bg-orange-50 rounded-xl px-3 py-2 text-xs text-orange-700">
                ⚠️ Намерени са <strong>{duplicates.length}</strong> вероятни дубликата (същата дата, категория и сума вече съществуват). Уникални транзакции за импорт: <strong>{uniqueTransactions.length}</strong>.
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-gray-600">Вероятни дубликати:</p>
                  <div className="flex gap-2">
                    <button
                      onClick={selectAllDuplicates}
                      className="text-xs px-2 py-1 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition"
                    >
                      Избери всички
                    </button>
                    <button
                      onClick={deselectAllDuplicates}
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
                        onChange={() => toggleDuplicate(t.id)}
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

              <div className="flex gap-2">
                <button
                  onClick={() => setStep(2)}
                  className="px-4 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
                >
                  Назад
                </button>
                <button
                  onClick={handleConfirmMerge}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition"
                >
                  Потвърди импорта ({uniqueTransactions.length + selectedDuplicates.length} транзакции)
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default MergeProfileModal;