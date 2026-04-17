import * as XLSX from "xlsx";

const MONTH_NAMES = [
  "януари", "февруари", "март", "април", "май", "юни",
  "юли", "август", "септември", "октомври", "ноември", "декември",
];

// Буква на колона по индекс (0=A, 1=B, ...)
const col = (i) => {
  let s = "";
  i++;
  while (i > 0) {
    s = String.fromCharCode(((i - 1) % 26) + 65) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
};

const getAmount = (transactions, year, month, type, category) =>
  transactions
    .filter((t) => {
      if (t.type !== type) return false;
      if (category !== null && t.category !== category) return false;
      const [, tm, ty] = t.date.split("/").map(Number);
      return ty === year && tm === month;
    })
    .reduce((sum, t) => sum + Number(t.amount), 0);

export const exportToExcel = (transactions, expenseCategories, incomeCategories, isFiltered = false, filterCategories = []) => {
  const MONTH_NAMES = [
    "януари", "февруари", "март", "април", "май", "юни",
    "юли", "август", "септември", "октомври", "ноември", "декември",
  ];

  // Буква на колона по индекс (0=A, 1=B, ...)
  const col = (i) => {
    let s = "";
    i++;
    while (i > 0) {
      s = String.fromCharCode(((i - 1) % 26) + 65) + s;
      i = Math.floor((i - 1) / 26);
    }
    return s;
  };

  const getAmount = (year, month, type, category) =>
    transactions
      .filter((t) => {
        if (t.type !== type || t.category !== category) return false;
        const [, tm, ty] = t.date.split("/").map(Number);
        return ty === year && tm === month;
      })
      .reduce((sum, t) => sum + Number(t.amount), 0);

  // Филтриране на категории
  const activeExpCats = (isFiltered && filterCategories.length > 0)
    ? expenseCategories.filter((c) => filterCategories.includes(c))
    : expenseCategories;
  const activeIncCats = (isFiltered && filterCategories.length > 0)
    ? incomeCategories.filter((c) => filterCategories.includes(c))
    : incomeCategories;

  const workbook = XLSX.utils.book_new();

  const years = [...new Set(
    transactions.map((t) => Number(t.date.split("/")[2]))
  )].sort();

  years.forEach((year) => {
    // Използваме aoa_to_sheet но формулите слагаме директно като обекти
    // за да избегнем апострофа

    const ws = XLSX.utils.book_new().Sheets; // само за да имаме референция
    // Всъщност ще строим worksheet ръчно с обекти

    const wsData = {};
    let currentRow = 1;

    const setCell = (r, c, value) => {
      const cellRef = col(c) + r;
      if (typeof value === "string" && value.startsWith("=")) {
        wsData[cellRef] = { t: "n", f: value.slice(1) };
      } else if (typeof value === "number") {
        wsData[cellRef] = { t: "n", v: value };
      } else if (value === null || value === undefined) {
        // пропускаме
      } else {
        wsData[cellRef] = { t: "s", v: String(value) };
      }
    };

    // ── РАЗХОДИ ──
    // Ред 1: хедър
    setCell(currentRow, 0, "");
    MONTH_NAMES.forEach((m, i) => setCell(currentRow, i + 1, m));
    setCell(currentRow, 13, "СУМАРНО");
    currentRow++;

    // Ред 2: РАЗХОДИ етикет
    setCell(currentRow, 0, "РАЗХОДИ");
    currentRow++;

    const expStartRow = currentRow;

    activeExpCats.forEach((cat) => {
      setCell(currentRow, 0, cat);
      for (let m = 1; m <= 12; m++) {
        const amount = getAmount(year, m, "expense", cat);
        setCell(currentRow, m, amount || 0);
      }
      // СУМАРНО за реда
      setCell(currentRow, 13, `=SUM(B${currentRow}:M${currentRow})`);
      currentRow++;
    });

    const expEndRow = currentRow - 1;

    // ОБЩО ЗА МЕСЕЦА — диапазонът е точно expStartRow:expEndRow
    setCell(currentRow, 0, "ОБЩО ЗА МЕСЕЦА");
    for (let m = 1; m <= 12; m++) {
      setCell(currentRow, m, `=SUM(${col(m)}${expStartRow}:${col(m)}${expEndRow})`);
    }
    setCell(currentRow, 13, `=SUM(B${currentRow}:M${currentRow})`);
    currentRow++;

    // Празен ред
    currentRow++;

    // ── ПРИХОДИ ──
    // Хедър ред с месеците
    setCell(currentRow, 0, "");
    MONTH_NAMES.forEach((m, i) => setCell(currentRow, i + 1, m));
    setCell(currentRow, 13, "СУМАРНО");
    currentRow++;

    // ПРИХОДИ етикет
    setCell(currentRow, 0, "ПРИХОДИ");
    currentRow++;

    const incStartRow = currentRow;

    activeIncCats.forEach((cat) => {
      setCell(currentRow, 0, cat);
      for (let m = 1; m <= 12; m++) {
        const amount = getAmount(year, m, "income", cat);
        setCell(currentRow, m, amount || 0);
      }
      setCell(currentRow, 13, `=SUM(B${currentRow}:M${currentRow})`);
      currentRow++;
    });

    const incEndRow = currentRow - 1;

    // ОБЩО ЗА МЕСЕЦА
    setCell(currentRow, 0, "ОБЩО ЗА МЕСЕЦА");
    for (let m = 1; m <= 12; m++) {
      setCell(currentRow, m, `=SUM(${col(m)}${incStartRow}:${col(m)}${incEndRow})`);
    }
    setCell(currentRow, 13, `=SUM(B${currentRow}:M${currentRow})`);
    currentRow++;

    // Задаваме диапазона на worksheet-а
    wsData["!ref"] = `A1:N${currentRow}`;
    wsData["!cols"] = [
      { wch: 42 },
      ...Array(12).fill({ wch: 12 }),
      { wch: 14 },
    ];

    XLSX.utils.book_append_sheet(workbook, wsData, String(year));
  });

  // Sheet: История на транзакциите
  const historyRows = [["Категория", "Сума", "Дата", "Описание"]];
  const sorted = [...transactions].sort((a, b) => {
    const [da, ma, ya] = a.date.split("/").map(Number);
    const [db, mb, yb] = b.date.split("/").map(Number);
    return new Date(yb, mb - 1, db) - new Date(ya, ma - 1, da);
  });
  sorted.forEach((t) => {
    const amount = t.type === "expense" ? -Number(t.amount) : Number(t.amount);
    historyRows.push([t.category, amount, t.date, t.description || ""]);
  });
  const wsHistory = XLSX.utils.aoa_to_sheet(historyRows);
  wsHistory["!cols"] = [{ wch: 42 }, { wch: 14 }, { wch: 12 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(workbook, wsHistory, "История на транзакциите");

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
    if (isDuplicate) duplicates.push(newT);
    else unique.push(newT);
  });

  return { duplicates, unique };
};

export const exportMonthlyStatsToExcel = (transactions, rollingMonths = 12) => {
  const workbook = XLSX.utils.book_new();

  const monthNames = [
    "Януари", "Февруари", "Март", "Април", "Май", "Юни",
    "Юли", "Август", "Септември", "Октомври", "Ноември", "Декември",
  ];

  const now = new Date();
  const lastCompletedYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const lastCompletedMonth = now.getMonth() === 0 ? 12 : now.getMonth();

  const getRollingAverage = (category, type, targetYear, targetMonth) => {
    let total = 0;
    for (let i = 0; i < rollingMonths; i++) {
      let m = targetMonth - i;
      let y = targetYear;
      while (m <= 0) { m += 12; y--; }
      total += transactions
        .filter((t) => {
          if (t.type !== type || t.category !== category) return false;
          const [, tm, ty] = t.date.split("/").map(Number);
          return ty === y && tm === m;
        })
        .reduce((s, t) => s + Number(t.amount), 0);
    }
    return total / rollingMonths;
  };

  const getTotalRollingAverage = (type, targetYear, targetMonth) => {
    let total = 0;
    for (let i = 0; i < rollingMonths; i++) {
      let m = targetMonth - i;
      let y = targetYear;
      while (m <= 0) { m += 12; y--; }
      total += transactions
        .filter((t) => {
          if (t.type !== type) return false;
          const [, tm, ty] = t.date.split("/").map(Number);
          return ty === y && tm === m;
        })
        .reduce((s, t) => s + Number(t.amount), 0);
    }
    return total / rollingMonths;
  };

  const years = [...new Set(
    transactions.map((t) => Number(t.date.split("/")[2]))
  )].sort();

  years.forEach((year) => {
    const months = [];
    for (let m = 1; m <= 12; m++) {
      if (
        year < lastCompletedYear ||
        (year === lastCompletedYear && m <= lastCompletedMonth)
      ) {
        months.push(m);
      }
    }
    if (months.length === 0) return;

    const rows = [];

    ["expense", "income"].forEach((type) => {
      const label = type === "expense" ? "РАЗХОДИ" : "ПРИХОДИ";

      const cats = [...new Set(
        transactions
          .filter((t) => {
            if (t.type !== type) return false;
            const [, , ty] = t.date.split("/").map(Number);
            return ty === year;
          })
          .map((t) => t.category)
      )].sort((a, b) => a.localeCompare(b, "bg", { sensitivity: "base" }));

      rows.push([label, "Категория", ...months.map((m) => monthNames[m - 1])]);

      cats.forEach((cat) => {
        const values = months.map((m) => {
          const avg = getRollingAverage(cat, type, year, m);
          return avg > 0 ? Math.round(avg * 100) / 100 : 0;
        });
        rows.push(["", cat, ...values]);
      });

      const totalValues = months.map((m) => {
        const avg = getTotalRollingAverage(type, year, m);
        return avg > 0 ? Math.round(avg * 100) / 100 : 0;
      });
      rows.push(["", "ОБЩО", ...totalValues]);
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