import { useState, useRef, useEffect } from "react";
import { X } from "lucide-react";
import { importFromExcel, exportToExcel, findDuplicates } from "../utils/excel";

const ImportExportModal = ({
  onClose,
  transactions,
  filteredTransactions,
  isFiltered,
  onImportAdd,
  onImportReplace,
  onCategoriesImported,
  mode,
  expenseCategories,
  incomeCategories,
}) => {
  const [step, setStep] = useState("main");
  const [pendingTransactions, setPendingTransactions] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (mode === "export") {
      exportToExcel(filteredTransactions, expenseCategories, incomeCategories);
      onClose();
    } else if (mode === "import") {
      fileInputRef.current.click();
    }
  }, []);

  const handleFileSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) { onClose(); return; }
    setLoading(true);
    setError("");
    try {
      const imported = await importFromExcel(file);
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

  const handleConfirmReplace = () => {
    onImportReplace(pendingTransactions);
    const newCategories = {
      expense: [...new Set(pendingTransactions.filter((t) => t.type === "expense").map((t) => t.category))],
      income: [...new Set(pendingTransactions.filter((t) => t.type === "income").map((t) => t.category))],
    };
    onCategoriesImported(newCategories);
    onClose();
  };

  if (step === "main" && mode === "import" && !error && !loading) {
    return (
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx"
        onChange={handleFileSelect}
        className="hidden"
      />
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-blue-50 rounded-2xl shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-700">
            Импорт от Excel
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-3">
          {step === "confirm" && pendingTransactions && (
            <>
              <div className="bg-orange-50 rounded-xl p-4">
                <p className="text-sm text-orange-700 font-medium mb-1">
                  ⚠️ Внимание!
                </p>
                <p className="text-sm text-orange-600">
                  Всички съществуващи данни ({transactions.length} транзакции) ще бъдат изтрити и заменени с {pendingTransactions.length} транзакции от файла.
                </p>
                <p className="text-sm text-orange-600 mt-2">
                  Това действие не може да бъде отменено.
                </p>
              </div>

              <button
                onClick={handleConfirmReplace}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-red-500 text-white hover:bg-red-600 transition"
              >
                Да, зареди новите данни
              </button>
              <button
                onClick={onClose}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
              >
                Откажи
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
          className="hidden"
        />
      </div>
    </div>
  );
};

export default ImportExportModal;