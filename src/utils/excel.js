import * as XLSX from "xlsx";
import { sortCategories } from "../constants/categories";

export const exportToExcel = (transactions, expenseCategories, incomeCategories) => {
  const expenseTransactions = transactions.filter((t) => t.type === "expense");
  const incomeTransactions = transactions.filter((t) => t.type === "income");

  const getCategoryTotal = (cat, catTransactions) =>
    catTransactions
      .filter((t) => t.category === cat)
      .reduce((sum, t) => sum + Number(t.amount), 0);

  const totalExpenses = expenseTransactions.reduce((sum, t) => sum + Number(t.amount), 0);
  const totalIncome = incomeTransactions.reduce((sum, t) => sum + Number(t.amount), 0);

  const maxRows = Math.max(expenseCategories.length, incomeCategories.length);
  const categoriesRows = [];

  categoriesRows.push(["РАЗХОДИ", "", "", "ПРИХОДИ", ""]);

  for (let i = 0; i < maxRows; i++) {
    const expCat = expenseCategories[i] || "";
    const incCat = incomeCategories[i] || "";
    const expTotal = expCat ? getCategoryTotal(expCat, expenseTransactions) : "";
    const incTotal = incCat ? getCategoryTotal(incCat, incomeTransactions) : "";
    categoriesRows.push([expCat, expCat ? expTotal : "", "", incCat, incCat ? incTotal : ""]);
  }

  categoriesRows.push(["", "", "", "", ""]);
  categoriesRows.push(["ОБЩО РАЗХОДИ", totalExpenses, "", "ОБЩО ПРИХОДИ", totalIncome]);
  categoriesRows.push(["БАЛАНС", totalIncome - totalExpenses, "", "", ""]);

  const ws1 = XLSX.utils.aoa_to_sheet(categoriesRows);
  ws1["!cols"] = [
    { wch: 42 },
    { wch: 14 },
    { wch: 4 },
    { wch: 42 },
    { wch: 14 },
  ];

  const historyRows = [];
  historyRows.push(["Категория", "Сума", "Дата", "Описание"]);

  const sortedTransactions = [...transactions].sort((a, b) => {
    const [dayA, monA, yearA] = a.date.split("/").map(Number);
    const [dayB, monB, yearB] = b.date.split("/").map(Number);
    return new Date(yearB, monB - 1, dayB) - new Date(yearA, monA - 1, dayA);
  });

  sortedTransactions.forEach((t) => {
    const amount = t.type === "expense" ? -Number(t.amount) : Number(t.amount);
    historyRows.push([t.category, amount, t.date, t.description || ""]);
  });

  const ws2 = XLSX.utils.aoa_to_sheet(historyRows);
  ws2["!cols"] = [
    { wch: 42 },
    { wch: 14 },
    { wch: 12 },
    { wch: 40 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, ws1, "Сума разходи по категории");
  XLSX.utils.book_append_sheet(workbook, ws2, "История на транзакциите");

  const today = new Date();
  const day = String(today.getDate()).padStart(2, "0");
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const year = today.getFullYear();

  XLSX.writeFile(workbook, `Разходи-Приходи_${day}.${month}.${year}.xlsx`);
};

export const importFromExcel = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: "array" });

        const historySheetName = workbook.SheetNames.find((name) =>
          name.includes("История")
        );

        if (!historySheetName) {
          reject(new Error("Файлът не съдържа лист 'История на транзакциите'. Моля използвайте файл експортиран от това приложение."));
          return;
        }

        const worksheet = workbook.Sheets[historySheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        const transactions = [];

        rows.slice(1).forEach((row) => {
          if (!row || row.length === 0) return;
          const category = String(row[0] || "").trim();
          const amount = Number(row[1]);
          const date = String(row[2] || "").trim();
          const description = String(row[3] || "").trim();

          if (!category || isNaN(amount) || amount === 0 || !date) return;

          transactions.push({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}-${transactions.length}`,
            type: amount < 0 ? "expense" : "income",
            category,
            date,
            description,
            amount: Math.abs(amount),
          });
        });

        resolve(transactions);
      } catch (err) {
        reject(new Error("Грешка при четене на файла: " + err.message));
      }
    };
    reader.onerror = () => reject(new Error("Грешка при отваряне на файла"));
    reader.readAsArrayBuffer(file);
  });
};

export const findDuplicates = (existing, incoming) => {
  const duplicates = [];
  const unique = [];

  incoming.forEach((newT) => {
    const isDuplicate = existing.some(
      (existT) =>
        existT.type === newT.type &&
        existT.category === newT.category &&
        existT.date === newT.date &&
        existT.description === newT.description &&
        Number(existT.amount) === Number(newT.amount)
    );
    if (isDuplicate) {
      duplicates.push(newT);
    } else {
      unique.push(newT);
    }
  });

  return { duplicates, unique };
};
export const exportMonthlyStatsToExcel = (transactions) => {
  const workbook = XLSX.utils.book_new();

  // Намираме всички години в транзакциите
  const years = [...new Set(transactions.map((t) => {
    const [, , y] = t.date.split("/").map(Number);
    return y;
  }))].sort();

  const monthNames = [
    "Януари", "Февруари", "Март", "Април", "Май", "Юни",
    "Юли", "Август", "Септември", "Октомври", "Ноември", "Декември"
  ];

  const now = new Date();
  const lastCompletedMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const getRollingAverage = (category, type, targetYear, targetMonth) => {
    // targetMonth е 1-базиран
    let total = 0;
    for (let i = 0; i < 12; i++) {
      let m = targetMonth - i;
      let y = targetYear;
      while (m <= 0) { m += 12; y--; }
      total += transactions
        .filter((t) => {
          if (t.type !== type || t.category !== category) return false;
          const [, tm, ty] = t.date.split("/").map(Number);
          return ty === y && tm === m;
        })
        .reduce((sum, t) => sum + Number(t.amount), 0);
    }
    return total / 12;
  };

  const getTotalRollingAverage = (type, targetYear, targetMonth) => {
    let total = 0;
    for (let i = 0; i < 12; i++) {
      let m = targetMonth - i;
      let y = targetYear;
      while (m <= 0) { m += 12; y--; }
      total += transactions
        .filter((t) => {
          if (t.type !== type) return false;
          const [, tm, ty] = t.date.split("/").map(Number);
          return ty === y && tm === m;
        })
        .reduce((sum, t) => sum + Number(t.amount), 0);
    }
    return total / 12;
  };

  years.forEach((year) => {
    const rows = [];

    ["expense", "income"].forEach((type) => {
      const label = type === "expense" ? "РАЗХОДИ" : "ПРИХОДИ";

      // Намираме категориите за тази година и тип
      const cats = [...new Set(transactions
        .filter((t) => {
          if (t.type !== type) return false;
          const [, , y] = t.date.split("/").map(Number);
          return y === year;
        })
        .map((t) => t.category)
      )].sort((a, b) => a.localeCompare(b, "bg", { sensitivity: "base" }));

      // Намираме месеците за тази година до последния завършен
      const months = [];
      for (let m = 1; m <= 12; m++) {
        const d = new Date(year, m - 1, 1);
        if (d <= lastCompletedMonth) months.push(m);
      }

      if (months.length === 0) return;

      // Хедър ред
      rows.push([label, "Категория", ...months.map((m) => monthNames[m - 1])]);

      // Редове за категории
      cats.forEach((cat) => {
        const values = months.map((m) => getRollingAverage(cat, type, year, m));
        rows.push(["", cat, ...values]);
      });

      // Общо ред
      const totalValues = months.map((m) => getTotalRollingAverage(type, year, m));
      rows.push(["", "ОБЩО", ...totalValues]);

      // Празен ред между разходи и приходи
      rows.push([]);
    });

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [
      { wch: 10 },
      { wch: 38 },
      ...Array(12).fill({ wch: 12 }),
    ];
    XLSX.utils.book_append_sheet(workbook, ws, String(year));
  });

  const today = new Date();
  const day = String(today.getDate()).padStart(2, "0");
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const year = today.getFullYear();

  XLSX.writeFile(workbook, `Месечна_Статистика_${day}.${month}.${year}.xlsx`);
};