// Какво ще изчезне или ще се промени на устройството при „Замести“ от резервно копие (одит 2026-10, 3-16).
// Сравнението е само за прозореца „Ще бъдат изтрити или променени данни“ — записът не зависи от него.

// dd/mm/yyyy → yyyymmdd за подреждане (най-новите първи)
const dateKey = (d) => (typeof d === "string" ? d.split("/").reverse().join("") : "");
const byDateDesc = (a, b) => dateKey(b.date).localeCompare(dateKey(a.date));

const cents = (v) => Math.round(Number(v) * 100);
const text = (v) => (typeof v === "string" ? v.trim() : "");

const sameTx = (a, b) =>
  a.type === b.type && a.category === b.category && a.date === b.date &&
  cents(a.amount) === cents(b.amount) && text(a.description) === text(b.description);
const txKey = (t) => [t.type, t.category, t.date, cents(t.amount), text(t.description)].join("|");
const txGroupKey = (t) => [t.type, t.category, t.date].join("|");

const groupBy = (list, key) => {
  const map = new Map();
  list.forEach((item) => {
    const k = key(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  });
  return map;
};

// Транзакции: при възстановяване получават нови id-та, затова id съвпада само за копие от същото
// устройство след последното му възстановяване. Ред на сравнението:
// 1) същият id — „Променена“, ако съдържанието е различно;
// 2) същото съдържание (дата, тип, категория, сума, описание) — една и съща;
// 3) в един ден с един тип и категория точно по една от двете страни — „Вероятно променена“;
// 4) останалите — „Ще изчезне“ (само на устройството) / „Ще се появи“ (само в копието).
export const diffTransactions = (local, backup) => {
  const changed = [];
  const backupById = new Map(backup.map((b) => [b.id, b]));
  const matched = new Set();
  const restLocal = [];
  local.forEach((l) => {
    const b = l.id != null ? backupById.get(l.id) : undefined;
    if (b && !matched.has(b)) {
      matched.add(b);
      if (!sameTx(l, b)) changed.push({ from: l, to: b, likely: false });
    } else {
      restLocal.push(l);
    }
  });

  const backupByKey = groupBy(backup.filter((b) => !matched.has(b)), txKey);
  const unmatchedLocal = restLocal.filter((l) => {
    const same = backupByKey.get(txKey(l));
    if (!same?.length) return true;
    same.pop();
    return false;
  });
  const unmatchedBackup = [...backupByKey.values()].flat();

  const localGroups = groupBy(unmatchedLocal, txGroupKey);
  const backupGroups = groupBy(unmatchedBackup, txGroupKey);
  const lost = [];
  const appearing = [];
  localGroups.forEach((ls, k) => {
    const bs = backupGroups.get(k);
    if (ls.length === 1 && bs?.length === 1) {
      changed.push({ from: ls[0], to: bs[0], likely: true });
      backupGroups.delete(k);
    } else {
      lost.push(...ls);
    }
  });
  backupGroups.forEach((bs) => appearing.push(...bs));

  return {
    lost: lost.sort(byDateDesc),
    appearing: appearing.sort(byDateDesc),
    changed: changed.sort((a, b) => byDateDesc(a.from, b.from)),
  };
};

// Повтарящи се и филтри: първо по id, после по ключа (същият като при „Обедини“).
// fields — полетата, които се сравняват; changed[].fields — кои от тях са различни
export const diffRecords = (local, backup, key, fields) => {
  const differentFields = (a, b) => fields.filter((f) => JSON.stringify(a[f] ?? null) !== JSON.stringify(b[f] ?? null));
  const backupById = new Map(backup.map((b) => [b.id, b]));
  const matched = new Set();
  const changed = [];
  const restLocal = [];
  local.forEach((l) => {
    const b = l.id != null ? backupById.get(l.id) : undefined;
    if (b && !matched.has(b)) {
      matched.add(b);
      const diff = differentFields(l, b);
      if (diff.length > 0) changed.push({ from: l, to: b, fields: diff });
    } else {
      restLocal.push(l);
    }
  });
  const backupByKey = groupBy(backup.filter((b) => !matched.has(b)), key);
  const lost = restLocal.filter((l) => {
    const same = backupByKey.get(key(l));
    if (!same?.length) return true;
    const b = same.pop();
    const diff = differentFields(l, b);
    if (diff.length > 0) changed.push({ from: l, to: b, fields: diff });
    return false;
  });
  return { lost, appearing: [...backupByKey.values()].flat(), changed };
};

// Категориите (без значение за главни/малки букви, както в addCategory)
export const diffCategories = (local, restored) => {
  const result = { lost: [], added: [] };
  ["expense", "income"].forEach((type) => {
    const localSet = new Set((local[type] || []).map((c) => c.toLowerCase()));
    const restoredSet = new Set((restored[type] || []).map((c) => c.toLowerCase()));
    (local[type] || []).forEach((c) => { if (!restoredSet.has(c.toLowerCase())) result.lost.push({ type, name: c }); });
    (restored[type] || []).forEach((c) => { if (!localSet.has(c.toLowerCase())) result.added.push({ type, name: c }); });
  });
  return result;
};

// Лимит: празен или нечислов — няма лимит (null)
const limitValue = (v) => (v === "" || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

// Бюджетите — общият лимит и лимитите по категория; периодът не се сравнява (копие от друг месец
// почти винаги има друг период — одит 2026-10, 4-14)
export const diffBudgets = (local, restored) => {
  const changes = [];
  const total = [limitValue(local?.totalLimit), limitValue(restored?.totalLimit)];
  if (total[0] !== total[1]) changes.push({ label: "Общ лимит", from: total[0], to: total[1] });
  const localLimits = local?.categoryLimits || {};
  const restoredLimits = restored?.categoryLimits || {};
  new Set([...Object.keys(localLimits), ...Object.keys(restoredLimits)]).forEach((cat) => {
    const from = limitValue(localLimits[cat]);
    const to = limitValue(restoredLimits[cat]);
    if (from !== to) changes.push({ label: cat, from, to });
  });
  return changes;
};

export const diffCurrency = (local, restored) => {
  if (!local || !restored) return null;
  const sameRate = Math.abs(Number(local.rate) - Number(restored.rate)) < 1e-9;
  return local.currency === restored.currency && sameRate ? null : { from: local, to: restored };
};

export const hasRestoreLoss = (r) =>
  r.transactions.lost.length > 0 || r.transactions.changed.length > 0 ||
  r.categories.lost.length > 0 || r.budgets.length > 0 || !!r.currency ||
  r.recurring.lost.length > 0 || r.recurring.changed.length > 0 ||
  r.filters.lost.length > 0 || r.filters.changed.length > 0;
