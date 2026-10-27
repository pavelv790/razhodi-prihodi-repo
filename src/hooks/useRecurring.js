import { useState, useEffect, useCallback } from "react";
import { runTx, replaceByProfile, reportDBError } from "../utils/db";
import { parseDate, getTodayString } from "../utils/formatters";

const STORE = "recurring";

// При грешка отхвърля: провалено четене не е „няма повтарящи се“ (одит 2026-10, 1А-04)
const loadByProfile = async (profileId) => {
  const all = (await runTx(STORE, "readonly", (store) => store.getAll())) || [];
  return all.filter((r) => r.profileId === profileId);
};

// Връщат true/false: списъкът в state се сменя само при успех (одит 2026-10, 7-10)
const saveOne = async (item) => {
  try {
    await runTx(STORE, "readwrite", (store) => store.put(item));
    return true;
  } catch (err) {
    reportDBError();
    console.error("Грешка при запис на повтаряща се транзакция", err);
    return false;
  }
};

const deleteOne = async (id) => {
  try {
    await runTx(STORE, "readwrite", (store) => store.delete(id));
    return true;
  } catch (err) {
    reportDBError();
    console.error("Грешка при изтриване на повтаряща се транзакция", err);
    return false;
  }
};

// При грешка отхвърля, за да спре изтриването на профила
const deleteByProfile = async (profileId) => {
  try {
    await replaceByProfile(STORE, profileId);
  } catch (err) {
    reportDBError();
    console.error("Грешка при изтриване на повтарящи се транзакции по профил", err);
    throw err;
  }
};

// Брой дни при „Персонализиран“: цяло число ≥ 1. Старите записи с дробно число (формата преди
// одит 2026-10, 4-11) се четат като цялата част — както и преди (setDate режеше до цяло)
export const getCustomDays = (item) => {
  const days = Math.floor(Number(item.customDays));
  return Number.isFinite(days) && days >= 1 ? days : 1;
};

const MAX_PENDING = 366; // най-много предложени дати наведнъж
const MAX_STEPS = 5000; // общ предпазител срещу безкраен цикъл

const daysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();

// Датата на стъпка № index от началото. Графикът винаги се смята от началната дата (не от
// предишната), затова деня го пази: 31-во число → последния ден на късите месеци, 29.02 → 28.02
// в невисокосна година и пак 29.02 във високосна (одит 2026-10, 4-10)
const getScheduleDate = (item, start, index) => {
  const y = start.getFullYear();
  const m = start.getMonth();
  const d = start.getDate();
  if (item.period === "weekly") return new Date(y, m, d + 7 * index);
  if (item.period === "monthly") {
    const monthIndex = m + index;
    const year = y + Math.floor(monthIndex / 12);
    const month = monthIndex % 12;
    return new Date(year, month, Math.min(d, daysInMonth(year, month)));
  }
  if (item.period === "yearly") return new Date(y + index, m, Math.min(d, daysInMonth(y + index, m)));
  if (item.period === "daily") return new Date(y, m, d + index);
  // custom — брой дни
  return new Date(y, m, d + getCustomDays(item) * index);
};

