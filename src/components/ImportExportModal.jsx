import { useState, useRef, useEffect } from "react";
import { X } from "lucide-react";
import { importFromExcel, exportToExcel } from "../utils/excel";
import { linkCategories, applyCategorySpelling } from "../utils/categoryMatch";
import { formatAmount, parseDate } from "../utils/formatters";

const INVALID_ROWS_SHOWN = 50;

// Брой и сума по тип и период от-до на транзакциите от файла (датите вече са проверени)
const importSummary = (list) => {
  const ofType = (type) => {
    const items = list.filter((t) => t.type === type);
    return { count: items.length, total: items.reduce((sum, t) => sum + Number(t.amount), 0) };
  };
  const byTime = [...list].sort((a, b) => parseDate(a.date) - parseDate(b.date));
  return {
    expense: ofType("expense"),
    income: ofType("income"),
    from: byTime[0]?.date ?? "",
    to: byTime.at(-1)?.date ?? "",
  };
};

const ImportExportModal = ({
  onClose,
  transactions,
  filteredTransactions,
  isFiltered,
  activeFilters,
  onImportAdd,
  onImportReplace,
  onCategoriesImported,
  mode,
  expenseCategories,
  incomeCategories,
  profileName,
}) => {
  const hasExportData = mode === "export" && filteredTransactions?.length > 0;
  const [step, setStep] = useState(() => (hasExportData && isFiltered ? "exportWarning" : "main"));
  const [pendingTransactions, setPendingTransactions] = useState(null);
  const [invalidRows, setInvalidRows] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [noDataMessage, setNoDataMessage] = useState(mode === "export" && !hasExportData);
  // Замяната от файла: подготвеният списък, старият (за връщане при провал) и новите категории.
  // Запомнят се преди записа — след извикването `transactions` вече е новият списък (одит 2026-10, 7-09)
  const [replacePlan, setReplacePlan] = useState(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef(null);
  const mountedRef = useRef(false);

  // Експортът може да свърши, след като прозорецът е затворен — тогава не се пипа нищо
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Грешка при създаване на файла → съобщение със „Затвори“, не безкраен спинер (одит 2026-10, 5-5)
  const runExport = async (...exportArgs) => {
    setLoading(true);
    try {
      await exportToExcel(...exportArgs);
      if (mountedRef.current) onClose();
    } catch (err) {
      if (!mountedRef.current) return;
      setError("❌ Грешка при създаване на Excel файла: " + (err?.message || err));
      setLoading(false);
      setStep("error");
    }
  };

  // Отказ от избора на файл: React не вика `onCancel` на <input> (събитието не е сред тези, които слуша за него),
  // затова е собствен слушател. Старата резерва по `focus` + таймер е махната — тя затваряше потвърждението
  // след избран файл, когато `focus` дойде преди `change` (одит 2026-10, 5-8). Прозорецът е видим, има „Откажи“.
  useEffect(() => {
    const input = fileInputRef.current;
    if (mode !== "import" || !input) return;
    input.addEventListener("cancel", onClose);
    return () => input.removeEventListener("cancel", onClose);
  }, [mode, onClose]);

  useEffect(() => {
    // Без данни и при филтър началното състояние е вече зададено горе — тук само експортът без филтър
    if (mode === "export") {
      if (hasExportData && !isFiltered) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- експортът тръгва сам при отваряне на прозореца
        runExport(filteredTransactions, expenseCategories, incomeCategories, false, [], profileName);
      }
    } else if (mode === "import") {
      // Изборът се опитва да се отвори сам; ако телефонът не го позволи, „Избери файл“ го отваря от натискането
      const timerId = setTimeout(() => fileInputRef.current?.click(), 50);
      return () => clearTimeout(timerId);
    }
  }, []);

  const handleFileSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) { onClose(); return; }
    setLoading(true);
    setError("");
    try {
      const { transactions: imported, invalidRows: invalid } = await importFromExcel(file);
      // Невалиден ред → нищо не се зарежда, показва се кои редове и защо (одит 2026-10, 5-2, 5-3)
      if (invalid.length > 0) {
        setInvalidRows(invalid);
        setLoading(false);
        setStep("invalid");
        return;
      }
      if (imported.length === 0) {
        setError("Файлът не съдържа валидни транзакции.");
        setLoading(false);
        setStep("error");
        return;
      }
      setPendingTransactions(imported);
      setStep("confirm");
    } catch (err) {
      setError(err.message);
      setStep("error");
    }
    setLoading(false);
  };

  // Замяната чака записа: категориите се добавят и прозорецът се затваря само при успех. При провал
  // прозорецът остава с „Опитай пак“/„Затвори“ — иначе екранът показва новите транзакции като записани,
  // а в паметта са старите (одит 2026-10, 7-09)
  const saveReplace = async (plan) => {
    setSaving(true);
    let saved = false;
    try {
      saved = await onImportReplace(plan.prepared);
    } catch { /* replaceAllTransactions не отхвърля; ако все пак — като провал */ }
    if (!mountedRef.current) return;
    setSaving(false);
    if (!saved) {
      setStep("saveFailed");
      return;
    }
    onCategoriesImported(plan.added);
    onClose();
  };

  const handleConfirmReplace = () => {
    // Категория, която се различава от съществуваща само по главни/малки букви, приема съществуващото
    // изписване — и в списъка, и в транзакциите (одит 2026-10, 1А-16)
    const fromFile = (type) => pendingTransactions.filter((t) => t.type === type).map((t) => t.category);
    const expense = linkCategories(expenseCategories, fromFile("expense"));
    const income = linkCategories(incomeCategories, fromFile("income"));
    const plan = {
      prepared: applyCategorySpelling(pendingTransactions, { expense: expense.resolve, income: income.resolve }),
      previous: transactions,
      added: { expense: expense.added, income: income.added },
    };
    setReplacePlan(plan);
    saveReplace(plan);
  };

  // „Затвори“ след провален запис: екранът се връща към старите транзакции, категориите от файла не се
  // добавят. Старите са в паметта — замяната в базата е една транзакция и при провал не променя нищо;
  // екранът се сменя преди записа, така че се връща, дори този запис също да не мине
  const handleCloseAfterFailedSave = () => {
    onImportReplace(replacePlan.previous);
    onClose();
  };

  // Докато тече записът, прозорецът не се затваря
  const handleClose = () => {
    if (saving) return;
    if (step === "saveFailed") handleCloseAfterFailedSave();
    else onClose();
  };

  if (step === "main" && mode === "export" && loading) {
    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm px-5 py-8 flex flex-col items-center gap-3">
          <p className="text-sm text-gray-400 animate-pulse">⏳ Генериране на файл...</p>
          <button
            onClick={onClose}
            className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
          >
            Затвори
          </button>
        </div>
      </div>
    );
  }

  if (step === "main" && mode === "export" && noDataMessage) {
    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
        <div className="bg-blue-50 rounded-2xl shadow-xl w-full max-w-sm px-5 py-6 flex flex-col items-center gap-3">
          <p className="text-sm text-red-500 bg-red-50 rounded-xl px-3 py-2 w-full text-center">
            Няма данни за експорт
          </p>
          <button
            onClick={onClose}
            className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
          >
            Затвори
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-blue-50 rounded-2xl shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-700">
            {mode === "export" ? "Експорт към Excel" : "Импорт от Excel"}
          </h2>
          <button
            onClick={handleClose}
            disabled={saving}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition disabled:opacity-40"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-3">
          {step === "main" && mode === "import" && (
            loading ? (
              <p className="text-sm text-center text-gray-400 animate-pulse py-2">⏳ Четене на файла…</p>
            ) : (
              <>
                <p className="text-sm text-gray-600">
                  Изберете Excel файл във формат .xlsx — например създаден чрез „Експорт към Excel“.
                </p>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-orange-500 text-white hover:bg-orange-600 transition"
                >
                  Избери файл
                </button>
                <button
                  onClick={onClose}
                  className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
                >
                  Откажи
                </button>
              </>
            )
          )}
          {step === "exportWarning" && (
            <>
              <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                <p className="text-sm text-red-700 font-bold mb-1">⚠️ Внимание — активен филтър!</p>
                <p className="text-sm text-red-600">
                  В момента е включен филтър. Excel файлът ще съдържа само филтрираните транзакции, не всички.
                </p>
              </div>
              {loading ? (
                <p className="text-sm text-center text-gray-400 animate-pulse py-2">⏳ Генериране на файл...</p>
              ) : (
              <button
                onClick={() => {
                  if (!filteredTransactions || filteredTransactions.length === 0) {
                    setStep("main");
                    setNoDataMessage(true);
                    return;
                  }
                  runExport(filteredTransactions, expenseCategories, incomeCategories, isFiltered, activeFilters?.categories || [], profileName);
                }}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-green-500 text-white hover:bg-green-600 transition"
              >
                Разбирам, експортирай само филтрираните
              </button>
              )}
              <button
                onClick={onClose}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
              >
                {loading ? "Затвори" : "Откажи"}
              </button>
            </>
          )}
          {step === "confirm" && pendingTransactions && (
            <>
              <div className="bg-orange-50 rounded-xl p-4">
                <p className="text-sm text-orange-700 font-medium mb-1">
                  ⚠️ Внимание!
                </p>
                <p className="text-sm text-orange-600">
                  Всички транзакции на профил „{profileName}“ ({transactions.length}) ще бъдат изтрити и заменени с {pendingTransactions.length} транзакции от файла.
                </p>
                {/* Какво е разпознато във файла — типът идва от знака на сумата (одит 2026-10, 5-4) */}
                {(() => {
                  const summary = importSummary(pendingTransactions);
                  return (
                    <div className="text-sm text-orange-700 mt-2 space-y-0.5">
                      <p>Разходи: {summary.expense.count} ({formatAmount(summary.expense.total)})</p>
                      <p>Приходи: {summary.income.count} ({formatAmount(summary.income.total)})</p>
                      <p>Период: {summary.from} – {summary.to}</p>
                    </div>
                  );
                })()}
                <p className="text-sm text-orange-600 mt-2">
                  Това действие не може да бъде отменено.
                </p>
              </div>

              <button
                onClick={handleConfirmReplace}
                disabled={saving}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-red-500 text-white hover:bg-red-600 transition disabled:opacity-40"
              >
                {saving ? "Записване…" : "Да, зареди новите данни"}
              </button>
              <button
                onClick={onClose}
                disabled={saving}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition disabled:opacity-40"
              >
                Откажи
              </button>
            </>
          )}

          {step === "saveFailed" && replacePlan && (
            <>
              <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                <p className="text-sm text-red-700 font-bold mb-1">⚠️ Грешка при запис</p>
                <p className="text-sm text-red-600">
                  Новите {replacePlan.prepared.length} транзакции не са записани — в паметта са останали старите {replacePlan.previous.length}. Най-честата причина е, че няма място на устройството. Освободете място и натиснете „Опитай пак“.
                </p>
              </div>
              <button
                onClick={() => saveReplace(replacePlan)}
                disabled={saving}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-red-500 text-white hover:bg-red-600 transition disabled:opacity-40"
              >
                {saving ? "Записване…" : "Опитай пак"}
              </button>
              <button
                onClick={handleCloseAfterFailedSave}
                disabled={saving}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition disabled:opacity-40"
              >
                Затвори
              </button>
            </>
          )}

          {step === "invalid" && (
            <>
              <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                <p className="text-sm text-red-700 font-bold mb-2">
                  ❌ Файлът не може да бъде зареден — {invalidRows.length === 1 ? "1 ред е невалиден" : `${invalidRows.length} реда са невалидни`}:
                </p>
                <ul className="text-sm text-red-600 space-y-1 max-h-60 overflow-y-auto">
                  {invalidRows.slice(0, INVALID_ROWS_SHOWN).map((r) => (
                    <li key={r.row}>– ред {r.row}: {r.reasons.join("; ")}</li>
                  ))}
                </ul>
                {invalidRows.length > INVALID_ROWS_SHOWN && (
                  <p className="text-sm text-red-600 mt-1">… и още {invalidRows.length - INVALID_ROWS_SHOWN}</p>
                )}
                <p className="text-sm text-red-600 mt-2">
                  Поправете ги във файла и опитайте отново. Данните ви не са променени.
                </p>
              </div>
              <button
                onClick={onClose}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
              >
                Затвори
              </button>
            </>
          )}

          {step === "error" && (
            <>
              <p className="text-sm text-red-500 bg-red-50 rounded-xl px-3 py-2">
                {error}
              </p>
              <button
                onClick={onClose}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
              >
                Затвори
              </button>
            </>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx"
          onChange={handleFileSelect}
          onClick={(e) => { e.target.value = ""; }}
          className="hidden"
        />
      </div>
    </div>
  );
};

export default ImportExportModal;