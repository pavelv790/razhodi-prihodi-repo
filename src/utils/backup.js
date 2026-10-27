import { validCurrency } from "../hooks/useCurrency";

const sanitizeFileName = (name) => (name || "").replace(/[\/\\:*?"<>|]/g, "-");

// onlyProfile: копие само на активния профил от паметта, свалено при грешка в базата (одит 2026-10, 7-02)
export const exportBackup = (transactions, expenseCategories, incomeCategories, savedFilters, currency, rate, budgets, profiles, activeProfileId, recurringItems, profileName, allProfileCategories, profileCurrencies, profileBudgets, onlyProfile = false) => {
  const profileCategories = allProfileCategories || { [activeProfileId]: { expense: expenseCategories, income: incomeCategories } };
  const backup = {
    version: "1.6",
    date: new Date().toISOString(),
    ...(onlyProfile ? { onlyProfile: true } : {}),
    profiles,
    activeProfileId,
    transactions,
    expenseCategories,
    incomeCategories,
    profileCategories,
    savedFilters,
    currency,
    rate,
    budgets,
    profileCurrencies: profileCurrencies || {},
    profileBudgets: profileBudgets || {},
    recurringItems,
  };

  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const today = new Date();
  const day = String(today.getDate()).padStart(2, "0");
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const year = today.getFullYear();
  a.href = url;
  const profileSuffix = profileName ? `_${sanitizeFileName(profileName)}` : "";
  a.download = `Финанси_Backup${profileSuffix}_${day}.${month}.${year}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);
};

// Само чете JSON-а; проверката е във validateAndMigrateBackup (обща с облачните копия)
export const importBackup = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        resolve(JSON.parse(e.target.result));
      } catch {
        reject(new Error("Грешка при четене на файла."));
      }
    };
    reader.onerror = () => reject(new Error("Грешка при отваряне на файла."));
    reader.readAsText(file);
  });
};

const INVALID_BACKUP = "Резервното копие е невалидно или повредено. Възстановяването не започна.";
const EMPTY_BACKUP = "Резервното копие е празно — в него няма профили и транзакции. Възстановяването не започна.";
const LEGACY_PROFILE_ID = "profile_default_legacy";

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const stringList = (list) => list.filter((c) => typeof c === "string");

// Проверка и уеднаквяване на резервното копие преди възстановяване — обща за файл, Google Drive
// и Облака (одит 2026-10, 2А-06, 2А-20, 3-15). Хвърля с текст за потребителя, ако копието не става.
// Връща ново копие, в което: списъците са масиви от обекти, всеки профил има id и име,
// категориите на профил са пълни, валутите са валидни, а старото копие без профили има профил
// „По подразбиране“.
export const validateAndMigrateBackup = (raw) => {
  if (!isPlainObject(raw)
    || !Array.isArray(raw.transactions)
    || !Array.isArray(raw.expenseCategories)
    || !Array.isArray(raw.incomeCategories)) {
    throw new Error(INVALID_BACKUP);
  }
  // Незадължителен списък: липсва → остава липсващ (възстановяването тогава не го пипа)
  const optionalList = (value) => {
    if (value == null) return undefined;
    if (!Array.isArray(value)) throw new Error(INVALID_BACKUP);
    return value.filter(isPlainObject);
  };
  if (raw.profiles != null && !Array.isArray(raw.profiles)) throw new Error(INVALID_BACKUP);

  const expenseCategories = stringList(raw.expenseCategories);
  const incomeCategories = stringList(raw.incomeCategories);
  const data = {
    ...raw,
    transactions: raw.transactions.filter(isPlainObject),
    expenseCategories,
    incomeCategories,
    savedFilters: optionalList(raw.savedFilters),
    recurringItems: optionalList(raw.recurringItems),
  };

  const profiles = (raw.profiles || []).filter(isPlainObject);
  if (profiles.some((p) => typeof p.id !== "string" || !p.id)) throw new Error(INVALID_BACKUP);
  data.profiles = profiles.map((p) => (typeof p.name === "string" && p.name.trim() ? p : { ...p, name: "Без име" }));

  // Непълен запис за профил (напр. само expense) → липсващата част от общите категории (2А-20)
  if (isPlainObject(raw.profileCategories)) {
    const profileCategories = {};
    Object.entries(raw.profileCategories).forEach(([id, cats]) => {
      if (!isPlainObject(cats)) return;
      profileCategories[id] = {
        expense: Array.isArray(cats.expense) ? stringList(cats.expense) : expenseCategories,
        income: Array.isArray(cats.income) ? stringList(cats.income) : incomeCategories,
      };
    });
    data.profileCategories = profileCategories;
  } else {
    delete data.profileCategories;
  }

  // Валутата на неактивен профил се записва направо в базата — тук се проверява (както в useCurrency)
  if (isPlainObject(raw.profileCurrencies)) {
    const profileCurrencies = {};
    Object.entries(raw.profileCurrencies).forEach(([id, c]) => {
      if (isPlainObject(c)) profileCurrencies[id] = validCurrency(c.currency, c.rate);
    });
    data.profileCurrencies = profileCurrencies;
  } else {
    delete data.profileCurrencies;
  }
  if (raw.currency != null) {
    const valid = validCurrency(raw.currency, raw.rate);
    data.currency = valid.currency;
    data.rate = valid.rate;
  }

  if (isPlainObject(raw.profileBudgets)) {
    const profileBudgets = {};
    Object.entries(raw.profileBudgets).forEach(([id, b]) => {
      if (isPlainObject(b)) profileBudgets[id] = b;
    });
    data.profileBudgets = profileBudgets;
  } else {
    delete data.profileBudgets;
  }
  if (!isPlainObject(raw.budgets)) delete data.budgets;

  // Старо копие (без профили): всичко отива в един профил „По подразбиране“
  if (data.profiles.length === 0) {
    if (data.transactions.length === 0 && !data.recurringItems?.length && !data.savedFilters?.length) {
      throw new Error(EMPTY_BACKUP);
    }
    data.profiles = [{ id: LEGACY_PROFILE_ID, name: "По подразбиране", createdAt: new Date().toISOString() }];
    data.activeProfileId = LEGACY_PROFILE_ID;
    const toLegacy = (item) => ({ ...item, profileId: LEGACY_PROFILE_ID });
    data.transactions = data.transactions.map(toLegacy);
    if (data.savedFilters) data.savedFilters = data.savedFilters.map(toLegacy);
    if (data.recurringItems) data.recurringItems = data.recurringItems.map(toLegacy);
  }

  return data;
};
