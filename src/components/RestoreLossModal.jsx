import { useState } from "react";
import { formatAmount, formatDate } from "../utils/formatters";

// Прозорец преди „Замести“ при възстановяване, когато нещо на устройството ще изчезне или ще се
// промени (одит 2026-10, 3-16). report — по един запис за всеки профил със „Замести“ (виж restoreDiff.js)

const PAGE = 50;

const TYPE_LABEL = { expense: "Разход", income: "Приход" };
const PERIOD_LABEL = { daily: "Всеки ден", weekly: "Всяка седмица", monthly: "Всеки месец", yearly: "Всяка година", custom: "Персонализиран" };
const RECURRING_FIELD_LABEL = {
  type: "Тип", category: "Категория", amount: "Сума", variableAmount: "Променлива сума", description: "Описание",
  startDate: "Начална дата", endDate: "Крайна дата", period: "Период", customDays: "Брой дни", lastAdded: "Последно добавяне",
};
const FILTER_FIELD_LABEL = { name: "Име", fromDate: "От дата", toDate: "До дата", categories: "Категории", description: "Описание" };

const eur = (v) => `${formatAmount(Number(v) || 0)} EUR`;
const limit = (v) => (v == null ? "няма лимит" : eur(v));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const fieldValue = (field, v) => {
  if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) return "—";
  if (typeof v === "boolean") return v ? "да" : "не";
  if (field === "amount") return eur(v);
  if (field === "type") return TYPE_LABEL[v] || v;
  if (field === "period") return PERIOD_LABEL[v] || v;
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
};

const txLine = (t) => [
  formatDate(t.date),
  t.category,
  `${t.type === "income" ? "+" : "−"}${eur(t.amount)}`,
  t.description ? `„${t.description}“` : null,
].filter(Boolean).join(" · ");

// Транзакциите на промяната: показват се само различните части
const txChange = ({ from, to }) => {
  const parts = [];
  if (from.date !== to.date) parts.push(`${formatDate(from.date)} → ${formatDate(to.date)}`);
  if (from.type !== to.type) parts.push(`${TYPE_LABEL[from.type]} → ${TYPE_LABEL[to.type]}`);
  if (from.category !== to.category) parts.push(`${from.category} → ${to.category}`);
  if (Math.round(Number(from.amount) * 100) !== Math.round(Number(to.amount) * 100)) parts.push(`${eur(from.amount)} → ${eur(to.amount)}`);
  if ((from.description || "").trim() !== (to.description || "").trim()) parts.push(`„${from.description || ""}“ → „${to.description || ""}“`);
  return parts.join(" · ");
};

const summaryLines = (r) => {
  const lines = [];
  const t = r.transactions;
  const txParts = [];
  if (t.lost.length) txParts.push(plural(t.lost.length, "изчезва", "изчезват"));
  if (t.changed.length) txParts.push(plural(t.changed.length, "е променена", "са променени"));
  if (txParts.length && t.appearing.length) txParts.push(plural(t.appearing.length, "се появява", "се появяват"));
  if (txParts.length) lines.push(`Транзакции: ${txParts.join(", ")}`);
  if (r.categories.lost.length) {
    lines.push(`Категории: ${r.categories.lost.length === 1 ? "изчезва" : "изчезват"} ${r.categories.lost.map((c) => `„${c.name}“`).join(", ")}`);
  }
  if (r.budgets.length) lines.push(`Бюджет: ${r.budgets.map((b) => `${b.label} ${limit(b.from)} → ${limit(b.to)}`).join("; ")}`);
  if (r.currency) lines.push(`Валута: ${r.currency.from.currency} (курс ${r.currency.from.rate}) → ${r.currency.to.currency} (курс ${r.currency.to.rate})`);
  const recParts = [];
  if (r.recurring.lost.length) recParts.push(`${r.recurring.lost.length === 1 ? "изчезва" : "изчезват"} ${r.recurring.lost.map((x) => `„${x.description || x.category}“`).join(", ")}`);
  if (r.recurring.changed.length) recParts.push(`${plural(r.recurring.changed.length, "е променена", "са променени")}`);
  if (recParts.length) lines.push(`Повтарящи се: ${recParts.join(", ")}`);
  const filParts = [];
  if (r.filters.lost.length) filParts.push(`${r.filters.lost.length === 1 ? "изчезва" : "изчезват"} ${r.filters.lost.map((f) => `„${f.name}“`).join(", ")}`);
  if (r.filters.changed.length) filParts.push(`${plural(r.filters.changed.length, "е променен", "са променени")}`);
  if (filParts.length) lines.push(`Запазени филтри: ${filParts.join(", ")}`);
  return lines;
};

