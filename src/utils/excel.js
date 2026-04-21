import XLSXStyle from "xlsx-js-style";
import * as XLSX from "xlsx";

const COLOR = {
  titleBg:  "FFFF00",
  monthBg:  "D7E4BD",
  sumColBg: "8EACDC",
  expRowBg: "FCD5B5",
  incRowBg: "F8CDAC",
  sumNBg:   "DEEBF6",
  totalBg:  "DEE7E5",
  white:    "FFFFFF",
};

const border = {
  top:    { style: "thin" },
  bottom: { style: "thin" },
  left:   { style: "thin" },
  right:  { style: "thin" },
};

const numFmt = "0.00";

const colLetter = (i) => {
  let s = "";
  i++;
  while (i > 0) {
    s = String.fromCharCode(((i - 1) % 26) + 65) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
};

const cell = (value, bgColor, opts = {}) => ({
  v: value ?? "",
  t: typeof value === "number" ? "n" : "s",
  s: {
    fill:      { fgColor: { rgb: bgColor } },
    font:      { name: "Calibri", sz: opts.sz ?? 11, bold: opts.bold ?? false },
    alignment: { horizontal: opts.align ?? "left", vertical: "center" },
    border,
    ...(typeof value === "number" ? { numFmt } : {}),
  },
});

const fCell = (formula, bgColor) => ({
  f: formula,
  t: "n",
  s: {
    fill:      { fgColor: { rgb: bgColor } },
    font:      { name: "Calibri", sz: 11, bold: false },
    alignment: { horizontal: "right", vertical: "center" },
    border,
    numFmt,
  },
});

export const exportToExcel = (
  transactions,
  expenseCategories,
  incomeCategories,
  isFiltered = false,
  filterCategories = []
) => {
  const MONTH_NAMES = [
    "януари","февруари","март","април","май","юни",
    "юли","август","септември","октомври","ноември","декември",
  ];

  const getAmount = (year, month, type, category) =>
    transactions
      .filter((t) => {
        if (t.type !== type || t.category !== category) return false;
        const [, tm, ty] = t.date.split("/").map(Number);
        return ty === year && tm === month;
      })
      .reduce((sum, t) => sum + Number(t.amount), 0);

  const activeExpCats = isFiltered && filterCategories.length > 0
    ? expenseCategories.filter((c) => filterCategories.includes(c))
    : expenseCategories;
  const activeIncCats = isFiltered && filterCategories.length > 0
    ? incomeCategories.filter((c) => filterCategories.includes(c))
    : incomeCategories;

  const workbook = XLSXStyle.utils.book_new();

  const years = [...new Set(
    transactions.map((t) => Number(t.date.split("/")[2]))
  )].sort((a, b) => b - a);

  years.forEach((year) => {
    const ws = {};
    let r = 1;

    const titleRow = (label) => {
      ws["A" + r] = cell(label, COLOR.titleBg, { bold: true, sz: 16 });
      MONTH_NAMES.forEach((m, i) => {
        ws[colLetter(i + 1) + r] = cell(m, COLOR.monthBg, { bold: true, align: "center" });
      });
      ws[colLetter(13) + r] = cell("СУМА", COLOR.sumColBg, { bold: true, align: "center" });
      r++;
    };

    const catRow = (cat, type) => {
      const bg = type === "expense" ? COLOR.expRowBg : COLOR.incRowBg;
      ws["A" + r] = cell(cat, bg);
      for (let m = 1; m <= 12; m++) {
        const amt = getAmount(year, m, type, cat);
        ws[colLetter(m) + r] = cell(amt || 0, COLOR.white, { align: "right" });
      }
      ws[colLetter(13) + r] = fCell("SUM(B" + r + ":M" + r + ")", COLOR.sumNBg);
      r++;
    };

    const totalRow = (startR, endR) => {
      ws["A" + r] = cell("ОБЩО ЗА МЕСЕЦА", COLOR.totalBg);
      for (let m = 1; m <= 12; m++) {
        const cl = colLetter(m);
        ws[cl + r] = fCell("SUM(" + cl + startR + ":" + cl + endR + ")", COLOR.totalBg);
      }
      ws[colLetter(13) + r] = fCell("SUM(B" + r + ":M" + r + ")", COLOR.totalBg);
      r++;
    };

    titleRow("РАЗХОДИ");
    const expStart = r;
    activeExpCats.forEach((cat) => catRow(cat, "expense"));
    const expEnd = r - 1;
    totalRow(expStart, expEnd);

    r++;

    titleRow("ПРИХОДИ");
    const incStart = r;
    activeIncCats.forEach((cat) => catRow(cat, "income"));
    const incEnd = r - 1;
    totalRow(incStart, incEnd);

    r++;

    const balanceHeaderRow = r;
    ws["A" + r] = cell("БАЛАНС", COLOR.titleBg, { bold: true, sz: 16 });
    MONTH_NAMES.forEach((m, i) => {
      ws[colLetter(i + 1) + r] = cell(m, COLOR.monthBg, { bold: true, align: "center" });
    });
    ws[colLetter(13) + r] = cell("СУМА", COLOR.sumColBg, { bold: true, align: "center" });
    r++;

    ws["A" + r] = cell("", COLOR.titleBg);
    for (let m = 1; m <= 12; m++) {
      const inc = activeIncCats.reduce((s, cat) => s + getAmount(year, m, "income", cat), 0);
      const exp = activeExpCats.reduce((s, cat) => s + getAmount(year, m, "expense", cat), 0);
      const bal = inc - exp;
      const cl = colLetter(m);
      ws[cl + r] = {
        f: cl + (incEnd + 1) + "-" + cl + (expEnd + 1),
        t: "n",
        s: {
          fill: { fgColor: { rgb: bal >= 0 ? "C6EFCE" : "FFC7CE" } },
          font: { name: "Calibri", sz: 11, bold: false },
          alignment: { horizontal: "right", vertical: "center" },
          border,
          numFmt,
        },
      };
    }
    ws[colLetter(13) + r] = fCell("SUM(B" + r + ":M" + r + ")", COLOR.sumNBg);
    r++;

    ws["!ref"] = "A1:N" + r;
    ws["!merges"] = [{ s: { r: balanceHeaderRow - 1, c: 0 }, e: { r: balanceHeaderRow, c: 0 } }];

    const allCats = [...activeExpCats, ...activeIncCats, "ОБЩО ЗА МЕСЕЦА"];
    const maxLen = allCats.reduce((m, c) => Math.max(m, c.length), 0);
    ws["!cols"] = [
      { wch: Math.max(maxLen + 2, 20) },
      ...MONTH_NAMES.map((m) => ({ wch: Math.max(m.length + 3, 10) })),
      { wch: 14 },
    ];

    XLSXStyle.utils.book_append_sheet(workbook, ws, String(year));
  });

  const wsH = {};
  ["Категория", "Сума", "Дата", "Описание"].forEach((h, i) => {
    wsH[colLetter(i) + "1"] = cell(h, COLOR.monthBg, { bold: true, align: "center" });
  });

  const sorted = [...transactions].sort((a, b) => {
    const [da, ma, ya] = a.date.split("/").map(Number);
    const [db, mb, yb] = b.date.split("/").map(Number);
    return new Date(yb, mb - 1, db) - new Date(ya, ma - 1, da);
  });

  let maxCatLen = 10, maxDescLen = 10;
  sorted.forEach((t, idx) => {
    const rr = idx + 2;
    const amt = t.type === "expense" ? -Number(t.amount) : Number(t.amount);
    wsH["A" + rr] = cell(t.category, COLOR.white);
    wsH["B" + rr] = cell(amt, COLOR.white, { align: "right" });
    wsH["C" + rr] = cell(t.date, COLOR.white, { align: "center" });
    wsH["D" + rr] = cell(t.description || "", COLOR.white);
    if (t.category.length > maxCatLen) maxCatLen = t.category.length;
    if ((t.description || "").length > maxDescLen) maxDescLen = (t.description || "").length;
  });

  wsH["!ref"]  = "A1:D" + (sorted.length + 1);
  wsH["!cols"] = [
    { wch: maxCatLen + 2 },
    { wch: 12 },
    { wch: 12 },
    { wch: maxDescLen + 2 },
  ];

  XLSXStyle.utils.book_append_sheet(workbook, wsH, "История на транзакциите");

  const today = new Date();
  const d = String(today.getDate()).padStart(2, "0");
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const y = today.getFullYear();
  XLSXStyle.writeFile(workbook, "Разходи-Приходи_" + d + "." + m + "." + y + ".xlsx");
};

export const importFromExcel = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: "array" });
        const historySheetName = workbook.SheetNames.find((name) => name.includes("История"));
        if (!historySheetName) {
          reject(new Error("Файлът не съдържа лист 'История на транзакциите'."));
          return;
        }
        const worksheet = workbook.Sheets[historySheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        const transactions = [];
        rows.slice(1).forEach((row) => {
          if (!row || row.length === 0) return;
          const category    = String(row[0] || "").trim();
          const amount      = Number(row[1]);
          const date        = String(row[2] || "").trim();
          const description = String(row[3] || "").trim();
          if (!category || isNaN(amount) || amount === 0 || !date) return;
          transactions.push({
            id: Date.now() + "-" + Math.random().toString(36).slice(2, 9) + "-" + transactions.length,
            type: amount < 0 ? "expense" : "income",
            category, date, description,
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
  const monthNames = [
    "Януари","Февруари","Март","Април","Май","Юни",
    "Юли","Август","Септември","Октомври","Ноември","Декември",
  ];
  const now = new Date();
  const lastCompletedYear  = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const lastCompletedMonth = now.getMonth() === 0 ? 12 : now.getMonth();

  const getRollingAverage = (category, type, targetYear, targetMonth) => {
    let total = 0;
    for (let i = 0; i < rollingMonths; i++) {
      let mo = targetMonth - i, yr = targetYear;
      while (mo <= 0) { mo += 12; yr--; }
      total += transactions
        .filter((t) => {
          if (t.type !== type || t.category !== category) return false;
          const [, tm, ty] = t.date.split("/").map(Number);
          return ty === yr && tm === mo;
        })
        .reduce((s, t) => s + Number(t.amount), 0);
    }
    return total / rollingMonths;
  };

  const getTotalRollingAverage = (type, targetYear, targetMonth) => {
    let total = 0;
    for (let i = 0; i < rollingMonths; i++) {
      let mo = targetMonth - i, yr = targetYear;
      while (mo <= 0) { mo += 12; yr--; }
      total += transactions
        .filter((t) => {
          if (t.type !== type) return false;
          const [, tm, ty] = t.date.split("/").map(Number);
          return ty === yr && tm === mo;
        })
        .reduce((s, t) => s + Number(t.amount), 0);
    }
    return total / rollingMonths;
  };

  const years = [...new Set(transactions.map((t) => Number(t.date.split("/")[2])))].sort((a, b) => b - a);

  const workbook = XLSXStyle.utils.book_new();

  years.forEach((year) => {
    const months = [];
    for (let m = 1; m <= 12; m++) {
      if (year < lastCompletedYear || (year === lastCompletedYear && m <= lastCompletedMonth))
        months.push(m);
    }
    if (months.length === 0) return;

    const ws = {};
    let r = 1;

    ["expense", "income"].forEach((type) => {
      const label = type === "expense" ? "РАЗХОДИ" : "ПРИХОДИ";
      const rowBg = type === "expense" ? COLOR.expRowBg : COLOR.incRowBg;

      const cats = [...new Set(
        transactions
          .filter((t) => {
            if (t.type !== type) return false;
            const [,,ty] = t.date.split("/").map(Number);
            return ty === year;
          })
          .map((t) => t.category)
      )].sort((a, b) => a.localeCompare(b, "bg", { sensitivity: "base" }));

      ws["A" + r] = cell(label, COLOR.titleBg, { bold: true, sz: 16 });
      months.forEach((m, i) => {
        ws[colLetter(i + 1) + r] = cell(monthNames[m - 1], COLOR.monthBg, { bold: true, align: "center" });
      });
      ws[colLetter(months.length + 1) + r] = cell("СУМА", COLOR.sumColBg, { bold: true, align: "center" });
      r++;
      const catsStartR = r;

      cats.forEach((cat) => {
        ws["A" + r] = cell(cat, rowBg);
        months.forEach((m, i) => {
          const avg = getRollingAverage(cat, type, year, m);
          ws[colLetter(i + 1) + r] = cell(avg > 0 ? Math.round(avg * 100) / 100 : 0, COLOR.white, { align: "right" });
        });
        ws[colLetter(months.length + 1) + r] = fCell("SUM(B" + r + ":" + colLetter(months.length) + r + ")", COLOR.sumNBg);
        r++;
      });

      ws["A" + r] = cell("ОБЩО", COLOR.totalBg, { bold: true });
      months.forEach((m, i) => {
        const cl = colLetter(i + 1);
        ws[cl + r] = fCell("SUM(" + cl + catsStartR + ":" + cl + (r - 1) + ")", COLOR.totalBg);
      });
      ws[colLetter(months.length + 1) + r] = fCell("SUM(B" + r + ":" + colLetter(months.length) + r + ")", COLOR.totalBg);
      r++;
      r++;
    });

    r++;
    const balanceHeaderRow = r;
    ws["A" + r] = cell("БАЛАНС", COLOR.titleBg, { bold: true, sz: 16 });
    months.forEach((m, i) => {
      ws[colLetter(i + 1) + r] = cell(monthNames[m - 1], COLOR.monthBg, { bold: true, align: "center" });
    });
    ws[colLetter(months.length + 1) + r] = cell("СУМА", COLOR.sumColBg, { bold: true, align: "center" });
    r++;

    ws["A" + r] = cell("", COLOR.titleBg);
    months.forEach((m, i) => {
      const incAvg = getTotalRollingAverage("income", year, m);
      const expAvg = getTotalRollingAverage("expense", year, m);
      const balance = Math.round((incAvg - expAvg) * 100) / 100;
      ws[colLetter(i + 1) + r] = cell(balance, balance >= 0 ? "C6EFCE" : "FFC7CE", { align: "right" });
    });
    ws[colLetter(months.length + 1) + r] = fCell("SUM(B" + r + ":" + colLetter(months.length) + r + ")", COLOR.sumNBg);
    r++;

    ws["!merges"] = [{ s: { r: balanceHeaderRow - 1, c: 0 }, e: { r: balanceHeaderRow, c: 0 } }];
    ws["!ref"] = "A1:" + colLetter(months.length + 1) + r;

    const allCats = [...new Set(transactions.map((t) => t.category)), "ОБЩО"];
    const maxLen = allCats.reduce((m, c) => Math.max(m, c.length), 0);
    ws["!cols"] = [
      { wch: Math.max(maxLen + 2, 20) },
      ...months.map((m) => ({ wch: Math.max(monthNames[m - 1].length + 3, 10) })),
      { wch: 14 },
    ];

    XLSXStyle.utils.book_append_sheet(workbook, ws, String(year));
  });

  const today = new Date();
  const d = String(today.getDate()).padStart(2, "0");
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const y = today.getFullYear();
  XLSXStyle.writeFile(workbook, "Месечна_Статистика_" + d + "." + m + "." + y + ".xlsx");
};