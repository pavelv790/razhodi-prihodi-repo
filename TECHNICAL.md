# Техническо описание — „Разходи-Приходи“

> Пълна техническа документация на приложението. Обхваща архитектура, съхранение
> на данни, всички модули (hooks, utils, компоненти), облачна синхронизация,
> резервни копия, PWA поведение, механизма за изрични потвърждения в раздел
> „Данни“, фините детайли по компоненти (§15) и цялата хронологична история на
> одитите и поправките (§16).
>
> Този файл замества и включва цялото съдържание на по-стария
> `Техническо_описание_20260719.docx`.

Последна актуализация: 2026-09-07

---

## 1. Общ преглед

„Разходи-Приходи“ (кратко име „Финанси“) е безплатно уеб приложение (PWA) за
проследяване на лични приходи и разходи. Работи изцяло в браузъра, без бекенд по
подразбиране. Всички данни се пазят локално в **IndexedDB**. По желание
потребителят може да свърже **Google Drive** или **резервно копие в Облака
(Supabase Storage)** за автоматични облачни копия.

Основни възможности:

- Записване на разходи и приходи (категория, сума, дата, описание)
- История с филтри, сортиране, странициране (по 50)
- Бюджетни лимити (общ и по категории, с период)
- Месечна статистика и графики (recharts)
- Няколко независими профила (различни хора на едно устройство)
- Повтарящи се транзакции (наем, заплата и др.) с чакащи за потвърждение
- Импорт/експорт към Excel (`.xlsx`)
- Локални резервни копия (`.json`) и възстановяване с обработка на конфликти
- Облачни резервни копия: Google Drive и Supabase Storage
- Напомняне за резервно копие на конфигурируем интервал
- Многоезичен потребителски интерфейс: само български

Версията, показвана на потребителя, е в
[`src/components/UserGuideModal.jsx`](src/components/UserGuideModal.jsx) (секция 1,
текстово поле „Версия …“). `package.json` държи `version: 0.0.0` и не се използва
за показване.

---

## 2. Технологичен стек