const restoreDiffCount = (r) =>
  r.transactions.lost.length + r.transactions.appearing.length + r.transactions.changed.length +
  r.categories.lost.length + r.categories.added.length + r.budgets.length + (r.currency ? 1 : 0) +
  r.recurring.lost.length + r.recurring.appearing.length + r.recurring.changed.length +
  r.filters.lost.length + r.filters.appearing.length + r.filters.changed.length;

// Списък по 50 с „Покажи още“ (на телефона хиляди редове наведнъж се бавят)
const PagedList = ({ title, items, render, tone }) => {
  const [shown, setShown] = useState(PAGE);
  if (items.length === 0) return null;
  return (
    <div>
      <p className={`text-xs font-medium mb-1 ${tone}`}>{title} ({items.length})</p>
      <ul className="space-y-1">
        {items.slice(0, shown).map((item, i) => (
          <li key={i} className="text-xs text-gray-600 bg-white border border-gray-200 rounded-lg px-2 py-1 break-words">{render(item)}</li>
        ))}
      </ul>
      {items.length > shown && (
        <button
          onClick={() => setShown((n) => n + PAGE)}
          className="mt-1 text-xs px-2 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
        >
          Покажи още ({items.length - shown})
        </button>
      )}
    </div>
  );
};

const ProfileDetails = ({ r }) => (
  <div className="space-y-2">
    <p className="text-sm font-semibold text-gray-700">👤 {r.name}</p>
    <PagedList title="Ще изчезнат (има ги на устройството, няма ги в копието)" tone="text-red-600" items={r.transactions.lost} render={txLine} />
    <PagedList
      title="Променени (на устройството → в копието)"
      tone="text-orange-600"
      items={r.transactions.changed}
      render={(c) => `${c.likely ? "Вероятно променена: " : ""}${txLine(c.from)} — ${txChange(c)}`}
    />
    <PagedList title="Ще се появят (има ги в копието, няма ги на устройството)" tone="text-green-700" items={r.transactions.appearing} render={txLine} />
    <PagedList title="Категории, които изчезват" tone="text-red-600" items={r.categories.lost} render={(c) => `${c.name} (${TYPE_LABEL[c.type]})`} />
    <PagedList title="Категории, които се добавят" tone="text-green-700" items={r.categories.added} render={(c) => `${c.name} (${TYPE_LABEL[c.type]})`} />
    <PagedList title="Бюджетни лимити" tone="text-orange-600" items={r.budgets} render={(b) => `${b.label}: ${limit(b.from)} → ${limit(b.to)}`} />
    <PagedList
      title="Валута"
      tone="text-orange-600"
      items={r.currency ? [r.currency] : []}
      render={(c) => `${c.from.currency} (курс ${c.from.rate}) → ${c.to.currency} (курс ${c.to.rate})`}
    />
    <PagedList title="Повтарящи се, които изчезват" tone="text-red-600" items={r.recurring.lost} render={(x) => `${x.description || x.category} · ${fieldValue("amount", x.amount)} · ${fieldValue("period", x.period)}`} />
    <PagedList
      title="Променени повтарящи се"
      tone="text-orange-600"
      items={r.recurring.changed}
      render={(c) => `${c.from.description || c.from.category}: ${c.fields.map((f) => `${RECURRING_FIELD_LABEL[f]} ${fieldValue(f, c.from[f])} → ${fieldValue(f, c.to[f])}`).join("; ")}`}
    />
    <PagedList title="Повтарящи се, които се появяват" tone="text-green-700" items={r.recurring.appearing} render={(x) => `${x.description || x.category} · ${fieldValue("amount", x.amount)} · ${fieldValue("period", x.period)}`} />
    <PagedList title="Запазени филтри, които изчезват" tone="text-red-600" items={r.filters.lost} render={(f) => f.name} />
    <PagedList
      title="Променени запазени филтри"
      tone="text-orange-600"
      items={r.filters.changed}
      render={(c) => `${c.from.name}: ${c.fields.map((f) => `${FILTER_FIELD_LABEL[f]} ${fieldValue(f, c.from[f])} → ${fieldValue(f, c.to[f])}`).join("; ")}`}
    />
    <PagedList title="Запазени филтри, които се появяват" tone="text-green-700" items={r.filters.appearing} render={(f) => f.name} />
  </div>
);

