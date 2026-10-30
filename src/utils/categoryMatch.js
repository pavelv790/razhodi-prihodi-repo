// Свързване на входящи категории (импорт от Excel, „Обедини“, „Копирай от друг профил“) със съществуващите
// без значение на главни/малки букви — както addCategory/editCategory (одит 2026-10, 1А-16).
const keyOf = (name) => name.trim().toLowerCase();

// Съществуващият списък не се променя (със съществуващото изписване). От входящите се добавят само
// категориите, които ги няма — между самите входящи първата срещната печели.
// Връща { added, resolve }: added — новите имена (подрязани); resolve(name) — изписването в списъка
// за дадено име (или самото име, ако е извън списъка и извън входящите).
export const linkCategories = (existing, incoming) => {
  const byKey = new Map();
  existing.forEach((c) => {
    if (typeof c !== "string") return;
    const key = keyOf(c);
    if (!byKey.has(key)) byKey.set(key, c);
  });
  const added = [];
  incoming.forEach((c) => {
    if (typeof c !== "string") return;
    const trimmed = c.trim();
    if (!trimmed) return;
    const key = keyOf(trimmed);
    if (byKey.has(key)) return;
    byKey.set(key, trimmed);
    added.push(trimmed);
  });
  const resolve = (name) => (typeof name === "string" ? byKey.get(keyOf(name)) ?? name : name);
  return { added, resolve };
};

export const mergeCategoryLists = (existing, incoming) => [...existing, ...linkCategories(existing, incoming).added];

// Записва категорията на всяка транзакция с изписването от списъка за нейния тип.
// resolvers: { expense: resolve, income: resolve } от linkCategories.
export const applyCategorySpelling = (transactions, resolvers) =>
  transactions.map((t) => {
    const category = resolvers[t.type]?.(t.category);
    return category === undefined || category === t.category ? t : { ...t, category };
  });

// Една и съща категория без значение на главни/малки букви (проверка за дубликати)
export const sameCategory = (a, b) =>
  typeof a === "string" && typeof b === "string" ? keyOf(a) === keyOf(b) : a === b;