| Слой | Технология |
|---|---|
| UI библиотека | React 19 (`react`, `react-dom`) |
| Билд/дев сървър | Vite 8 (`@vitejs/plugin-react`, Rolldown-базиран) |
| Стилове | Tailwind CSS 4 (`@tailwindcss/vite`), плюс `src/index.css` |
| Икони | `lucide-react` |
| Графики | `recharts` 3 |
| Excel | `exceljs` (запис) и `xlsx` / SheetJS (четене) |
| Локална база | IndexedDB (собствен тънък слой, без библиотека) |
| Облак | `@supabase/supabase-js` 2 (Auth + Storage) |
| PWA | `vite-plugin-pwa` (Workbox, `generateSW`) |
| Линтване | ESLint 9 (`@eslint/js`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`) |

Няма TypeScript. Няма рутер. Няма state-мениджър — състоянието се държи в
`App.jsx` и в custom hooks.

---

## 3. Стартиране, билд, конфигурация

### Скриптове (`package.json`)

```bash
npm run dev       # dev сървър (Vite)
npm run build     # прод билд в dist/
npm run preview   # локален преглед на прод билда
npm run lint      # ESLint върху целия проект
```

### Environment променливи

Четат се от `import.meta.env` (Vite). Файл `.env` в основната папка:

```
VITE_SUPABASE_URL=<адрес на Supabase проекта>
VITE_SUPABASE_ANON_KEY=<anon/public ключ>
```

Използват се само в [`src/utils/supabase.js`](src/utils/supabase.js). Ако
липсват, `createClient` ще получи `undefined` и всички облачни операции ще се
провалят тихо (UI-ят остава функционален локално).

`vite.config.js`:

- `build.commonjsOptions.transformMixedEsModules: true` — нужно за SheetJS tarball.
- `define: { "process.env": {} }` — глушител за библиотеки, които четат `process.env`.
- `VitePWA`:
  - `registerType: "prompt"`, `injectRegister: false` — регистрацията на Service
    Worker се прави ръчно в `App.jsx` чрез `virtual:pwa-register`.
  - `workbox.globPatterns`: прекешва `js,css,html,ico,png,svg,json,woff2`.
  - `workbox.navigateFallback: "index.html"` — SPA fallback.
  - `manifest`: име, икони `/icon-192.png`, `/icon-512.png`, `theme_color #3b82f6`,
    `display: standalone`.

### Supabase — изисквана инфраструктура

За да работи облачната част, в Supabase проекта трябва да има:

- **Auth**: включен Email провайдър и Google OAuth провайдър (със Scope
  `https://www.googleapis.com/auth/drive.file`). Redirect URL = `window.location.origin`.
- **Storage bucket** с име `finances-backup` и политики (RLS), които позволяват на
  вписан потребител да чете/пише/трие само в папка `"<неговото user id>/"`.

---

## 4. Архитектура и поток на данните

```
                       ┌───────────────────────────────┐
                       │            App.jsx            │  (единствен компонент-контейнер)
                       │  — държи модалното състояние   │
                       │  — оркестрира възстановяване   │
                       │  — auto-sync ефекти           │
                       └───────────────┬───────────────┘
                                       │ props / callbacks
        ┌────────────┬────────────┬────┴───────┬────────────┬─────────────┐
        ▼            ▼            ▼            ▼            ▼             ▼
  useProfiles  useTransactions useCategories useBudgets useCurrency  useRecurring
  useSavedFilters  useGoogleDrive  useSupabaseStorage
        │            │            │            │            │             │
        └────────────┴──────┬─────┴────────────┴────────────┴─────────────┘
                            ▼
                    utils/db.js  →  IndexedDB (finance_db, версия 9)
```

Ключови правила:

- **Всеки hook, обвързан с профил, приема `activeProfileId` като аргумент.** При
  смяна на `profileId` hook-ът презарежда своите данни и нулира `isLoaded`.
- **Записът е auto-save с debounce.** Промяна в state → `setTimeout` (обикновено
  300 ms) → запис в съответния IndexedDB store. `useTransactions` пази „pending
  save“ и го изхвърля синхронно при unmount/смяна на профил, за да не се губят
  данни.
- **Мулти-профилен запис.** Store-овете `transactions` и `recurring` държат
  записи от всички профили в един store. При запис hook-ът чете всичко, филтрира
  чуждите профили, `clear()` + `put()` наново. Затова е опасно приложението да е
  отворено в два таба (виж §12).
- `App.jsx` изчаква всички `isLoaded` флагове (`profilesLoaded`,
  `transactionsLoaded`, `categoriesLoaded`, `filtersLoaded`, `currencyLoaded`),
  преди да пусне auto-sync ефектите.

---

## 5. Съхранение на данни

### 5.1 IndexedDB — `utils/db.js`

- Име: `finance_db`, версия: **9**.
- `openDB()` е синглтон (`dbPromise`), с retry при грешка (нулира промиса).
- `onupgradeneeded` създава всички store-ове, ако липсват (без миграции на данни).
- `req.onblocked` → `alert`, че приложението е отворено в друг таб със стара
  версия.
- Провалени записи се сигнализират през `reportDBError()` → callback, регистриран
  с `onDBWriteError()` (в `App.jsx` вдига червена лента).

| Store | `keyPath` | Съдържание на записа |
|---|---|---|
| `transactions` | `id` | `{ id, profileId, type, category, amount, date, description }` |
| `categories` | `type` | `{ type: <profileId>, categories: { expense: string[], income: string[] } }` — забележка: `type` държи `profileId` |
| `saved_filters` | `id` | `{ id, name, profileId, fromDate, toDate, categories, description }` |
| `currency` | `id` | `{ id: <profileId>, currency: "EUR"|…, rate: number }` |
| `budgets` | `id` | `{ id: <profileId>, totalLimit, categoryLimits, fromDate, toDate }` |
| `profiles` | `id` | `{ id, name, createdAt }` |
| `recurring` | `id` | виж §6.7 |
| `last_filter` | `id` | `{ id: <profileId>, fromDate, toDate, categories, description }` — store, добавен във версия 9 на базата |

### 5.2 localStorage ключове

| Ключ | Тип / стойност | Смисъл |
|---|---|---|
| `active_profile_id` | string | ID на активния профил |
| `data_panel_open` | `"true"`/`"false"` | Дали панелът „Данни“ е разгънат |
| `pie_threshold` | число (%) | Праг за Pie chart в `ChartsModal` — категории под него отиват в „Други“ |
| `backup_reminder_interval` | `"off"|"weekly"|"monthly"|"quarterly"` | Интервал за напомняне за резервно копие |
| `last_backup_reminder_date` | ISO дата | Кога за последно е показано напомнянето |
| `last_local_backup_date` | ISO дата | Кога за последно е свалян локален `.json` |
| `last_drive_upload_date` | ISO дата | Последно качване в Google Drive |
| `last_supabase_upload_date` | ISO дата | Последно качване в Облака |
| `google_drive_settings` | JSON `{ autoSync }` | Режим на авто-качване за Drive (`off`/`onChange`/`daily`) |
| `supabase_storage_settings` | JSON `{ autoSync }` | Режим на авто-качване за Облака |
| `supabase_storage_enabled` | `"true"`/`"false"` | Активирано ли е резервното копие в Облака |
| `drive_daily_backup_last` | `YYYY-MM-DD` | Ден на последното „daily“ качване в Drive |
| `supabase_daily_backup_last` | `YYYY-MM-DD` | Ден на последното „daily“ качване в Облака |
| `cross_service_switch_expected_until` | timestamp (ms) | До кога умишлено превключване Drive↔Облак да не показва „разкачени сте“ |

### 5.3 Формат на резервното копие (`.json`)

Генерира се от `App.buildBackupData()` и `utils/backup.js → exportBackup()`.
`version: "1.6"`.

```jsonc
{
  "version": "1.6",
  "date": "<ISO>",
  "profiles": [{ "id", "name", "createdAt" }],
  "activeProfileId": "<id>",
  "transactions": [ /* всички профили */ ],
  "expenseCategories": ["…"],        // категории на активния профил (обр. съвместимост)
  "incomeCategories": ["…"],
  "profileCategories": { "<profileId>": { "expense": [], "income": [] } },
  "savedFilters": [ /* всички профили */ ],
  "currency": "EUR", "rate": 1,      // на активния профил (обр. съвместимост)
  "budgets": { /* на активния профил */ },
  "profileCurrencies": { "<profileId>": { "currency", "rate" } },
  "profileBudgets": { "<profileId>": { "totalLimit", "categoryLimits", "fromDate", "toDate" } },
  "recurringItems": [ /* всички профили */ ]
}
```

`importBackup()` валидира наличието на `transactions`, `expenseCategories`,
`incomeCategories`. Стари копия без `profiles` се мигрират към един профил
„По подразбиране“ с `id = "profile_default_legacy"`.

---

## 6. Модели на данни и hooks

Всички hooks са в [`src/hooks/`](src/hooks). Общ шаблон: `load*` при монтиране/смяна
на профил, `save*` с ефект при промяна на state, експортирани `deleteProfile*`
функции за каскадно изтриване на профил.

### 6.1 `useProfiles()`

Не приема аргумент. Държи `profiles`, `activeProfileId`, `activeProfile`.

- `createProfile(name)` — trim, проверка за дубликат по име (case-insensitive),
  `id = "profile_" + Date.now()`, новият става активен. Връща профила или `false`.
- `switchProfile(id)`, `deleteProfile(id)` (превключва към първия останал или
  `null`), `renameProfile(id, newName)` (проверка за дубликат),
  `addOrUpdateProfile(profile)` — upsert, ползва се при възстановяване.
- `activeProfileId` се персистира в `localStorage["active_profile_id"]`.
- Ако няма профили, `App.jsx` отваря `ProfileModal` без бутон за затваряне.

### 6.2 `useTransactions(profileId)`

- Модел: `{ id, profileId, type: "expense"|"income", category, amount, date: "DD/MM/YYYY", description }`.
  `amount` винаги е в **EUR** (конверсията става във формата преди добавяне).
- `id = "<Date.now()>-<random base36>"`.
- Сортиране `sortByDate`: по дата низходящо; при равна дата по-новото `id` е
  по-горе.
- Записът е `saveAllToDB_forProfile`: чете всички транзакции, запазва чуждите
  профили, `clear()` + `put()` наново. Debounce 300 ms; `pendingSaveRef` се
  flush-ва при смяна на профил/unmount.
- `skipAutoSave` флаг — ползва се от `replaceAllTransactions`, за да не се задейства
  двоен запис.
- API: `addTransaction`, `editTransaction`, `deleteTransaction`,
  `deleteTransactionsByCategory(name, type)`,
  `reassignTransactionsCategory(name, type)` (маркира като „Без категория“),
  `replaceAllTransactions(list, overrideProfileId?)`, `addTransactions(list)`,
  `deleteAllTransactionsByProfile(id)`, `getFilteredTransactions(filters)`,
  `getSummary(list)` → `{ income, expense, balance }`.
- Филтърът в `getFilteredTransactions`: диапазон дати (`parseDate`), категории
  като ключове `"<name>::<type>"`, търсене по описание (частично,
  case-insensitive).

### 6.3 `useCategories(profileId)`

- Данните са в store `categories`, ключ `type = profileId`, стойност
  `{ categories: { expense: [], income: [] } }`.
- Ако няма запис за профила → зареждат се `DEFAULT_EXPENSE_CATEGORIES` /
  `DEFAULT_INCOME_CATEGORIES` от [`src/constants/categories.js`](src/constants/categories.js).
- `sortCategories` — азбучно по български (`localeCompare("bg")`).
- `loadedForProfileRef` пази срещу запис със стари данни при бърза смяна на
  профил.
- API: `addCategory`, `editCategory`, `deleteCategory`,
  `addCategoriesFromImport(type, list)` (обединяване + dedupe),
  `setExpenseCategoriesFromBackup`, `setIncomeCategoriesFromBackup`.
- Експортирани модулни функции: `saveToDB(profileId, expense, income)` (алиас
  `saveCategoriesDirectly` в `App.jsx`), `deleteProfileCategories(profileId)`.

### 6.4 `useBudgets(profileId)`

- Модел: `{ totalLimit: string, categoryLimits: { [cat]: string }, fromDate, toDate }`.
  По подразбиране период = текущият месец (`getFirstDayOfMonth` / `getLastDayOfMonth`).
- API: `updateBudgets(obj)`, `restoreBudgets(obj)`. Store `budgets`, ключ `id = profileId`.
- Изчисления/предупреждения за надскочен лимит са в
  [`SummaryCards.jsx`](src/components/SummaryCards.jsx).

### 6.5 `useCurrency(profileId)`

- Модел: `{ currency: string, rate: number }`. По подразбиране `EUR` / `1`.
- `convert(amount)`: ако `currency === "EUR"` → връща сумата; иначе `amount / rate`
  (закръглено до 2 знака). Тоест `rate` е „колко единици чужда валута за 1 EUR“.
- API: `updateCurrency(cur, rate)`, `resetToEur()`, `restoreCurrency(cur, rate)`.
- Store `currency`, ключ `id = profileId`.

### 6.6 `useSavedFilters(profileId)`

- Store `saved_filters`, всеки запис има `profileId`. `id = "<Date.now()>"`.
- API: `saveFilter(name, filter)`, `deleteFilter(id)`,
  `restoreFilters(list, targetProfileId?)` (запазва чуждите профили),
  `setSavedFilters` (директен сетер, ползва се при merge възстановяване).
- Експортирано: `deleteProfileSavedFilters(profileId)`.

### 6.7 `useRecurring(profileId)`

- Модел на запис:
  ```jsonc
  {
    "id": "recurring_<Date.now()>",
    "profileId": "<id>",
    "type": "expense"|"income",
    "category": "…",
    "amount": <number>,
    "description": "…",
    "period": "daily"|"weekly"|"monthly"|"yearly"|"custom",
    "customDays": <number|undefined>,   // само при period="custom"
    "startDate": "DD/MM/YYYY",
    "endDate": "DD/MM/YYYY"|"",
    "variableAmount": <bool>,            // сумата се въвежда при всяко потвърждение
    "lastAdded": "DD/MM/YYYY"|null
  }
  ```
- **Алгоритъм за чакащи (`getPendingDates(item, today)`)**:
  1. Начало = `lastAdded` (следваща дата след него) или `startDate`.
  2. `getNextDate` спрямо `period`:
     - `weekly`: +7 дни; `daily`: +1 ден; `yearly`: +1 година;
     - `monthly`: следващ месец, ден = `min(оригинален ден от startDate, брой дни в месеца)`
       (коректно за 29–31 число);
     - `custom`: `+ (customDays || 1)` дни.
  3. Итерира, докато `current <= today` (предпазен лимит 366 итерации), събира
     всички дати `>= startDate` и `<= endDate` (ако има).
- `getPendingTransactions()` (в hook-а) обхожда всички записи и връща плосък
  списък от `{ recurringId, date, type, category, amount, variableAmount, description }`.
- API: `addRecurring`, `editRecurring`, `deleteRecurring`, `markAsAdded(id, date)`,
  `deleteAllByProfile(id)`, `restoreRecurring(items, targetProfileId?)`.
- В `App.jsx` ефект следи за чакащи и отваря `PendingRecurringModal` (освен ако не
  е отворен друг блокиращ модал — възстановяване, конфликти и т.н.).
  `handleConfirmPending(toAdd)` добавя избраните транзакции и вика `markAsAdded` за
  **всеки** `recurringId` (дори при пропускане), за да не се трупат отново.

---

## 7. Utility модули (`src/utils/`)

### 7.1 `db.js`
Виж §5.1.

### 7.2 `formatters.js`

Датите в приложението са низове `"DD/MM/YYYY"`.

- `formatAmount(n)` — `Intl.NumberFormat("bg-BG")`, 2 знака.
- `formatDate`, `parseDate` (→ `Date` или `null`), `autoFormatDate` (вкарва `/`
  докато се пише), `isValidDate` (строга проверка за реална дата).
- `getTodayString`, `getFirstDayOfMonth(date?)`, `getLastDayOfMonth(date?)`.

### 7.3 `backup.js`

- `exportBackup(...)` — сглобява обекта (version 1.6), сваля Blob като
  `Финанси_Backup[_<profileName>]_DD.MM.YYYY.json`. `sanitizeFileName` маха
  `\ / : * ? " < > |`.
- `importBackup(file)` — `FileReader` → `JSON.parse`, валидация, legacy миграция
  (виж §5.3). Връща промис с данните или отхвърля с четимо съобщение.

### 7.4 `supabase.js`
`createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)` — единствен споделен
клиент.

### 7.5 `supabaseAuth.js`

- `signUpWithEmail`, `signInWithEmail`, `signOutFromSupabase`,
  `getCurrentSession`, `resetPassword(email)` (redirect към `window.location.origin`;
  валидира имейла преди извикване на Supabase, за да не се връщат англ. съобщения).
- Забравена парола: `resetPassword` праща имейл с линк; при отваряне на линка
  `supabase.auth.onAuthStateChange` получава събитие `PASSWORD_RECOVERY` →
  `useSupabaseStorage` вдига `showNewPassword` (форма за нова парола) →
  `updatePassword()` вика `supabase.auth.updateUser({ password })`.
- `useSupabaseStorage.translateSupabaseError(msg)` — превежда англ. грешки от
  Supabase на български; ползва се във всички `catch` блокове и при `updatePassword`.

### 7.6 `supabaseStorage.js`

- Bucket `finances-backup`. Път на файла: `"<user.id>/<fileName>"`.
- `transliterate()` — кирилица → латиница (за име на файла).
- `buildFileName(profileName, profileId)` →
  `Finances_Backup[_<translit>_<последни 4 от profileId>]_DD.MM.YYYY.json`.
- `uploadBackupToSupabase`:
  1. `upload(..., { upsert: true })` на новия файл **първо**;
  2. чак след успех — `list` по префикс и `remove` на старите (различна дата).
- `downloadBackupFromSupabase` — `list` по префикс, филтрира по точен regex за име,
  взима най-новия по `updated_at`/`created_at`, `download` + `JSON.parse`.
- `isExactBackupFileName` — regex `^<prefix>_\d{2}\.\d{2}\.\d{4}\.json$`.

### 7.7 `googleDrive.js`

- OAuth през Supabase: `supabase.auth.signInWithOAuth({ provider: "google",
  options: { scopes: "…/auth/drive.file", redirectTo: origin } })`.
- `accessToken` (модулна променлива) = `session.provider_token`.
  `restoreSessionFromSupabase()` го възстановява от `getSession()`.
- Папка `Finances_Backup` в Drive (`getOrCreateFolder`). Име на файл:
  `Finances_Backup[_<profileName>]_DD.MM.YYYY.json`.
- `findExistingFileByProfile` — търси по `name contains '<prefix>'`, филтрира с
  точен regex; ако намери → `PATCH` (презапис), иначе `POST` (нов). Multipart
  upload.
- `checkDriveResponse` — при 401/403 хвърля „Сесията е изтекла“.
- `escapeDriveQuery` — екранира `\` и `'` за Drive `q=` синтаксиса.
- **Ограничения на сесията** (документирани и в UI): `provider_token` живее ~1 час
  (следващо качване след час може да се провали); при неотваряне на приложението
  повече от ~седмица се иска ново свързване (Supabase по подразбиране пази сесията
  ~1 седмица неактивност).
- **Google OAuth „тестов режим“**: приложението е в тестов режим на OAuth consent
  екрана; нови потребители трябва да се добавят ръчно в Google Cloud Console →
  OAuth consent screen → Test users, иначе входът се отказва.
- При режим само за Google Drive **никакви финансови данни не се изпращат към
  Supabase** — Supabase служи единствено за OAuth. Данните отиват директно в Google
  Drive на потребителя.

### 7.8 `crossServiceSwitch.js`

- `markExpectedServiceSwitch()` → записва `Date.now() + 15000` в
  `localStorage["cross_service_switch_expected_until"]`.
- `isExpectedServiceSwitch()` → `true`, ако още не е изтекло.
- Пази се в localStorage (не в паметта), за да преживее презареждането при Google
  OAuth redirect.

### 7.9 `excel.js`

- `exportToExcel(...)` (ExcelJS) — по лист за всяка година, ред „ОБЩО ЗА МЕСЕЦА“,
  таблица „БАЛАНС“, отделен лист с пълна история. `saveWorkbook` сваля Blob.
- `importFromExcel(file)` (SheetJS) — чете лист с историята, връща транзакции +
  нови категории. Импортът в `ImportExportModal` **замества** всички транзакции.
- `findDuplicates(existing, incoming)` — по дата+категория+тип+сума (толеранс 0.01).
- `exportMonthlyStatsToExcel(transactions, rollingMonths, profileName)` — обвит в
  `setTimeout`, за да не блокира UI при много данни.

---

## 8. Компоненти (`src/components/`)

`App.jsx` (≈2250 реда) е единственият контейнер. Държи цялото модално състояние и
логиката по възстановяване. Останалите компоненти са презентационни + локален
state.

| Компонент | Роля | Има собствено потвърждение? |
|---|---|---|
| `TransactionForm` | Форма за добавяне/редактиране; смяна на валута; препратка към профилите | — |
| `SummaryCards` | Три карти (Приходи/Разходи/Баланс) + панел с бюджетни предупреждения | — |
| `FilterBar` | Панел „Филтриране“ — период, категории, търсене, запазени филтри | — |
| `TransactionList` | История: тип-филтър, сортиране, странициране по 50 | **Да** — изтриване на транзакция |
| `CategoryManager` | Управление на категории по профил | **Да** — изтриване (запази „Без категория“ / изтрий транзакциите) |
| `BudgetModal` | Общ лимит + лимити по категории + период | — |
| `RecurringModal` | CRUD на повтарящи се транзакции | **Да** — изтриване на запис |
| `PendingRecurringModal` | Избор кои чакащи транзакции да се добавят; въвеждане на променлива сума | — |
| `ProfileModal` | Превключване/създаване/преименуване/изтриване на профил; вход към Merge/Copy | **Да** — изтриване на профил |
| `MergeProfileModal` | Импорт на транзакции от резервно копие на друг профил (филтри, дубликати) | — |
| `CopyTransactionsModal` | Копиране на транзакции директно от друг локален профил | — |
| `MonthlyStats` | Средна месечна сума по категория за X завършени месеца + Excel експорт | — |
| `ChartsModal` | 4 режима: Общо, Rolling avg (Общо/По категории), По категории, Pie chart | — |
| `ImportExportModal` | Импорт/експорт Excel (`mode = "import" | "export"`) | Предупреждение при импорт (замества всичко) |
| `DateInput` | Поле за дата, разделено на ДД/ММ/ГГГГ с авто-фокус | — |
| `UserGuideModal` | Ръководство за потребителя (19 разгъваеми секции) | — |

Общ визуален шаблон за модал: `fixed inset-0 bg-black/40 … z-50`, карта
`bg-blue-50 rounded-2xl shadow-xl max-w-sm`. Toast за успех: зелена лента горе
(`z-[100]`). Блокиращ прозорец за грешка/внимание: overlay с оранжева/червена
кутия.

---

## 9. Облачна синхронизация

### 9.1 Споделена връзка Drive ↔ Облак

И двете услуги ползват **един и същ Supabase Auth сесиен обект**:

- Сесия **с** `provider_token` → влизане през Google → третира се като **Google
  Drive**. `useGoogleDrive` слуша `onAuthStateChange`; при `session.provider_token`
  вика `setAccessToken` и `setConnected(true)`.
- Сесия **без** `provider_token`, но с `user` → влизане с имейл/парола → третира
  се като **Облак**. `useSupabaseStorage` брои това за връзка.

Следствие: **само една от двете услуги може да е активна.** Свързването с едната
изключва другата. `App.jsx` показва `showCrossServiceWarning` (`"toDrive"` /
`"toSupabase"`) с изрично потвърждение, преди да превключи, и вика
`markExpectedServiceSwitch()`, за да не изскочи веднага „връзката беше
прекъсната“.

Двата hook-а пазят `selfDisconnectUntilRef` (5 s) за собствено предизвикано
изключване и проверяват `isExpectedServiceSwitch()` (15 s), преди да покажат
съобщение „връзката беше прекъсната“.

### 9.2 Режими на автоматично качване

И за Drive, и за Облака (`autoSync`): `"off"` | `"onChange"` | `"daily"`. Пази се в
`localStorage` (`google_drive_settings` / `supabase_storage_settings` като JSON
`{ autoSync }`). Обратна съвместимост: стара булева стойност → `onChange`/`off`.

Ефектите в `App.jsx` (два отделни, по един за услуга) следят снапшот от
`[transactions, expenseCategories, incomeCategories, savedFilters, profiles]`:

- `onChange` + реална промяна → `setTimeout(1500 ms)` → качване на
  `buildBackupData()`.
- `daily` + `shouldRunDaily()` (сравнява `*_daily_backup_last` с днешната дата) →
  качване, после `markDailyDone()`.
- Пропуска се, ако: не всичко е заредено; има `pendingBackup` (тече
  възстановяване); услугата не е свързана; няма транзакции и профилите са ≤ 1;
  липсва име на активния профил.

При провал на авто-качване в Drive се показва предупреждение „сесията може да е
изтекла“.

### 9.3 Ръчни действия

- `handleDriveUpload` / `handleSupabaseUpload` → `buildBackupData()` → качване;
  при успех обновяват датата на последно качване.
- „Възстанови от Drive/Облака“ → сваля суровите данни →
  `normalizeBackupProfileIds` → същият поток на възстановяване като при файл (§10).

---

## 10. Резервни копия и възстановяване

### 10.1 Локални

- „Свали резервно копие“ → `handleBackupExport` → `buildBackupData()` →
  `exportBackup()`. Записва `last_local_backup_date`.
- „Възстанови от файл“ → скрит `<input type="file" accept=".json">` →
  `handleBackupFileSelect`.

### 10.2 `buildBackupData()` (в `App.jsx`)

Чете от IndexedDB данните на **всички** профили (категории, транзакции, филтри,
повтарящи се, валути, бюджети), като за активния профил ползва актуалния React
state. Връща обект version `1.6` (виж §5.3).

### 10.3 `normalizeBackupProfileIds(data)`

Ако профил от копието има различен `id`, но същото име (case-insensitive) като
локален профил → пренасочва всички `profileId`-та (транзакции, филтри, повтарящи
се, `profileCategories`, `profileCurrencies`, `profileBudgets`, `activeProfileId`)
към локалния `id`. Връща `{ data, remappedIds }`; `remappedIds` се ползва за
допълнителното предупреждение „сигурен ли си, че е същият човек“.

### 10.4 Поток на възстановяване

1. Раздели профилите от копието на **съвпадащи** (има локален с този `id` или
   име) и **нови**.
2. Ако има съвпадащи → `showConflictModal`: за всеки — избор
   `backup` (замести) / `local` (запази локалните) / `merge` (добави транзакциите).
3. `showRestoreConfirm` — обобщение с предупреждения според избора.
4. `finishRestore(remainingProfiles, backupData)`:
   - `local` → нищо, само отчита.
   - `merge` → изчислява дубликати (дата+категория+тип+сума, толеранс 0.01);
     ако има → `showRestoreDuplicates` (потребителят избира кои дубликати да
     влязат); `handleRestoreDuplicatesConfirm` довършва и продължава с останалите.
     „Откажи“ тук спира **цялото** възстановяване.
   - `backup` → `replaceAllTransactions(backupTxs, profileId)`.
   - `finishRestoreForProfile` — възстановява категории, валута, бюджети, филтри,
     повтарящи се за профила (при `merge` — обединяване, не заместване).
5. Нови профили → `showAddNewProfilesConfirm` → `handleAddNewProfilesConfirm(true/false)`.
6. `showRestoreDone` — обобщение по профил (възстановен / обединен / запазен
   локално / пропуснат).

Рефове за оркестрация: `pendingNewProfilesRef`, `completedRestoreProfilesRef`,
`driveSnapshotRef`, `supabaseSnapshotRef`, `backupFileRef`, `lastFilterLoadedForRef`.

### 10.5 Напомняне за резервно копие

Ефект в `App.jsx`: при наличие на транзакции и категории проверява
`backup_reminder_interval`:

- `off` → нищо.
- Първо пускане (няма `last_backup_reminder_date`) → само записва „сега“, не
  показва.
- `weekly` → ≥ 7 дни; `monthly` → различен месец/година; `quarterly` → ≥ 3 месеца.
- При задействане → записва новата дата и след 500 ms отваря `showWeeklyBackup`
  (предлага сваляне на локално копие).

---

## 11. PWA и обновяване на версията

- `vite-plugin-pwa` генерира `sw.js` + `workbox-*.js` (`generateSW`).
- В `App.jsx`: `registerSW({ immediate: true, onNeedRefresh, onRegisteredSW })`
  от `virtual:pwa-register`.
  - `onNeedRefresh` → `showUpdateAvailable` (синя лента най-горе с бутон „Обнови“).
  - „Обнови“ → `updateSWRef.current(true)` — активира новия SW и презарежда.
  - `onRegisteredSW` → на всеки час `registration.update()`.
- Иконите (`/icon-192.png`, `/icon-512.png`, `/favicon.png`) са в `public/`.

---

## 12. Устойчивост и защита от загуба на данни

- **Многотабова защита**: `navigator.locks.request("finance_app_open_tab",
  { ifAvailable: true }, …)`. Ако lock-ът не се вземе → `multiTabWarning`
  (оранжева лента). Причина: `transactions`/`recurring` се презаписват изцяло при
  всеки запис, така че два таба тихо си затриват промените.
- **`db.onblocked`** → `alert` при отворен таб със стара версия на схемата.
- **Провал при запис** → `reportDBError()` → `dbWriteError` (червена лента с
  инструкция да се свали копие и да се презареди).
- **Flush при unmount** — `useTransactions` записва „pending“ данни синхронно при
  смяна на профил/затваряне.
- **`loadedForProfileRef` / `lastFilterLoadedForRef`** — пазят срещу запис със
  стари данни при бърза смяна на профил.

---

## 13. Механизъм за изрични потвърждения в раздел „Данни“

### 13.1 Мотивация

Досега редица чувствителни действия в панела „Данни“ се изпълняваха веднага, само
с последващо уведомление. Добавен е **общ прозорец за изрично потвърждение**, който
задържа действието, докато потребителят не натисне бутона за потвърждение.

### 13.2 Реализация (`App.jsx`)

Ново състояние:

```js
const [confirmDialog, setConfirmDialog] = useState(null);
// форма: { title, message, confirmLabel, tone: "danger" | "warning", onConfirm }
```

Рендер (близо до другите модали, `z-[110]`, над всичко останало):

- Карта в стандартния стил; кутия с текста — червена при `tone: "danger"`,
  оранжева при `tone: "warning"`.
- Бутон за потвърждение: първо `setConfirmDialog(null)`, после `onConfirm?.()`
  (диалогът се затваря веднага, действието се изпълнява след това).
- Бутон „Откажи“ → `setConfirmDialog(null)`, без страничен ефект.

За радио-бутоните: тъй като `checked` е контролирано от React state, а state-ът се
сменя чак в `onConfirm`, при отказ радиото визуално се връща на старата стойност
без допълнителен код.

### 13.3 Обхванати точки

| Действие | Тригер в кода | `tone` | Ефект при потвърждение |
|---|---|---|---|
| „Изключи Google Drive“ | бутон, `onClick` | `danger` | `driveDisconnect` (`useGoogleDrive.disconnect`) |
| „Деактивирай резервно копие“ (Облак) | бутон, `onClick` | `warning` | `supabaseDisable` (`useSupabaseStorage.disable`) |
| „Изход от облака“ | бутон, `onClick` | `danger` | `supabaseDisconnect` (`useSupabaseStorage.disconnectSupabase`) |
| „Напомняне за резервно копие“ — смяна на интервала | радио, `onChange` | `warning` | `localStorage["backup_reminder_interval"] = value` + `setBackupReminderInterval(value)` |
| „Автоматично качване“ (Google Drive) — всяка смяна | радио, `onChange` | `warning` | `driveToggleAutoSync(value)` |
| „Автоматично качване“ (Облак) — всяка смяна | радио, `onChange` | `warning` | `supabaseToggleAutoSync(value)` |

Съобщенията за трите бутона динамично добавят изречение, ако другата услуга е
свързана (обща връзка — ще се прекъсне и тя).

### 13.4 Умишлено НЕ са с потвърждение

- „Активирай резервно копие в Облака“ и бутоните за свързване („Свържи с Google
  Drive“, „Влез в облака“, „Регистрирай се“) — не са разрушителни (не губят
  данни). Свързването при вече активна друга услуга и без това има отделно
  предупреждение (`showCrossServiceWarning`).

### 13.5 Вече съществуващи потвърждения (за пълнота)

Изрично потвърждение имаше и преди на: изтриване на транзакция
(`TransactionList`), на категория (`CategoryManager`), на профил (`ProfileModal`),
на повтаряща се транзакция (`RecurringModal`); „Изтрий всички данни“
(`showDeleteAll`); всички стъпки на възстановяване (`showConflictModal`,
`showRestoreConfirm`, `showRestoreDuplicates`, `showAddNewProfilesConfirm`);
превключване между Drive и Облак (`showCrossServiceWarning`); предупреждение при
импорт от Excel (замества всичко).

---

## 14. Известни ограничения и съзнателно приети решения

### 14.1 Технически дълг

- `npm run lint` показва **2 грешки и 3 предупреждения**, всички **отпреди
  промените по потвържденията** (не са внесени тук):
  - `no-unused-vars`: `addNewProfiles` в `App.jsx`.
  - `react-hooks/immutability` + `react-hooks/exhaustive-deps`: `buildBackupData`
    се използва в `useEffect` преди декларацията си (function hoisting работи, но
    линтърът предупреждава), и няколко ефекта с непълни зависимости (умишлено, за
    да не се пускат авто-качвания при всяко ре-рендиране).
- Билдът предупреждава за chunk > 500 kB (един голям бъндъл, ~2.3 MB / ~660 kB
  gzip). Няма code-splitting.
- Няма автоматизирани тестове.
- `package.json` `version` не отразява показваната версия (тя е в
  `UserGuideModal.jsx`, секция 1).
- Съществува и по-стар файл `Техническо_описание_20260719.docx` в основната папка;
  този `TECHNICAL.md` е актуалната и пълна референция (включва и цялото съдържание
  на `.docx`).

### 14.2 Съзнателно приети ограничения (без промяна в кода)

Тези случаи са известни и оставени нарочно:

- **Race condition при изтриване на профил**: тесен прозорец, в който фонов запис
  на транзакции в IndexedDB може да се застъпи с изтриването на профила. Оставен
  без поправка по решение на потребителя.
- **Тесен прозорец при бърза транзакция след смяна на профил** (виж §16, т. 52):
  транзакция, добавена в първите ~1–2 сек след смяна на профил (преди пълното
  зареждане), може да пропусне едно `onChange` качване; следващата промяна качва
  пълно копие.
- **Нови профили от резервно копие — all-or-nothing**: няма частичен избор кои
  нови профили да се добавят при Restore — само „Да, добави ги“ / „Не, пропусни
  ги“.
- **Няма масово изчистване на бюджетни лимити**: лимитите се трият поотделно.
- **Полето „Категория“ се изчиства при фокус** (в новата транзакция и в
  повтарящите се) — оставено нарочно; няма риск от загуба на данни, защото запис
  без категория се отхвърля от валидацията.
- **Много голям период за осредняване** в „Месечна статистика“ (> 60 месеца) —
  показва се предупреждение, но стойността не се ограничава принудително.
- **Преименуване на профил не мести облачните файлове**: старите копия в Google
  Drive/Облака остават под старото име; показва се само предупреждение. „Възстанови“
  под новото име не намира копие, докато не се качи ново.
- **Лентата при провал на запис в IndexedDB е само уведомление** — при реален
  провал (напр. пълна квота) данните пак не се записват, но потребителят може
  веднага да свали резервно копие от паметта.
- **Браузър без Web Locks API**: многотабовото предупреждение просто не се показва
  (без друга промяна в поведението).

---

## 15. Фини детайли по компоненти

Допълнение към таблицата в §8 — нетривиални поведения, които лесно се пропускат
при четене на кода.

### `TransactionForm.jsx`
- Показва името на активния профил и бутон ▾ до заглавието; клик отваря
  `ProfileModal`.
- Търсене на категория по начални букви; списъкът е нареден по честота на употреба
  през последната година. `categoriesWithCount` и `filteredCategories` са в
  `useMemo` (иначе всяко натискане на клавиш обхожда всички транзакции).
- **`amountTouchedRef` (useRef)**: вдига се на `true` само в реалния `onChange` на
  полето за сума; нулира се при отваряне на нова редакция и при reset. При
  `handleSubmit` по време на редакция: ако полето не е пипано → записва се
  `Number(amount)` директно, **без** `convert()` (полето вече държи точната EUR
  стойност); ако е пипано → `convert(amount)` както при нова транзакция. Това
  предотвратява двойна конверсия при редакция на транзакция с чужда валута.
- Съобщението за успех при редакция показва коректно `EUR`, когато полето не е
  докоснато (не активната чужда валута).
- **`stickyDate` / „Запази датата“**: при включено датата не се нулира след
  добавяне; показва се оранжево предупреждение. По време на редакция чекбоксът и
  предупреждението се скриват; след редакцията датата се връща към запазената.
  `savedStickyDateRef` се записва само ако е още `null` (за да не се презапише при
  започване на редакция на втора транзакция, докато тече първа).
- Смяна на тип (Разход↔Приход) по време на редакция изчиства категорията и полето
  за търсене (иначе се създават транзакции с несъответстващи тип/категория).
- Бутонът „Добави“ е най-долу — след секцията „Дата, описание и валута“.

### `DateInput.jsx`
- `buildValue` връща празен низ `""`, когато и трите части са празни (не `"//"`) —
  иначе изтрити дати оставяха фалшив „АКТИВЕН ФИЛТЪР“, период на бюджет не можеше
  да се изчисти и т.н.
- Водещата нула (напр. `"3"` → `"03"`) се добавя само когато фокусът напусне
  **цялата** дата (проверка чрез `document.activeElement` в `setTimeout(…, 0)`, не
  `event.relatedTarget` — ненадежден на мобилни), за да може да се въведе
  двуцифрено число, започващо с „1“, с пауза между цифрите.
- При ден 29 / месец февруари полето за година допуска 29 дни, докато годината не е
  напълно въведена (< 4 цифри); истинската проверка за високосна година се прилага
  чак след пълно попълване (иначе `29/02/2024` тихо ставаше `28/02/2024`).

### `RecurringModal.jsx`
- Списъкът е нареден по деня от `startDate` (най-малкият ден — най-отгоре).
- Начална дата — задължително валидна (`isValidDate`, не само непразна); крайна
  дата — ако е попълнена, трябва да е валидна, иначе се приема за „безкрайна“.

### `PendingRecurringModal.jsx`
- При `variableAmount: true` полето за сума е с изрично означение `EUR` (сумата се
  записва директно, без конверсия).
- Бутонът „Добави избраните“ е неактивен, докато няма валидна (ненулева) сума за
  всяка избрана транзакция с променлива сума.

### `ChartsModal.jsx`
- 4 режима: `overall`, `rolling` (общо / по категории), `categories`, `pie`.
- Pie chart прагът се помни в `localStorage["pie_threshold"]`.
- Tooltip данните се сравняват по label + брой елементи (не `JSON.stringify`) — за
  производителност при 80+ категории.
- Тежките изчисления са в `setTimeout(50 ms)`, за да се покаже „⏳ Изчисляване…“
  преди блокиращата операция.
- `rollingMonths` се споделя с `MonthlyStats` през state в `App.jsx`.

### `MonthlyStats.jsx`
- `getWindowMonths` брои от **последния завършен** месец (`i = 0`), не от месеца
  преди него; текущият незавършен месец не влиза.
- Rolling avg тук е **фиксиран** прозорец (последните X завършени месеца от днес);
  в `ChartsModal` е **подвижен** прозорец за всеки месец в таблицата.
- `handleExport` показва „Няма данни за експорт“ за 3 сек при 0 транзакции.

### `SummaryCards.jsx`
- `totalPercent` различава изрично „лимит не е зададен“ (`null`), „лимит 0 без
  разходи“ (`0%`) и „лимит 0 с разходи“ (безкрайност) — общ лимит `0` не се третира
  като „няма лимит“.
- Категориен лимит `0` с разходи над него също се брои за надвишен (последователно
  с общия лимит).

### `BudgetModal.jsx`
- `handleSave` отхвърля отрицателни лимити и период с `fromDate > toDate`.
- Списъкът „Добави категория“ проверява за наличие на ключ, не за истинност на
  стойността (категория с още празен лимит не бива да остава в списъка).

### `ImportExportModal.jsx`
- `mode="export"` + активен филтър → предупреждение преди експорт; без филтър →
  директно генерира и затваря.
- `mode="import"` → file picker; при отказ модалът се затваря през `onCancel`
  (надеждно на iOS) + `handleFocusBack` (резервно за десктоп). Успешен импорт →
  стъпка „confirm“ с брой транзакции и предупреждение, че всичко ще бъде заменено.

### `MergeProfileModal.jsx` / `CopyTransactionsModal.jsx`
- И двата са тристъпкови (избор → дубликати → готово). Дубликати: дата + категория
  + тип + сума (разлика < 0.01), чекбоксите по подразбиране изключени.
- Всяка внесена/копирана транзакция получава **ново уникално id** (с пореден номер
  в партидата — виж §16, т. 74), за да не се губят записи при съвпадащи id.
- `MergeProfileModal` добавя новите категории от файла; `CopyTransactionsModal`
  **не** копира категории, само транзакции (чете директно от IndexedDB).

### `ProfileModal.jsx`
- `canClose` (по подразбиране `true`); `App.jsx` подава `profiles.length > 0`. При
  0 профила бутонът „×“ се скрива и се показва „Създайте първи профил…“.
- При преименуване — предупреждение, че облачните копия остават под старото име.

---

## 16. История на одитите и поправките (хронологично)

Този раздел обяснява **защо съществува** голяма част от нетривиалния код —
всяка точка описва поправен бъг или съзнателно решение, датирано по одити. Пренесено
и консолидирано от `Техническо_описание_20260719.docx`.

### Одит юли 2026 — цялостен преглед

- **25.** `App.jsx` — авто-качването (Drive/Облак) вече изчаква пълното зареждане
  на всички hooks (`profilesLoaded`, `transactionsLoaded`, `categoriesLoaded`,
  `filtersLoaded`, `currencyLoaded`) преди да провери skip-флага. Преди това
  отделните зареждания „изразходваха“ флага преждевременно и първата истинска
  промяна задействаше нежелано качване веднага след отваряне.
- **26.** `useCurrency.js`, `useBudgets.js` — добавена `cancelled` защита в
  зареждащия `useEffect` (както в `useTransactions`/`useCategories`): при много
  бърза смяна на профили закъсняло зареждане можеше да запише чужда
  валута/бюджети върху текущия профил.
- **27.** `useSupabaseStorage.js` — връзка с Облака изисква сесия **без**
  `provider_token` (`session?.user && !session?.provider_token`): вход през Google
  Drive докато Облакът е активен създаваше валидна сесия, която hook-ът грешно
  четеше като „още вписан в Облака“.
- **28.** `DateInput.jsx` — водещата нула се добавя само при напускане на цялата
  дата (`document.activeElement` в `setTimeout(…,0)`), не при преход между
  полетата — иначе двуцифрено число, започващо с „1“, не можеше да се въведе с
  пауза.
- **29.** `formatters.js` `isValidDate` — вече се ползва последователно за
  отхвърляне на **непълни** (не само невалидни) дати в `RecurringModal`,
  `BudgetModal`, `FilterBar`. Преди това непълна дата (само ден) минаваше мълчаливо
  и даваше повтарящи се транзакции, които никога не генерират чакащи, и
  бюджетни/филтърни периоди, които изглеждат зададени, но реално са неограничени.
- **30.** `App.jsx` — „Откажи“ в `showRestoreConfirm` вече чисти
  `conflictProfiles`, `conflictChoices`, `nameOnlyMatchIds` — иначе следващо
  възстановяване показваше остарели предупреждения и можеше тихо да приложи забравен
  избор.
- **31.** `App.jsx` — `showRestoreDuplicates` вече има бутон „Откажи“, който спира
  **цялото** възстановяване (преди единствената опция „Потвърди“ винаги добавяше
  поне уникалните транзакции).
- **32.** `App.jsx` — прозорецът „Изтриване на всички данни“ показва предупреждение,
  че Drive/Облакът няма да се обнови автоматично (auto-sync нарочно пропуска
  качване при 0 транзакции — защита срещу презапис на облака с празни данни).
- **33.** `App.jsx` — `showDataPanel` вече се пази в `localStorage`
  (`data_panel_open`): свързването с Google Drive пренасочва цялата страница и
  нулира React state, което иначе затваряше панела „Данни“ след всяко свързване.
- **34.** `UserGuideModal.jsx` — версия 1.9.0 → 1.9.1; секции 15 и 16 обновени.

### Одит 15.07.2026 — продължение

- **35.** `supabaseStorage.js` / `useSupabaseStorage.js` / `App.jsx` — качването и
  изтеглянето подават и `profileId` (последни 4 знака) в името на файла:
  транслитерацията кирилица→латиница може да даде съвпадащи имена за различни
  профили (напр. „Мария“ и „Maria“), при което единият презаписваше другия.
- **36.** `App.jsx` — `setLastSupabaseUploadDate` вече се вика и при двата авто
  режима (`onChange` и `daily`), не само при ръчно качване — иначе датата под
  бутона се обновяваше едва след презареждане.
- **37.** `googleDrive.js` — `escapeDriveQuery()` екранира `\` и `'` преди
  вграждане на името на профила в `q=name contains '…'` — апостроф (напр.
  „O'Brien“) чупеше заявката.
- **38.** `ProfileModal.jsx` / `App.jsx` — `canClose` prop; при 0 профила „×“ се
  скрива + пояснение „Създайте първи профил…“.
- **39.** `App.jsx` — при първо включване на брояча за напомняне
  (`last_backup_reminder_date` липсва) само се записва датата, без да се показва
  модалът веднага — нов потребител вече не получава напомняне веднага след първата
  транзакция.
- **40.** `App.jsx` — при „Не, пропусни ги“ за нови профили `restoreDoneType` ползва
  `choice: "skipped"` и диалогът показва „ℹ️ Профилите не бяха добавени.“ вместо
  „✅ … успешно“.
- **41.** `SummaryCards.jsx` — `totalPercent` различава `null` / `0%` / безкрайност
  (общ лимит „0“ не е „няма лимит“).
- **42.** `TransactionForm.jsx` — `categoriesWithCount` и `filteredCategories` в
  `useMemo` — иначе всяко натискане на клавиш обхождаше всички транзакции.
- **43.** Съзнателни решения без промяна в кода: (1) race condition при изтриване
  на профил + фонов запис — оставен; (2) няма частичен избор на нови профили при
  Restore; (3) няма масово изчистване на бюджетни лимити.

### Одит 16.07.2026 — бъгове 1–20 и нови функционалности

- **44.** `useTransactions.js` — `editTransaction` изгражда записа върху
  съществуващата транзакция (`{ ...t, ...updatedTransaction, id }`) —
  **КРИТИЧЕН**: формата не подава `profileId`, редактираната транзакция го губеше и
  изчезваше от списъка след презареждане (оставаше „осиротяла“ в IndexedDB).
  Еднократно почистване е направено с временен код, който после е премахнат.
- **45.** `useCurrency.js` / `useBudgets.js` / `useCategories.js` — добавен
  `loadedForProfileRef`: записващият `useEffect` пише само когато данните в паметта
  са именно за текущия `profileId` — иначе при смяна на профил за кратко записваше
  данните на стария под id-то на новия.
- **46.** `useRecurring.js` / `useSavedFilters.js` — `cancelled` защита в
  зареждащия `useEffect` (както `useTransactions`) — иначе бърза смяна на профили
  можеше да зареди чужди повтарящи се/филтри в текущия.
- **47.** **НОВО:** активният филтър се пази per-профил. Нов store `last_filter`
  (`keyPath id = profileId`); `DB_VERSION` 8 → 9. При смяна на профил филтърът се
  нулира, после се зарежда запазеният (с `lastFilterLoadedForRef` защита); запис с
  300 ms debounce; при изтриване на профил записът в `last_filter` се трие. „Изчисти
  филтър“ също се помни, включително през презареждане.
- **48.** `db.js` — `req.onblocked` handler с `alert`: при надграждане на схемата
  (8→9) стара версия в друг таб блокираше отварянето безкрайно и приложението
  изглеждаше празно без обяснение.
- **49.** `DateInput.jsx` — `buildValue` връща `""` при трите празни части (не
  `"//"`): фалшив „АКТИВЕН ФИЛТЪР“, невъзможност да се изчисти период на бюджет,
  невъзможност крайна дата на повтаряща се да се върне към „безкрайна“.
- **50.** `useTransactions.js` / `App.jsx` — `deleteTransactionsByCategory` и
  `reassignTransactionsCategory` вече приемат и филтрират по `type` —
  **КРИТИЧЕН БЪГ 20**: категории с еднакво име в разходи и приходи (напр. „Наем“,
  „Акции“, „P2P“) — изтриването на разходната изтриваше и приходните транзакции.
- **51.** `App.jsx` / `CategoryManager.jsx` — при „Запази като Без категория“
  категорията „Без категория“ се добавя автоматично в списъка на съответния тип —
  иначе преназначените транзакции не влизаха в Excel експорта и не се филтрираха.
  Опцията се скрива при изтриване на самата „Без категория“.
- **52.** `App.jsx` — auto-sync ефектите работят със **снимки** на данните
  (`driveSnapshotRef` / `supabaseSnapshotRef`) вместо с бинарни skip-флагове;
  `driveConnected` / `supabaseConnected` / `supabaseEnabled` са в зависимостите.
  Следствие: (а) „Веднъж дневно“ качва при първото отваряне за деня; (б) „При всяка
  промяна“ не губи първата промяна след отваряне. Снимката се нулира при смяна на
  профил. Прието ограничение: транзакция в първите ~1–2 сек след смяна на профил
  може да пропусне едно `onChange` качване.
- **53.** `db.js` + всички hooks + `App.jsx` — видимо уведомяване при провален
  запис в IndexedDB: `onDBWriteError(callback)` / `reportDBError()`; записващите
  функции викат `reportDBError()` в `error` клоновете; `App.jsx` показва червена
  лента „Проблем при запазване на данните…“. Преди провалите бяха само
  `console.error` и данните тихо се губеха.
- **54.** `TransactionForm.jsx` — смяна на тип по време на редакция изчиства
  категорията и търсенето (иначе транзакции с несъответстващи тип/категория).
- **55.** `PendingRecurringModal.jsx` — изрично `EUR` при „Променлива сума“.
- **56.** `BudgetModal.jsx` — `handleSave` отхвърля отрицателни лимити и обърнат
  период.
- **57.** `TransactionForm.jsx` — `savedStickyDateRef` се записва само ако е `null`
  (иначе редакция на втора транзакция при включено „Запази датата“ презаписваше
  запазената дата).
- **58.** `googleDrive.js` — `checkDriveResponse`: всеки fetch се проверява за
  `res.ok`; 401/403 → „Сесията е изтекла…“; иначе потокът продължаваше с `undefined
  folderId` и завършваше с подвеждащо „Грешка при качване“.
- **59.** `SummaryCards.jsx` — категориен лимит `0` с разходи над него се брои за
  надвишен (последователно с т. 41).
- **60.** `ImportExportModal.jsx` — експорт при 0 транзакции показва „Няма данни за
  експорт“ вместо празен файл.
- **61.** `MonthlyStats.jsx` — предупреждение при период за осредняване > 60 месеца
  (без твърд лимит).
- **62.** `useSupabaseStorage.js` — `connectWithEmail` ползва `setConnectedBoth(true)`
  (иначе `connectedRef` оставаше разсинхронизиран за кратко).
- **63.** `ProfileModal.jsx` — предупреждение при преименуване, че облачните копия
  остават под старото име (най-консервативно решение — само информиране).
- **64.** `index.html` — `lang="en"` → `lang="bg"`.
- **65.** Съзнателни особености: тесният прозорец от т. 52; т. 61 и т. 63 са
  решени с предупреждение, не с твърда мярка; лентата от т. 53 е само уведомление.

### Одит 17.07.2026

- **66.** `supabaseStorage.js` — `uploadBackupToSupabase`: новият файл се качва
  **първо** (upsert), старите се трият след успех — иначе прекъсване по средата
  оставяше облака без никакво копие.
- **67.** `App.jsx` — условието „спри авто-качване при 0 транзакции“ важи само при
  **точно един** профил; при повече профили auto-sync продължава (копието включва
  всички профили). Защитата срещу качване на изцяло празно копие (напр. след „Изтрий
  всички данни“ с един профил) е запазена.
- **68.** `App.jsx` `finishRestoreForProfile` — при „Обедини“ запазените филтри се
  **сливат** с локалните (както категориите и повтарящите се), не ги заместват.
- **69.** `App.jsx` — `completedRestoreProfilesRef`: финалното „Възстановяването е
  завършено“ изброява всички обработени профили, вкл. при поток с дубликати.
- **70.** `TransactionForm.jsx` — съобщението за успех при редакция показва `EUR`,
  когато полето за сума не е докоснато.
- **71.** `App.jsx` `buildBackupData` / `backup.js` `exportBackup` — `version`
  1.5 → 1.6 (форматът вече включва `profileCurrencies` и `profileBudgets`).
- **72.** `backup.js` / `excel.js` — `sanitizeFileName`: заменя `/ \ : * ? " < > |`
  в името на профила преди името на сваления файл (`.json` и `.xlsx`).
- **73.** Съзнателна особеност: полето „Категория“ продължава да изчиства избраната
  стойност при фокус — без риск (запис без категория се отхвърля от валидацията).

### Одит 19.07.2026 — цялост на данните

- **74.** `useTransactions.js` / `MergeProfileModal.jsx` / `CopyTransactionsModal.jsx`
  / `App.jsx` (`finishRestore`, `handleAddNewProfilesConfirm`) — id-тата на
  транзакции, добавяни на партиди, вече включват и пореден номер в партидата (както
  импорта от Excel). Преди уникалността разчиташе на 6 случайни знака с един и същ
  времеви печат — при голяма партида имаше реален шанс две транзакции да получат
  съвпадащо id и базата тихо запазваше само едната.
- **75.** `App.jsx` — предупреждение при едновременно отворено приложение в два
  раздела/прозореца (Web Locks API, `navigator.locks`): първото копие заема знак,
  всяко следващо вижда зает знак и показва оранжева лента. Записите в IndexedDB са
  пълна снимка, така че работа на две места можеше тихо да презапише промени. Без
  Web Locks (рядко) предупреждението просто не се показва.
- **76.** `DateInput.jsx` — при ден 29 / февруари полето за година допуска 29 дни,
  докато годината е непълна; проверката за високосна година — чак след пълно
  попълване (иначе `29/02/2024` тихо ставаше `28/02/2024`).
- **77.** `MonthlyStats.jsx` — `getWindowMonths` брои от последния завършен месец
  (`i = 0`), не от предходния (цикълът стартираше от `i = 1` и изключваше най-
  скорошния завършен месец).
- **78.** `BudgetModal.jsx` — списъкът „Добави категория“ проверява за наличие на
  ключ, не за истинност на стойността (козметично: категория с празен лимит
  оставаше в списъка).

### Одит 21.07.2026 — уведомяване за нова версия

- **79.** `vite.config.js` — `registerType` „autoUpdate“ → „prompt“;
  `injectRegister: false` — новата версия не се активира тихо.
- **80.** `App.jsx` — регистрация на service worker чрез `registerSW()` от
  `virtual:pwa-register`; при `onNeedRefresh` — синя лента „Налична е нова версия…“
  с бутон „Обнови“; `registration.update()` на всеки час. Механизмът засяга само кои
  JS/CSS файлове са активни — не пипа IndexedDB, Supabase, Google Drive или
  потребителски данни.
- **81.** `UserGuideModal.jsx` — версия 1.9.5 → 1.9.6; секция 1 обновена.

### След тази сесия (2026-09-07)

- **82.** `App.jsx` — добавен общ прозорец за изрично потвърждение (`confirmDialog`)
  за 6 чувствителни действия в раздел „Данни“; `UserGuideModal.jsx` — бележки в
  секции 15, 18, 19. Пълни подробности в §13.

---

## 17. Бърза карта на файловете

```
src/
  App.jsx                     # контейнер: state, модали, auto-sync, възстановяване, confirmDialog
  main.jsx                    # createRoot → <App />
  index.css                   # @import "tailwindcss" + фон/помощни класове
  constants/categories.js     # DEFAULT_*_CATEGORIES, sortCategories
  hooks/
    useProfiles.js            # профили + активен профил (localStorage)
    useTransactions.js        # транзакции (мулти-профилен store, debounce save)
    useCategories.js          # категории по профил (+ saveToDB, deleteProfileCategories)
    useBudgets.js             # бюджетни лимити по профил (+ deleteProfileBudgets)
    useCurrency.js            # валута/курс по профил (+ deleteProfileCurrency)
    useSavedFilters.js        # запазени филтри (+ deleteProfileSavedFilters)
    useRecurring.js           # повтарящи се транзакции + getPendingDates
    useGoogleDrive.js         # Google Drive връзка/качване/сваляне (OAuth през Supabase)
    useSupabaseStorage.js     # Облак: auth (имейл/парола) + Storage качване/сваляне
  utils/
    db.js                     # IndexedDB (finance_db v9), openDB, reportDBError
    backup.js                 # exportBackup / importBackup (.json, v1.6)
    formatters.js             # дати "DD/MM/YYYY", суми, помощници за месец
    excel.js                  # exportToExcel / importFromExcel / findDuplicates / exportMonthlyStatsToExcel
    supabase.js               # споделен Supabase клиент
    supabaseAuth.js           # signUp/signIn/signOut/getSession/resetPassword
    supabaseStorage.js        # bucket "finances-backup", именуване, upload/download
    googleDrive.js            # Drive API: папка, качване (PATCH/POST), сваляне
    crossServiceSwitch.js     # маркер за очаквано превключване Drive↔Облак
  components/                 # виж таблицата в §8
```