export default function RestoreLossModal({ report, backupDate, onConfirm, onMerge, onBack }) {
  const [showAll, setShowAll] = useState(false);
  const withLoss = report.filter((r) => r.hasLoss);
  const withoutLoss = report.filter((r) => !r.hasLoss);
  const total = report.reduce((n, r) => n + restoreDiffCount(r), 0);
  const copyDate = backupDate && !Number.isNaN(new Date(backupDate).getTime())
    ? new Date(backupDate).toLocaleDateString("bg-BG", { day: "2-digit", month: "2-digit", year: "numeric" })
    : null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-blue-50 rounded-2xl shadow-xl w-full max-w-sm max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-orange-200 shrink-0">
          <h2 className="text-base font-semibold text-orange-700">⚠️ Ще бъдат изтрити или променени данни</h2>
        </div>
        <div className="px-5 py-4 space-y-3 overflow-y-auto min-h-0">
          <p className="text-sm text-gray-600">
            При „Замести“ данните на устройството се сменят с тези от резервното копие{copyDate ? ` (от ${copyDate})` : ""}. Ето какво ще изчезне или ще се промени:
          </p>
          {withLoss.map((r) => (
            <div key={r.id} className="bg-orange-50 rounded-xl p-3 border border-orange-200">
              <p className="text-sm font-semibold text-orange-700 mb-1">👤 {r.name}</p>
              <ul className="list-disc pl-4 space-y-0.5">
                {summaryLines(r).map((line, i) => (
                  <li key={i} className="text-sm text-orange-700 break-words">{line}</li>
                ))}
              </ul>
            </div>
          ))}
          {withoutLoss.map((r) => (
            <p key={r.id} className="text-sm text-green-700">✅ {r.name}: нищо не изчезва и не се променя.</p>
          ))}
          <button
            onClick={() => setShowAll((v) => !v)}
            className="w-full px-3 py-2 rounded-xl text-sm font-medium bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 transition"
          >
            {showAll ? "Скрий разликите" : `Покажи всички разлики (${total})`}
          </button>
          {showAll && (
            <div className="space-y-4">
              {report.filter((r) => restoreDiffCount(r) > 0).map((r) => <ProfileDetails key={r.id} r={r} />)}
              <p className="text-xs text-gray-400">
                „Вероятно променена“ — транзакцията на устройството и тази в копието нямат общ номер (напр. копие от друго устройство); приложението ги свързва по дата, тип и категория.
              </p>
            </div>
          )}
          <p className="text-xs text-gray-500">
            „Обедини вместо това“ — нищо от устройството не се изтрива: транзакциите от копието, които ги няма, се добавят (с преглед на вероятните дубликати), а валутата и лимитите остават.
          </p>
        </div>
        <div className="px-5 pt-2 pb-5 space-y-2 shrink-0">
          <button
            onClick={onConfirm}
            className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-red-500 text-white hover:bg-red-600 transition"
          >
            Изтрий и възстанови
          </button>
          <button
            onClick={onMerge}
            className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 transition"
          >
            Обедини вместо това
          </button>
          <button
            onClick={onBack}
            className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
          >
            Назад
          </button>
        </div>
      </div>
    </div>
  );
}