// От коя стъпка да се почне, за да не се минава през цялата история до lastAdded: стъпката, чиято дата
// е най-много до lastAdded (с една назад за сигурност). Предложените дати така и така са > lastAdded.
const getFirstStep = (item, start, last) => {
  if (!last || last <= start) return 0;
  let step;
  if (item.period === "monthly") {
    step = (last.getFullYear() - start.getFullYear()) * 12 + last.getMonth() - start.getMonth();
  } else if (item.period === "yearly") {
    step = last.getFullYear() - start.getFullYear();
  } else {
    const days = Math.round(
      (Date.UTC(last.getFullYear(), last.getMonth(), last.getDate()) -
        Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / 86400000
    );
    const size = item.period === "weekly" ? 7 : item.period === "daily" ? 1 : getCustomDays(item);
    step = Math.floor(days / size);
  }
  return Math.max(0, step - 1);
};

// Изчислява всички чакащи дати за дадена повтаряща се транзакция: датите от графика (от началната
// дата със същата стъпка), които са след lastAdded, не са след днес и не са след крайната дата.
// Смяната на началната дата мести графика; вече добавените периоди (≤ lastAdded) не се предлагат пак
// (одит 2026-10, 4-11 (б), вариант Б). Най-много MAX_PENDING наведнъж — останалите при следващото.
export const getPendingDates = (item, today) => {
  const todayDate = today || parseDate(getTodayString());
  const start = parseDate(item.startDate);
  if (!start || isNaN(start)) return [];
  const end = item.endDate ? parseDate(item.endDate) : null;
  const last = item.lastAdded ? parseDate(item.lastAdded) : null;

  const pending = [];
  let step = getFirstStep(item, start, last);
  for (let n = 0; n < MAX_STEPS && pending.length < MAX_PENDING; n++, step++) {
    const current = getScheduleDate(item, start, step);
    if (!(current <= todayDate)) break;
    if (end && current > end) break;
    if (!last || current > last) pending.push(formatDate(current));
  }
  return pending;
};

const formatDate = (date) => {
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
};

export const useRecurring = (profileId) => {
  const [recurringItems, setRecurringItems] = useState([]);
  // За кой профил е зареден списъкът. В рендера веднага след смяна на профил списъкът е още на
  // стария, затова isLoaded е false, докато не се зареди новият (одит 2026-10, 1А-02)
  const [loadedForProfile, setLoadedForProfile] = useState(null);
  const isLoaded = !!profileId && loadedForProfile === profileId;

  useEffect(() => {
    setRecurringItems([]);
    setLoadedForProfile(null);
    if (!profileId) return;
    let cancelled = false;
    loadByProfile(profileId).then((data) => {
      if (cancelled) return;
      setRecurringItems(data);
      setLoadedForProfile(profileId);
    }).catch((err) => {
      if (cancelled) return;
      // isLoaded остава false
      reportDBError();
      console.error("Грешка при зареждане на повтарящи се транзакции от IndexedDB", err);
    });
    return () => { cancelled = true; };
  }, [profileId]);

  // addRecurring / editRecurring / deleteRecurring връщат true/false и сменят списъка само при
  // успешен запис в базата (одит 2026-10, 7-10)
  const addRecurring = async (item) => {
    const newItem = {
      ...item,
      id: `recurring_${Date.now()}`,
      profileId,
      lastAdded: null,
    };
    if (!(await saveOne(newItem))) return false;
    setRecurringItems((prev) => [...prev, newItem]);
    return true;
  };

  const editRecurring = async (id, updates) => {
    const updated = recurringItems.map((r) =>
      r.id === id ? { ...r, ...updates } : r
    );
    const item = updated.find((r) => r.id === id);
    if (!(await saveOne(item))) return false;
    setRecurringItems(updated);
    return true;
  };

  const deleteRecurring = async (id) => {
    if (!(await deleteOne(id))) return false;
    setRecurringItems((prev) => prev.filter((r) => r.id !== id));
    return true;
  };

  // Чете записите от базата, а не от списъка на текущия рендер: така се маркира записът на профила,
  // за който е бил чакащият, със собствения му profileId (одит 2026-10, 1А-02).
  // datesById: { [id]: дата } — всички в ЕДНА транзакция, т.е. или всички, или нито един.
  // Връща true/false (одит 2026-10, 7-04).
  const markAsAdded = async (datesById) => {
    try {
      await runTx(STORE, "readwrite", (store) => {
        Object.entries(datesById).forEach(([id, date]) => {
          const req = store.get(id);
          req.onsuccess = () => {
            if (req.result) store.put({ ...req.result, lastAdded: date });
          };
        });
      });
    } catch (err) {
      reportDBError();
      console.error("Грешка при запис на повтаряща се транзакция", err);
      return false;
    }
    setRecurringItems((prev) =>
      prev.map((r) => (r.id in datesById ? { ...r, lastAdded: datesById[r.id] } : r))
    );
    return true;
  };

  const deleteAllByProfile = async (targetProfileId) => {
    await deleteByProfile(targetProfileId);
  };

  // Връща true/false — възстановяването спира при провал (одит 2026-10, 2А-01)
  const restoreRecurring = async (items, targetProfileId) => {
    try {
      const target = targetProfileId || profileId;
      const withProfile = items.map((r) => ({ ...r, profileId: target }));
      await replaceByProfile(STORE, target, withProfile);
      if (target === profileId) setRecurringItems(withProfile);
      return true;
    } catch (err) {
      reportDBError();
      console.error("Грешка при възстановяване от файл на повтарящи се транзакции", err);
      return false;
    }
  };

  // Изчислява всички чакащи транзакции за днес
  const getPendingTransactions = useCallback(() => {
    const today = parseDate(getTodayString());
    const pending = [];
    recurringItems.forEach((item) => {
      const dates = getPendingDates(item, today);
      dates.forEach((date) => {
        pending.push({
          recurringId: item.id,
          profileId: item.profileId,
          date,
          type: item.type,
          category: item.category,
          amount: item.amount,
          variableAmount: item.variableAmount || false,
          description: item.description || "",
        });
      });
    });
    return pending;
  }, [recurringItems]);

  return {
    recurringItems,
    isLoaded,
    addRecurring,
    editRecurring,
    deleteRecurring,
    markAsAdded,
    deleteAllByProfile,
    restoreRecurring,
    getPendingTransactions,
  };
};