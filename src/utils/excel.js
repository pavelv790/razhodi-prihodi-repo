import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { assignOrderedIds } from "../hooks/useTransactions";
import { isValidDate } from "./formatters";

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

const applyCell = (cell, value, bgColor, opts = {}) => {
  cell.value = value ?? "";
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + bgColor } };
  cell.font = { name: "Calibri", size: opts.sz ?? 11, bold: opts.bold ?? false };
  cell.alignment = { horizontal: opts.align ?? "left", vertical: "middle" };
  cell.border = border;
  if (typeof value === "number") {
    cell.numFmt = "0.00";
  }
};

const applyFormulaCell = (cell, formula, bgColor) => {
  cell.value = { formula };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + bgColor } };
  cell.font = { name: "Calibri", size: 11, bold: false };
  cell.alignment = { horizontal: "right", vertical: "middle" };
  cell.border = border;
  cell.numFmt = "0.00";
};

const colLetter = (i) => {
  let s = "";
  i++;
  while (i > 0) {
    s = String.fromCharCode(((i - 1) % 26) + 65) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
};

const sanitizeFileName = (name) => (name || "").replace(/[\/\\:*?"<>|]/g, "-");

const saveWorkbook = async (workbook, filename) => {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

// Изпълнява task след 50 мс (да се покаже „Генериране…“); грешката му отхвърля промиса — иначе
// извикващият чака вечно (одит 2026-10, 5-5, 6-11)
const runAsync = (task) => new Promise((resolve, reject) => setTimeout(() => task().then(resolve, reject), 50));

export const exportToExcel = (
  transactions,
  expenseCategories,
  incomeCategories,
  isFiltered = false,
  filterCategories = [],
  profileName = ""
) => runAsync(async () => {
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

  // Категории, които има в подадените транзакции, но ги няма в списъка на профила (копирани от друг
  // профил, остатък от старо преименуване) — иначе отпадат от годишните листове, ОБЩО и БАЛАНС (одит 2026-10, 5-6)
  const withTransactionCategories = (listed, type) => [
    ...listed,
    ...[...new Set(transactions.filter((t) => t.type === type).map((t) => t.category))]
      .filter((c) => !listed.includes(c))
      .sort((a, b) => a.localeCompare(b, "bg")),
  ];

  const activeExpCats = withTransactionCategories(
    isFiltered && filterCategories.length > 0
      ? expenseCategories.filter((c) => filterCategories.includes(c + "::expense"))
      : expenseCategories,
    "expense",
  );
  const activeIncCats = withTransactionCategories(
    isFiltered && filterCategories.length > 0
      ? incomeCategories.filter((c) => filterCategories.includes(c + "::income"))
      : incomeCategories,
    "income",
  );

  const workbook = new ExcelJS.Workbook();

  const years = [...new Set(
    transactions.map((t) => Number(t.date.split("/")[2]))
  )].sort((a, b) => b - a);

  years.forEach((year) => {
    const ws = workbook.addWorksheet(String(year));
    let r = 1;

    const titleRow = (label) => {
      applyCell(ws.getCell("A" + r), label, COLOR.titleBg, { bold: true, sz: 16 });
      MONTH_NAMES.forEach((m, i) => {
        applyCell(ws.getCell(colLetter(i + 1) + r), m, COLOR.monthBg, { bold: true, align: "center" });
      });
      applyCell(ws.getCell(colLetter(13) + r), "СУМА", COLOR.sumColBg, { bold: true, align: "center" });
      r++;
    };

    const catRow = (cat, type) => {
      const bg = type === "expense" ? COLOR.expRowBg : COLOR.incRowBg;
      applyCell(ws.getCell("A" + r), cat, bg);
      for (let m = 1; m <= 12; m++) {
        const amt = getAmount(year, m, type, cat);
        applyCell(ws.getCell(colLetter(m) + r), amt || 0, COLOR.white, { align: "right" });
      }
      applyFormulaCell(ws.getCell(colLetter(13) + r), "SUM(B" + r + ":M" + r + ")", COLOR.sumNBg);
      r++;
    };

    const totalRow = (startR, endR) => {
      applyCell(ws.getCell("A" + r), "ОБЩО ЗА МЕСЕЦА", COLOR.totalBg);
      for (let m = 1; m <= 12; m++) {
        const cl = colLetter(m);
        const formula = startR <= endR ? "SUM(" + cl + startR + ":" + cl + endR + ")" : "0";
        applyFormulaCell(ws.getCell(cl + r), formula, COLOR.totalBg);
      }
      applyFormulaCell(ws.getCell(colLetter(13) + r), "SUM(B" + r + ":M" + r + ")", COLOR.totalBg);
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
    applyCell(ws.getCell("A" + r), "БАЛАНС", COLOR.titleBg, { bold: true, sz: 16 });
    MONTH_NAMES.forEach((m, i) => {
      applyCell(ws.getCell(colLetter(i + 1) + r), m, COLOR.monthBg, { bold: true, align: "center" });
    });
    applyCell(ws.getCell(colLetter(13) + r), "СУМА", COLOR.sumColBg, { bold: true, align: "center" });
    r++;

    applyCell(ws.getCell("A" + r), "", COLOR.titleBg);
    for (let m = 1; m <= 12; m++) {
      const inc = activeIncCats.reduce((s, cat) => s + getAmount(year, m, "income", cat), 0);
      const exp = activeExpCats.reduce((s, cat) => s + getAmount(year, m, "expense", cat), 0);
      const bal = inc - exp;
      const cl = colLetter(m);
      const balCell = ws.getCell(cl + r);
      balCell.value = { formula: cl + (incEnd + 1) + "-" + cl + (expEnd + 1) };
      balCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + (bal >= 0 ? "C6EFCE" : "FFC7CE") } };
      balCell.font = { name: "Calibri", size: 11, bold: false };
      balCell.alignment = { horizontal: "right", vertical: "middle" };
      balCell.border = border;
      balCell.numFmt = "0.00";
    }
    applyFormulaCell(ws.getCell(colLetter(13) + r), "SUM(B" + r + ":M" + r + ")", COLOR.sumNBg);
    r++;

    ws.mergeCells("A" + balanceHeaderRow + ":A" + (balanceHeaderRow + 1));

    const allCats = [...activeExpCats, ...activeIncCats, "ОБЩО ЗА МЕСЕЦА"];
    const maxLen = allCats.reduce((m, c) => Math.max(m, c.length), 0);
    ws.getColumn(1).width = Math.max(maxLen + 2, 20);
    MONTH_NAMES.forEach((m, i) => {
      ws.getColumn(i + 2).width = Math.max(m.length + 3, 10);
    });
    ws.getColumn(14).width = 14;
  });

  const wsH = workbook.addWorksheet("История на транзакциите");
  ["Категория", "Сума", "Дата", "Описание"].forEach((h, i) => {
    applyCell(wsH.getCell(colLetter(i) + "1"), h, COLOR.monthBg, { bold: true, align: "center" });
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
    applyCell(wsH.getCell("A" + rr), t.category, COLOR.white);
    applyCell(wsH.getCell("B" + rr), amt, COLOR.white, { align: "right" });
    applyCell(wsH.getCell("C" + rr), t.date, COLOR.white, { align: "center" });
    applyCell(wsH.getCell("D" + rr), t.description || "", COLOR.white);
    if (t.category.length > maxCatLen) maxCatLen = t.category.length;
    if ((t.description || "").length > maxDescLen) maxDescLen = (t.description || "").length;
  });

  wsH.getColumn(1).width = maxCatLen + 2;
  wsH.getColumn(2).width = 12;
  wsH.getColumn(3).width = 12;
  wsH.getColumn(4).width = maxDescLen + 2;

  const today = new Date();
  const d = String(today.getDate()).padStart(2, "0");
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const y = today.getFullYear();
  const profileSuffix = profileName ? `_${sanitizeFileName(profileName)}` : "";
  await saveWorkbook(workbook, "Разходи-Приходи" + profileSuffix + "_" + d + "." + m + "." + y + ".xlsx");
});

// Дата от клетка → "ДД/ММ/ГГГГ" или null. Приема Excel дата (число), ДД/ММ/ГГГГ, ДД.ММ.ГГГГ, ДД-ММ-ГГГГ
// (денят и месецът — с 1 или 2 цифри; денят винаги е първи) и ГГГГ-ММ-ДД; датата трябва да съществува
// (одит 2026-10, 5-2). Excel датата се смята в UTC — без местните отмествания от 1899 г. (5-18)
const parseImportDate = (value) => {
  let day, month, year;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 1) return null;
    const jsDate = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
    [day, month, year] = [jsDate.getUTCDate(), jsDate.getUTCMonth() + 1, jsDate.getUTCFullYear()];
  } else {
    const text = String(value ?? "").trim();
    const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    const dayFirst = text.match(/^(\d{1,2})([./-])(\d{1,2})\2(\d{4})$/);
    if (iso) [, year, month, day] = iso;
    else if (dayFirst) [, day, , month, year] = dayFirst;
    else return null;
  }
  const date = `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
  return isValidDate(date) ? date : null;
};

// Сума от клетка: число или текст с точка/запетая за десетичен знак и интервали между хилядите
// („-1 234,56“). Всичко друго („12 лв“) → NaN (одит 2026-10, 5-3)
const parseImportAmount = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  const text = String(value ?? "").replace(/[\s\u00A0\u202F]/g, "");
  if (!/^[-+]?\d+([.,]\d+)?$/.test(text)) return NaN;
  return Number(text.replace(",", "."));
};

const shortCellText = (value) => {
  const text = String(value).trim();
  return text.length > 30 ? text.slice(0, 30) + "…" : text;
};

// Връща { transactions, invalidRows: [{ row, reasons }] } — при невалидни редове нищо не се зарежда
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
        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: true });
        // Първият ред трябва да е заглавният — иначе първата транзакция би отпаднала мълчаливо (одит 2026-10, 5-3)
        const header = (rows[0] || []).slice(0, 3).map((c) => String(c ?? "").trim().toLowerCase());
        if (header.join("|") !== "категория|сума|дата") {
          reject(new Error("Първият ред на листа „История на транзакциите“ трябва да е заглавният: Категория | Сума | Дата | Описание. Изберете файл, експортиран от приложението."));
          return;
        }
        // Номерът на реда, както се вижда в Excel (листът може да не започва от ред 1)
        const firstRow = worksheet["!ref"] ? XLSX.utils.decode_range(worksheet["!ref"]).s.r + 1 : 1;
        const transactions = [];
        // Всеки ред се проверява; при невалиден ред импортът не се допуска (одит 2026-10, 5-2, 5-3)
        const invalidRows = [];
        rows.forEach((row, index) => {
          if (index === 0) return;
          const isEmpty = (v) => v === undefined || v === null || String(v).trim() === "";
          if (!row || row.slice(0, 4).every(isEmpty)) return;
          const category = String(row[0] ?? "").trim();
          const amount = parseImportAmount(row[1]);
          const date = parseImportDate(row[2]);
          const description = String(row[3] ?? "").trim();
          const reasons = [];
          if (!category) reasons.push("липсва категория");
          if (isEmpty(row[1])) reasons.push("липсва сума");
          else if (isNaN(amount)) reasons.push(`сумата „${shortCellText(row[1])}“ не е число`);
          else if (amount === 0) reasons.push("сумата е 0");
          if (isEmpty(row[2])) reasons.push("липсва дата");
          else if (!date) reasons.push(`невалидна дата „${shortCellText(row[2])}“`);
          if (reasons.length > 0) {
            invalidRows.push({ row: firstRow + index, reasons });
            return;
          }
          transactions.push({
            type: amount < 0 ? "expense" : "income",
            category, date, description,
            amount: Math.abs(amount),
          });
        });
        // Редът на листа (както е изнесен — най-новото отгоре) се пази и при равна дата (одит 2026-10, 2А-16)
        resolve({ transactions: assignOrderedIds(transactions), invalidRows });
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

export const exportMonthlyStatsToExcel = (transactions, rollingMonths = 12, profileName = "") => runAsync(async () => {
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

  const workbook = new ExcelJS.Workbook();

  years.forEach((year) => {
    const months = [];
    for (let m = 1; m <= 12; m++) {
      if (year < lastCompletedYear || (year === lastCompletedYear && m <= lastCompletedMonth))
        months.push(m);
    }
    if (months.length === 0) return;

    const ws = workbook.addWorksheet(String(year));
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

      applyCell(ws.getCell("A" + r), label, COLOR.titleBg, { bold: true, sz: 16 });
      months.forEach((m, i) => {
        applyCell(ws.getCell(colLetter(i + 1) + r), monthNames[m - 1], COLOR.monthBg, { bold: true, align: "center" });
      });
      applyCell(ws.getCell(colLetter(months.length + 1) + r), "СУМА", COLOR.sumColBg, { bold: true, align: "center" });
      r++;
      const catsStartR = r;

      cats.forEach((cat) => {
        applyCell(ws.getCell("A" + r), cat, rowBg);
        months.forEach((m, i) => {
          const avg = getRollingAverage(cat, type, year, m);
          applyCell(ws.getCell(colLetter(i + 1) + r), avg > 0 ? Math.round(avg * 100) / 100 : 0, COLOR.white, { align: "right" });
        });
        applyFormulaCell(ws.getCell(colLetter(months.length + 1) + r), "SUM(B" + r + ":" + colLetter(months.length) + r + ")", COLOR.sumNBg);
        r++;
      });

      applyCell(ws.getCell("A" + r), "ОБЩО", COLOR.totalBg, { bold: true });
      months.forEach((m, i) => {
        const cl = colLetter(i + 1);
        applyFormulaCell(ws.getCell(cl + r), "SUM(" + cl + catsStartR + ":" + cl + (r - 1) + ")", COLOR.totalBg);
      });
      applyFormulaCell(ws.getCell(colLetter(months.length + 1) + r), "SUM(B" + r + ":" + colLetter(months.length) + r + ")", COLOR.totalBg);
      r++;
      r++;
    });

    r++;
    const balanceHeaderRow = r;
    applyCell(ws.getCell("A" + r), "БАЛАНС", COLOR.titleBg, { bold: true, sz: 16 });
    months.forEach((m, i) => {
      applyCell(ws.getCell(colLetter(i + 1) + r), monthNames[m - 1], COLOR.monthBg, { bold: true, align: "center" });
    });
    applyCell(ws.getCell(colLetter(months.length + 1) + r), "СУМА", COLOR.sumColBg, { bold: true, align: "center" });
    r++;

    applyCell(ws.getCell("A" + r), "", COLOR.titleBg);
    months.forEach((m, i) => {
      const incAvg = getTotalRollingAverage("income", year, m);
      const expAvg = getTotalRollingAverage("expense", year, m);
      const balance = Math.round((incAvg - expAvg) * 100) / 100;
      applyCell(ws.getCell(colLetter(i + 1) + r), balance, balance >= 0 ? "C6EFCE" : "FFC7CE", { align: "right" });
    });
    applyFormulaCell(ws.getCell(colLetter(months.length + 1) + r), "SUM(B" + r + ":" + colLetter(months.length) + r + ")", COLOR.sumNBg);
    r++;

    ws.mergeCells("A" + balanceHeaderRow + ":A" + (balanceHeaderRow + 1));

    const allCats = [...new Set(transactions.map((t) => t.category)), "ОБЩО"];
    const maxLen = allCats.reduce((m, c) => Math.max(m, c.length), 0);
    ws.getColumn(1).width = Math.max(maxLen + 2, 20);
    months.forEach((m, i) => {
      ws.getColumn(i + 2).width = Math.max(monthNames[m - 1].length + 3, 10);
    });
    ws.getColumn(months.length + 2).width = 14;
  });

  const today = new Date();
  const d = String(today.getDate()).padStart(2, "0");
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const y = today.getFullYear();
  const profileSuffix = profileName ? `_${sanitizeFileName(profileName)}` : "";
  await saveWorkbook(workbook, "Месечна_Статистика" + profileSuffix + "_" + d + "." + m + "." + y + ".xlsx");
});