import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Settings, Info, Upload, FileDown, Trash2, TrendingUp, ChevronDown, Search, BarChart2, AlertTriangle, User, RefreshCw } from "lucide-react";
import { useTransactions, copyWithNewIds } from "./hooks/useTransactions";
import { useCategories, deleteProfileCategories, saveToDB as saveCategoriesDirectly } from "./hooks/useCategories";
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES, sortCategories } from "./constants/categories";
import { deleteProfileBudgets } from "./hooks/useBudgets";
import { deleteProfileSavedFilters } from "./hooks/useSavedFilters";
import { deleteProfileCurrency, validCurrency } from "./hooks/useCurrency";
import { useProfiles } from "./hooks/useProfiles";
import { exportBackup, importBackup, validateAndMigrateBackup } from "./utils/backup";
import ProfileModal from "./components/ProfileModal";
import MergeProfileModal from "./components/MergeProfileModal";
import CopyTransactionsModal from "./components/CopyTransactionsModal";
import SummaryCards from "./components/SummaryCards";
import FilterBar from "./components/FilterBar";
import TransactionForm from "./components/TransactionForm";
import TransactionList from "./components/TransactionList";
import CategoryManager from "./components/CategoryManager";
import ImportExportModal from "./components/ImportExportModal";
import MonthlyStats from "./components/MonthlyStats";
import ChartsModal from "./components/ChartsModal";
import { useSavedFilters, isEmptyFilter } from "./hooks/useSavedFilters";
import { useCurrency } from "./hooks/useCurrency";
import { useBudgets } from "./hooks/useBudgets";
import BudgetModal from "./components/BudgetModal";
import RecurringModal from "./components/RecurringModal";
import PendingRecurringModal from "./components/PendingRecurringModal";
import { useRecurring } from "./hooks/useRecurring";
import UserGuideModal from "./components/UserGuideModal";
import RestoreLossModal from "./components/RestoreLossModal";
import { diffTransactions, diffRecords, diffCategories, diffBudgets, diffCurrency, hasRestoreLoss } from "./utils/restoreDiff";
import { useGoogleDrive } from "./hooks/useGoogleDrive";
import { useSupabaseStorage } from "./hooks/useSupabaseStorage";
import { openDB, onDBWriteError, runTx, reportDBError } from "./utils/db";
import { markExpectedServiceSwitch } from "./utils/crossServiceSwitch";
import { requestPersistentStorage, getStorageUsage, formatBytes, STORAGE_WARN_RATIO } from "./utils/storageInfo";
import { registerSW } from "virtual:pwa-register";
import { getTodayString } from "./utils/formatters";
import { linkCategories, applyCategorySpelling } from "./utils/categoryMatch";

// Записите на един профил от store. При грешка или прекъсната транзакция отхвърля, вместо да
// виси завинаги (одит 2026-10, 1А-05)
const getProfileRecords = async (storeName, profileId) =>
  ((await runTx(storeName, "readonly", (store) => store.getAll())) || []).filter((r) => r.profileId === profileId);

// Повтарящи се и филтри при възстановяване (одит 2026-10, 1А-07/2А-03, 2А-04, 2А-17).
// Ключ по съдържание: повтарящите се — и по тип (иначе приход „Наем“ се смяташе за дубликат на разход „Наем“)
const recurringKey = (r) => [r.type, r.description, r.category, r.period].join("|");
const filterKey = (f) => [f.name, f.fromDate, f.toDate].join("|");
// „Обедини“: локалните + тези от копието, които ги няма на устройството — първо по id (същият запис,
// редактиран след свалянето на копието: печели локалната версия, вместо копието да я презапише и да
// върне по-стар lastAdded), после по съдържание
const mergeByIdAndKey = (local, fromBackup, key) => {
  const ids = new Set(local.map((r) => r.id));
  const keys = new Set(local.map(key));
  return [...local, ...fromBackup.filter((r) => !ids.has(r.id) && !keys.has(key(r)))];
};
// dd/mm/yyyy → yyyymmdd за сравнение; липсваща дата е най-ранна
const dateKey = (d) => (typeof d === "string" ? d.split("/").reverse().join("") : "");
// „Обедини“ за повтарящи се: при същия id остават локалните описание, сума, период…, но датата на
// последно добавяне е по-късната от двете — иначе дата, вече добавена на друго устройство, пак ще е
// „чакаща“. Връща и кои записи са получили датата от копието (за обобщението)
const mergeRecurring = (local, fromBackup) => {
  const backupById = new Map(fromBackup.map((r) => [r.id, r]));
  const newerDates = [];
  const kept = local.map((r) => {
    const b = backupById.get(r.id);
    if (!b || dateKey(b.lastAdded) <= dateKey(r.lastAdded)) return r;
    newerDates.push({ name: r.description || r.category, local: r.lastAdded, backup: b.lastAdded });
    return { ...r, lastAdded: b.lastAdded };
  });
  return { items: mergeByIdAndKey(kept, fromBackup, recurringKey), newerDates };
};
// Запис от копието с id, който на устройството е на ДРУГ профил, би го презаписал (запис по id) →
// получава нов id; иначе id-то се пази, за да познае следващото „Обедини“ същия запис
const withFreeIds = async (storeName, profileId, records, prefix) => {
  const all = (await runTx(storeName, "readonly", (store) => store.getAll())) || [];
  const taken = new Set(all.filter((r) => r.profileId !== profileId).map((r) => r.id));
  let n = 0;
  return records.map((r) => {
    if (!taken.has(r.id)) return r;
    let id;
    do { id = `${prefix}${Date.now()}_${++n}`; } while (taken.has(id));
    taken.add(id);
    return { ...r, id };
  });
};

// Провален запис спира възстановяването, вместо то да завърши с „успешно“ (одит 2026-10, 2А-01)
const ensureSaved = (ok) => {
  if (ok === false) throw new Error("Записът в базата не успя.");
};

// Резервното копие се прави цяло или изобщо не (одит 2026-10, 7-02)
const BACKUP_READ_ERROR = "Данните на устройството не могат да бъдат прочетени — резервното копие не е направено.";
const BACKUP_STORES = ["categories", "transactions", "saved_filters", "recurring", "currency", "budgets"];
const autoUploadReadError = (where) =>
  `⚠️ Автоматичното качване в ${where} не беше направено: данните на устройството не могат да бъдат прочетени.`;

const App = () => {
  const {
    profiles,
    activeProfileId,
    activeProfile,
    isLoaded: profilesLoaded,
    createProfile,
    switchProfile,
    deleteProfile,
    renameProfile,
    addOrUpdateProfile,
  } = useProfiles();
  const {
    transactions,
    isLoaded: transactionsLoaded,
    addTransaction,
    editTransaction,
    deleteTransaction,
    deleteTransactionsByCategory,
    renameTransactionsCategory,
    replaceAllTransactions,
    addTransactions,
    getFilteredTransactions,
    getSummary,
    deleteAllTransactionsByProfile,
  } = useTransactions(activeProfileId);

  const {
    expenseCategories,
    incomeCategories,
    isLoaded: categoriesLoaded,
    addCategory,
    editCategory,
    deleteCategory,
    addCategoriesFromImport,
    setExpenseCategoriesFromBackup,
    setIncomeCategoriesFromBackup,
  } = useCategories(activeProfileId);
  const { savedFilters, saveFilter, deleteFilter, restoreFilters, renameCategoryKey, removeCategoryKey, setSavedFilters, isLoaded: filtersLoaded } = useSavedFilters(activeProfileId);
  const { currency, rate, updateCurrency, resetToEur, convert, isLoaded: currencyLoaded, restoreCurrency } = useCurrency(activeProfileId);
  const { budgets, updateBudgets, restoreBudgets, isLoaded: budgetsLoaded } = useBudgets(activeProfileId);
  const {
    recurringItems,
    addRecurring,
    editRecurring,
    deleteRecurring,
    renameCategory: renameRecurringCategory,
    markAsAdded,
    deleteAllByProfile: deleteAllRecurringByProfile,
    restoreRecurring,
    getPendingTransactions,
    isLoaded: recurringLoaded,
  } = useRecurring(activeProfileId);

  const [editingTransaction, setEditingTransaction] = useState(null);
  const [filters, setFilters] = useState({ fromDate: "", toDate: "", categories: [], description: "" });
  const [activeFilters, setActiveFilters] = useState({ fromDate: "", toDate: "", categories: [], description: "" });
  const [isFiltered, setIsFiltered] = useState(false);
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [showImportExport, setShowImportExport] = useState(false);
  const [importExportMode, setImportExportMode] = useState(null);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [pendingBackup, setPendingBackup] = useState(null);
  const [cloudBackupChoices, setCloudBackupChoices] = useState(null);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [showMonthlyStats, setShowMonthlyStats] = useState(false);
  const [showCharts, setShowCharts] = useState(false);
  const [rollingMonths, setRollingMonths] = useState(12);
  const [showBudget, setShowBudget] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [showRecurringModal, setShowRecurringModal] = useState(false);
  const [showPendingModal, setShowPendingModal] = useState(false);
  const [pendingRecurring, setPendingRecurring] = useState([]);
  const [showDataPanel, setShowDataPanel] = useState(
    () => localStorage.getItem("data_panel_open") === "true"
  );
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [showWeeklyBackup, setShowWeeklyBackup] = useState(false);
  const [showUserGuide, setShowUserGuide] = useState(false);
  // Общ прозорец за изрично потвърждение преди чувствителни действия в раздел "Данни".
  // Форма: { title, message, confirmLabel, tone: "danger" | "warning", onConfirm, onCancel? }
  const [confirmDialog, setConfirmDialog] = useState(null);
  // Модален прозорец, който напомня, че свързването само по себе си не включва
  // автоматично качване (по подразбиране е изключено) — за да не се пропусне.
  const [autoUploadNotice, setAutoUploadNotice] = useState(null); // 'drive' | 'supabase' | null
  const [showRestoreDone, setShowRestoreDone] = useState(false);
  const [restoreDoneType, setRestoreDoneType] = useState([]);
  // Откъде е текущото възстановяване — за заглавието на прозореца в края (одит 2026-10, 2А-18)
  const [restoreSource, setRestoreSource] = useState("file"); // 'file' | 'drive' | 'supabase'
  // Възстановяването спря поради грешка: { done: [{ name, choice }], partial: име | null } (одит 2026-10, 2А-01)
  const [restoreError, setRestoreError] = useState(null);
  // Възстановяването записва в момента: екранът е блокиран, чакащите повтарящи се изчакват (одит 2026-10, 2Б-01)
  const [restoreInProgress, setRestoreInProgress] = useState(false);
  // Какво ще изчезне или ще се промени при „Замести“ — прозорецът преди записа (одит 2026-10, 3-16)
  const [restoreLossReport, setRestoreLossReport] = useState(null);
  const [conflictProfiles, setConflictProfiles] = useState([]);
  const [conflictChoices, setConflictChoices] = useState({});
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [showRestoreDuplicates, setShowRestoreDuplicates] = useState(false);
  const [restoreDuplicates, setRestoreDuplicates] = useState([]);
  const [restoreUniqueTransactions, setRestoreUniqueTransactions] = useState([]);
  const [restoreSelectedDuplicates, setRestoreSelectedDuplicates] = useState([]);
  const [pendingNewProfiles, setPendingNewProfiles] = useState([]);
  const [addNewProfiles, setAddNewProfiles] = useState(null);
  const [showAddNewProfilesConfirm, setShowAddNewProfilesConfirm] = useState(false);
  const [pendingMergeProfileId, setPendingMergeProfileId] = useState(null);
  const [localTransactionCounts, setLocalTransactionCounts] = useState({});
  const [pendingRemainingProfiles, setPendingRemainingProfiles] = useState([]);
  const [nameOnlyMatchIds, setNameOnlyMatchIds] = useState([]);
  const [restoreBackupNames, setRestoreBackupNames] = useState({}); // id → името в копието, когато е различно от локалното
  const [showCrossServiceWarning, setShowCrossServiceWarning] = useState(null); // 'toDrive' | 'toSupabase' | null
  const [backupReminderInterval, setBackupReminderInterval] = useState(
    () => localStorage.getItem("backup_reminder_interval") ?? "weekly"
  );
  const [lastLocalBackupDate, setLastLocalBackupDate] = useState(
    () => localStorage.getItem("last_local_backup_date") ?? null
  );
  const {
    connected: driveConnected,
    needsReconnect: driveNeedsReconnect,
    hasToken: driveHasToken,
    promptReconnect: drivePromptReconnect,
    autoSync: driveAutoSync,
    uploadLoading: driveUploadLoading,
    downloadLoading: driveDownloadLoading,
    message: driveMessage,
    setMessage: driveSetMessage,
    connect: driveConnect,
    disconnect: driveDisconnect,
    toggleAutoSync: driveToggleAutoSync,
    uploadBackup: driveUploadBackup,
    listBackups: driveListBackups,
    downloadBackup: driveDownloadBackup,
    shouldRunDaily: driveShouldRunDaily,
    markDailyDone: driveMarkDailyDone,
  } = useGoogleDrive();
  const {
    connected: supabaseConnected,
    autoSync: supabaseAutoSync,
    uploadLoading: supabaseUploadLoading,
    downloadLoading: supabaseDownloadLoading,
    message: supabaseMessage,
    setMessage: supabaseSetMessage,
    enabled: supabaseEnabled,
    enable: supabaseEnable,
    disable: supabaseDisable,
    authMode: supabaseAuthMode,
    setAuthMode: supabaseSetAuthMode,
    authEmail: supabaseAuthEmail,
    setAuthEmail: supabaseSetAuthEmail,
    authPassword: supabaseAuthPassword,
    setAuthPassword: supabaseSetAuthPassword,
    authLoading: supabaseAuthLoading,
    authError: supabaseAuthError,
    setAuthError: supabaseSetAuthError,
    connectWithEmail: supabaseConnectWithEmail,
    disconnectSupabase: supabaseDisconnect,
    resetLoading: supabaseResetLoading,
    showReset: supabaseShowReset,
    setShowReset: supabaseSetShowReset,
    resetEmail: supabaseResetEmail,
    setResetEmail: supabaseSetResetEmail,
    sendResetEmail: supabaseSendResetEmail,
    showNewPassword: supabaseShowNewPassword,
    setShowNewPassword: supabaseSetShowNewPassword,
    newPassword: supabaseNewPassword,
    setNewPassword: supabaseSetNewPassword,
    newPasswordLoading: supabaseNewPasswordLoading,
    updatePassword: supabaseUpdatePassword,
    toggleAutoSync: supabaseToggleAutoSync,
    uploadBackup: supabaseUploadBackup,
    listBackups: supabaseListBackups,
    downloadBackup: supabaseDownloadBackup,
    shouldRunDaily: supabaseShouldRunDaily,
    markDailyDone: supabaseMarkDailyDone,
  } = useSupabaseStorage();

    
  const [lastSupabaseUploadDate, setLastSupabaseUploadDate] = useState(
    () => localStorage.getItem("last_supabase_upload_date") ?? null
  );
  
  useEffect(() => {
    if (!profilesLoaded) return;
    if (profiles.length === 0) {
      setShowProfileModal(true);
    }
  }, [profilesLoaded, profiles.length]);
  // Днешната дата към последното връщане на приложението на преден план. PWA може да стои отворено
  // с дни — при нов ден проверката за чакащи се прави наново, без презареждане (одит 2026-10, 1Б-03)
  const [pendingCheckDay, setPendingCheckDay] = useState(getTodayString);
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") setPendingCheckDay(getTodayString());
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);
  // Брояч на връщанията на интернета — авто-качването пробва наново некачените промени (3-08)
  const [onlineCount, setOnlineCount] = useState(0);
  useEffect(() => {
    const onOnline = () => setOnlineCount((n) => n + 1);
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);
  // „Затвори“/„×“ на чакащите само отлагат (одит 2026-10, 4-07): профил → { day, ids } — деня на проверката
  // (pendingCheckDay) и повтарящите се, които са били чакащи. Ефектът не ги предлага отново до нов ден
  // или до нова повтаряща се с чакаща дата; не се пази — презареждането го изчиства
  const [pendingSnoozed, setPendingSnoozed] = useState({});
  // Отворен е блокиращ прозорец (без чакащите и напомнянето за копие): чакащите изчакват затварянето му,
  // напомнянето за копие — също. Автоматичните прозорци за състояние (autoUploadNotice, съобщенията
  // на Drive/Облака) са над всички с z-index и не се броят (одит 2026-10, 6-09)
  const otherModalOpen = !!(
    showRecurringModal || showConflictModal || showRestoreConfirm || showRestoreDuplicates ||
    showAddNewProfilesConfirm || restoreInProgress || restoreLossReport || cloudBackupChoices || showDeleteAll ||
    confirmDialog || showProfileModal || showBudget || showCategoryManager || showImportExport ||
    showCharts || showMonthlyStats || showUserGuide || showMergeModal || showCopyModal ||
    showRestoreDone || restoreError || showCrossServiceWarning
  );
  // Напомнянето за копие се вижда само когато няма друг отворен прозорец; иначе остава „на опашка“ и
  // излиза след затварянето му, а датата на последното напомняне се записва чак при показването
  const weeklyBackupVisible = showWeeklyBackup && !showPendingModal && !otherModalOpen;
  useEffect(() => {
    if (weeklyBackupVisible) localStorage.setItem("last_backup_reminder_date", new Date().toISOString());
  }, [weeklyBackupVisible]);
  useEffect(() => {
    // Само със списъка на текущия профил — иначе след смяна се предлагат чакащите на предишния (1А-02)
    if (!activeProfileId || !recurringLoaded || recurringItems.length === 0) return;
    if (showPendingModal || weeklyBackupVisible || otherModalOpen) return;
    const pending = getPendingTransactions();
    // Отложени с „Затвори“ за този профил и ден — пак се предлагат само ако има чакаща от нова повтаряща се
    const snoozed = pendingSnoozed[activeProfileId];
    if (snoozed && snoozed.day === pendingCheckDay && pending.every((p) => snoozed.ids.includes(p.recurringId))) return;
    if (pending.length > 0) {
      setPendingRecurring(pending);
      setShowPendingModal(true);
    }
  }, [activeProfileId, recurringLoaded, recurringItems, pendingCheckDay, otherModalOpen, weeklyBackupVisible, pendingSnoozed]);
  const driveSnapshotRef = useRef(null);
  const supabaseSnapshotRef = useRef(null);
  // Пауза на авто-качването след „Не качвай“ в пазача за рязък спад (до следващо отваряне)
  const autoUploadPausedRef = useRef({ drive: false, supabase: false });
  // Възстановяването течеше при предишното изпълнение на ефекта за авто-качване — промените от него
  // не се качват сами, а след прозореца „…е завършено“ се пита (одит 2026-10, 2А-09)
  const autoUploadRestoringRef = useRef({ drive: false, supabase: false });
  // Услугите с „При всяка промяна“, за които да се пита след прозореца „…е завършено“, или null
  const restoreUploadAskRef = useRef(null);
  // Профилите с некачени промени отпреди възстановяването, по услуга — влизат в този въпрос (3-08б)
  const restoreUnsyncedRef = useRef({ drive: [], supabase: [] });
  // „Не качвай“ след възстановяване: авто-качването към услугата спира до следващо отваряне
  // или успешно ръчно качване (2А-09)
  const autoUploadStoppedRef = useRef({ drive: false, supabase: false });
  // Качванията към една услуга вървят едно след друго, за да не завърши по-старо копие след
  // по-новото и да не се създадат две папки в Drive при първо качване (одит 2026-10, 3-07)
  const uploadQueueRef = useRef({ drive: Promise.resolve(), supabase: Promise.resolve() });
  // Пореден номер на последното поискано качване към услугата (виж uploadToDrive)
  const uploadSeqRef = useRef({ drive: 0, supabase: 0 });
  // Копие от buildBackupData → кога е започнало четенето му (виж clearUnsynced)
  const backupReadAtRef = useRef(new WeakMap());
  const confirmDialogRef = useRef(null);
  const backupFileRef = useRef(null);
  const pendingNewProfilesRef = useRef([]);
  const completedRestoreProfilesRef = useRef([]);
  // Профилът, който се възстановява в момента — при грешка той е приложен частично
  const restoreCurrentProfileRef = useRef(null);
  // Отговорите за „Обедини“ профилите: id → транзакции за добавяне (записват се накрая, одит 2026-10, 2А-08)
  const restoreMergePlanRef = useRef({});
  // Синхронна защита от двойно натискане (state се обновява чак при следващия рендер) (одит 2026-10, 2А-10)
  const restoreBusyRef = useRef(false);
  // Същото за „Добави избраните“ / „Затвори“ на чакащите (1Б-02)
  const pendingConfirmBusyRef = useRef(false);

  const filteredTransactions = useMemo(
    () => getFilteredTransactions(activeFilters),
    [activeFilters, getFilteredTransactions]
  );
  const summary = useMemo(
    () => getSummary(filteredTransactions),
    [filteredTransactions, getSummary]
  );
  useEffect(() => {
    driveSnapshotRef.current = null;
    supabaseSnapshotRef.current = null;
  }, [activeProfileId]);
  const lastFilterLoadedForRef = useRef(null);
  useEffect(() => {
    let cancelled = false;
    lastFilterLoadedForRef.current = null;
    setFilters({ fromDate: "", toDate: "", categories: [], description: "" });
    setActiveFilters({ fromDate: "", toDate: "", categories: [], description: "" });
    setIsFiltered(false);
    if (!activeProfileId) return;
    (async () => {
      try {
        const db = await openDB();
        const saved = await new Promise((resolve) => {
          const tx = db.transaction("last_filter", "readonly");
          const req = tx.objectStore("last_filter").get(activeProfileId);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => resolve(null);
        });
        if (cancelled) return;
        if (saved) {
          const f = {
            fromDate: saved.fromDate || "",
            toDate: saved.toDate || "",
            categories: saved.categories || [],
            description: saved.description || "",
          };
          setFilters(f);
          setActiveFilters(f);
          setIsFiltered(!!(f.fromDate || f.toDate || f.categories.length > 0 || f.description.trim()));
        }
        lastFilterLoadedForRef.current = activeProfileId;
      } catch {
        if (!cancelled) lastFilterLoadedForRef.current = activeProfileId;
      }
    })();
    return () => { cancelled = true; };
  }, [activeProfileId]);
  useEffect(() => {
    if (!activeProfileId || lastFilterLoadedForRef.current !== activeProfileId) return;
    const timer = setTimeout(async () => {
      try {
        const db = await openDB();
        const tx = db.transaction("last_filter", "readwrite");
        tx.objectStore("last_filter").put({ id: activeProfileId, ...activeFilters });
      } catch { /* тих провал — филтърът е удобство, не критични данни */ }
    }, 300);
    return () => clearTimeout(timer);
  }, [activeFilters, activeProfileId]);
  useEffect(() => {
    localStorage.setItem("data_panel_open", String(showDataPanel));
  }, [showDataPanel]);
  // false | "quota" (няма място на устройството) | "other"
  const [dbWriteError, setDbWriteError] = useState(false);
  useEffect(() => {
    // "quota" не се заменя с "other" от следваща грешка, докато лентата е отворена
    onDBWriteError(({ quota } = {}) => setDbWriteError((prev) => (quota ? "quota" : prev || "other")));
  }, []);
  // Памет на устройството (Б2а): при стартиране искаме постоянно хранилище (браузърът да не
  // изтрива данните сам при недостиг на място); заетото място се чете, когато панелът „Данни“ е отворен.
  useEffect(() => {
    requestPersistentStorage();
  }, []);
  const [storageUsage, setStorageUsage] = useState(null);
  useEffect(() => {
    if (!showDataPanel) return;
    let cancelled = false;
    getStorageUsage().then((u) => { if (!cancelled) setStorageUsage(u); });
    return () => { cancelled = true; };
  }, [showDataPanel]);
  // Проверка за нова версия на приложението (Service Worker)
  const [showUpdateAvailable, setShowUpdateAvailable] = useState(false);
  const updateSWRef = useRef(null);
  useEffect(() => {
    updateSWRef.current = registerSW({
      immediate: true,
      onNeedRefresh() {
        setShowUpdateAvailable(true);
      },
      onRegisteredSW(swUrl, registration) {
        if (!registration) return;
        setInterval(() => {
          registration.update().catch(() => {});
        }, 60 * 60 * 1000);
      },
    });
  }, []);
  // Предупреждение при второ отворено копие на приложението (друг раздел/прозорец):
  // едновременната работа на две места може тихо да губи данни, защото всяко копие
  // записва в IndexedDB своята пълна снимка на транзакциите
  const [multiTabWarning, setMultiTabWarning] = useState(false);
  // Банерите горе са един общ стек (червен, оранжев, син); височината му е в --banner-h, а страницата,
  // прозорците и тостовете започват под него (index.css) — одит 2026-10, 6-01
  const bannersVisible = multiTabWarning || !!dbWriteError || showUpdateAvailable;
  const bannerStackRef = useRef(null);
  useEffect(() => {
    const root = document.documentElement;
    const el = bannerStackRef.current;
    if (!bannersVisible || !el) return undefined;
    const update = () => root.style.setProperty("--banner-h", `${el.offsetHeight}px`);
    update();
    root.setAttribute("data-banners", "");
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.removeAttribute("data-banners");
      root.style.setProperty("--banner-h", "0px");
    };
  }, [bannersVisible]);
  useEffect(() => {
    if (!navigator.locks) return;
    let releaseLock;
    const heldWhileOpen = new Promise((resolve) => { releaseLock = resolve; });
    navigator.locks
      .request("finance_app_open_tab", { ifAvailable: true }, (lock) => {
        if (!lock) {
          setMultiTabWarning(true);
          return;
        }
        return heldWhileOpen; // заключването се пази докато табът е отворен
      })
      .catch(() => { /* тихо — само предупреждение, не блокира работата */ });
    return () => releaseLock();
  }, []);

  // Пазач при рязък спад: броят транзакции по профил при последното успешно качване се пази
  // отделно за всяка услуга. Спад до 0 или с над 50% (при поне 10 преди) → въпрос преди качване.
  const UPLOAD_COUNTS_KEYS = { drive: "drive_last_upload_counts", supabase: "supabase_last_upload_counts" };
  const UPLOAD_SERVICE_LABELS = { drive: "Google Drive", supabase: "Облака" };

  const countTransactionsByProfile = (backup) => {
    const counts = {};
    (backup.profiles || []).forEach((p) => { counts[p.id] = 0; });
    (backup.transactions || []).forEach((t) => {
      if (t.profileId in counts) counts[t.profileId]++;
    });
    return counts;
  };

  // Връща { name, prev, now } за първия профил с рязък спад или null. Изтрити профили не се броят.
  const findUploadDrop = (service, backup) => {
    let prevCounts = null;
    try {
      prevCounts = JSON.parse(localStorage.getItem(UPLOAD_COUNTS_KEYS[service]) || "null");
    } catch {
      prevCounts = null;
    }
    if (!prevCounts) return null;
    const counts = countTransactionsByProfile(backup);
    for (const p of backup.profiles || []) {
      const prev = prevCounts[p.id];
      const now = counts[p.id];
      if (!prev) continue;
      if (now === 0 || (prev >= 10 && now < prev * 0.5)) return { name: p.name, prev, now };
    }
    return null;
  };

  const saveUploadCounts = (service, backup) => {
    try {
      localStorage.setItem(UPLOAD_COUNTS_KEYS[service], JSON.stringify(countTransactionsByProfile(backup)));
    } catch {
      // без запис пазачът просто няма с какво да сравни следващия път
    }
  };

  const uploadDropMessage = (service, drop) =>
    `Транзакциите на профил „${drop.name}“ са намалели от ${drop.prev} на ${drop.now} спрямо последното качване в ${UPLOAD_SERVICE_LABELS[service]}. Да кача ли това копие? По-старите копия се пазят.`;

  // След „Изтрий всички данни“ профилът се отбелязва за всяка услуга с броя транзакции преди
  // изтриването. Докато профилът има по-малко транзакции от тогава, качването (авто и ръчно)
  // пита — независимо от пазача. Белезите на услугата се махат след успешно качване в нея.
  const DELETED_ALL_KEYS = { drive: "drive_deleted_all_profiles", supabase: "supabase_deleted_all_profiles" };

  const markDeletedAll = (profileId, count) => {
    if (!profileId || !count) return;
    Object.values(DELETED_ALL_KEYS).forEach((key) => {
      try {
        const marks = JSON.parse(localStorage.getItem(key) || "{}");
        marks[profileId] = Math.max(marks[profileId] || 0, count);
        localStorage.setItem(key, JSON.stringify(marks));
      } catch {
        // без белег остава само пазачът при рязък спад
      }
    });
  };

  const clearDeletedAll = (service) => {
    try {
      localStorage.removeItem(DELETED_ALL_KEYS[service]);
    } catch {
      // белегът ще накара следващото качване да попита пак
    }
  };

  // Връща { name, before, now } за първия отбелязан профил, който още има по-малко транзакции, или null
  const findDeletedAll = (service, backup) => {
    let marks = null;
    try {
      marks = JSON.parse(localStorage.getItem(DELETED_ALL_KEYS[service]) || "null");
    } catch {
      marks = null;
    }
    if (!marks) return null;
    const counts = countTransactionsByProfile(backup);
    for (const p of backup.profiles || []) {
      const before = marks[p.id];
      if (before && counts[p.id] < before) return { name: p.name, before, now: counts[p.id] };
    }
    return null;
  };

  const deletedAllMessage = (service, deleted) =>
    `След „Изтрий всички данни“ профил „${deleted.name}“ има ${deleted.now} ${deleted.now === 1 ? "транзакция" : "транзакции"} (преди изтриването: ${deleted.before}). Да кача ли това копие в ${UPLOAD_SERVICE_LABELS[service]}? По-старите копия се пазят.`;

  // Първо качване от това устройство: няма дата на последно качване, няма брой транзакции от
  // пазача и не е отговорено „Възстанови“ на въпроса за съществуващо копие. Тогава преди
  // качването се проверява дали в облака вече има копие на профила (напр. от старо устройство).
  const LAST_UPLOAD_DATE_KEYS = { drive: "last_drive_upload_date", supabase: "last_supabase_upload_date" };
  const EXISTING_COPY_ANSWERED_KEYS = { drive: "drive_existing_copy_answered", supabase: "supabase_existing_copy_answered" };

  const isFirstUploadFromDevice = (service) => {
    try {
      return !localStorage.getItem(LAST_UPLOAD_DATE_KEYS[service])
        && !localStorage.getItem(UPLOAD_COUNTS_KEYS[service])
        && !localStorage.getItem(EXISTING_COPY_ANSWERED_KEYS[service]);
    } catch {
      return false;
    }
  };

  // „При всяка промяна“: профил → часът на последната му промяна, която още не е качена в услугата.
  // Пази се в localStorage, за да се качи при отваряне, при свързване и при връщане на интернета —
  // иначе промяна без връзка (или с провалено/пропуснато качване) не се качва до следващата (одит 2026-10, 3-08).
  // Всеки профил има свой файл в облака: промени в един профил, а после смяна на друг, качват копието
  // и във файла на първия, не само на отворения (3-08б)
  const UNSYNCED_KEYS = { drive: "drive_unsynced_change_at", supabase: "supabase_unsynced_change_at" };

  const readUnsynced = (service) => {
    try {
      const marks = JSON.parse(localStorage.getItem(UNSYNCED_KEYS[service]) || "null");
      // до 3-08б белегът беше само час, без профил — приема се за отворения
      if (typeof marks === "number") return activeProfileId ? { [activeProfileId]: marks } : {};
      return marks && typeof marks === "object" ? marks : {};
    } catch {
      return {};
    }
  };

  const writeUnsynced = (service, marks) => {
    try {
      if (Object.keys(marks).length > 0) localStorage.setItem(UNSYNCED_KEYS[service], JSON.stringify(marks));
      else localStorage.removeItem(UNSYNCED_KEYS[service]);
    } catch {
      // без запис промяната се качва при следващата (както преди)
    }
  };

  // Белезите на изтрити профили се забравят тук — извиква се от ефекта, с актуалния списък профили
  const markUnsynced = (service, profileId) => {
    if (!profileId) return;
    const marks = { ...readUnsynced(service), [profileId]: Date.now() };
    writeUnsynced(service, Object.fromEntries(Object.entries(marks).filter(([id]) => profiles.some((p) => p.id === id))));
  };

  // Профилите, в чиито файлове да се качи копието: всички с некачени промени, отвореният — първи.
  // changedId — профил с промяна точно сега (и ако белегът не се е записал)
  const unsyncedProfiles = (service, changedId = null) => {
    const marks = readUnsynced(service);
    return profiles
      .filter((p) => p.id in marks || p.id === changedId)
      .sort((a, b) => (b.id === activeProfileId) - (a.id === activeProfileId));
  };

  // След успешно качване белегът на профила се маха, само ако копието е прочетено след последната му промяна
  const clearUnsynced = (service, backup, profileId) => {
    const readAt = backupReadAtRef.current.get(backup);
    if (!readAt) return;
    const marks = readUnsynced(service);
    if (!(profileId in marks) || marks[profileId] > readAt) return;
    delete marks[profileId];
    writeUnsynced(service, marks);
  };

  // Маха всички белези на услугата и връща профилите, които са имали некачени промени
  const takeUnsynced = (service) => {
    const ids = unsyncedProfiles(service).map((p) => p.id);
    try {
      localStorage.removeItem(UNSYNCED_KEYS[service]);
    } catch {
      // белегът остава — ще се качи при следващото отваряне
    }
    return ids;
  };

  // Пуска job след предишното качване към услугата (виж uploadQueueRef). Увиснала заявка не
  // спира следващите завинаги — след UPLOAD_WAIT_MS се продължава без нея.
  const UPLOAD_WAIT_MS = 60 * 1000;
  const runInUploadQueue = (service, job) => {
    const prev = uploadQueueRef.current[service];
    const run = Promise.race([prev, new Promise((resolve) => setTimeout(resolve, UPLOAD_WAIT_MS))]).then(job);
    uploadQueueRef.current[service] = run.catch(() => {});
    return run;
  };

  // Копията на профила в облака ([] ако няма) или null при грешка (съобщението вече е показано).
  // В опашката на качванията: в Drive търсенето създава папката, ако я няма.
  // auto — при авто-качване липсата на мрежа не се показва (3-10).
  const listCopiesBeforeUpload = (service, profileName, profileId, { auto = false } = {}) =>
    runInUploadQueue(service, () => service === "drive"
      ? driveListBackups(profileName, { beforeUpload: true, auto })
      : supabaseListBackups(profileName, profileId, { beforeUpload: true, auto }));

  const existingCopyDialog = ({ service, copies, backup, profileName, profileId, doUpload, auto }) => {
    const isToday = (iso) => iso && new Date(iso).toDateString() === new Date().toDateString();
    const latest = copies[0]?.updatedAt
      ? new Date(copies[0].updatedAt).toLocaleDateString("bg-BG", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
      : null;
    // Днешното копие се презаписва (Облак — само ако е от същия профил, т.е. същия id)
    const replacesToday = copies.some((c) => isToday(c.updatedAt) && (service === "drive" || c.isSameProfile));
    const where = service === "drive" ? "В Google Drive" : "В Облака";
    const count = countTransactionsByProfile(backup)[profileId] ?? 0;
    return {
      title: auto ? "Автоматичното качване чака" : `${where} вече има копие`,
      message:
        `${where} има ${copies.length === 1 ? "резервно копие" : `${copies.length} резервни копия`} на профил „${profileName}“${latest ? ` (последно от ${latest})` : ""}, а от това устройство още не е качвано. ` +
        "Ако сте на ново устройство, първо възстановете данните. " +
        `„Качи все пак“ качва данните от това устройство (${count} ${count === 1 ? "транзакция" : "транзакции"} на профила)` +
        (replacesToday ? " и заменя днешното копие в облака" : "") +
        "; по-старите копия се пазят.",
      confirmLabel: "Възстанови",
      onConfirm: () => {
        try {
          localStorage.setItem(EXISTING_COPY_ANSWERED_KEYS[service], new Date().toISOString());
        } catch {
          // без запис въпросът просто ще се появи пак при следващото качване
        }
        autoUploadPausedRef.current[service] = false;
      },
      restoreFrom: service, // след onConfirm прозорецът пуска restoreFromCloud(service)
      extraLabel: "Качи все пак",
      onExtra: doUpload,
      cancelLabel: auto ? "Не качвай" : "Откажи",
      tone: "warning",
    };
  };

  // Качването чака предишното към същата услуга. batchSeq — авто-качване „При всяка промяна“ (виж
  // uploadEachProfile): ако докато чака, е поискано друго качване (с по-нови данни), това се пропуска
  // и връща null. auto — авто-качване: без мрежа без съобщение, белегът за некачени промени остава (3-10).
  const uploadToDrive = (backup, profileName, profileId, { batchSeq = null, auto = false } = {}) => {
    const seq = batchSeq ?? ++uploadSeqRef.current.drive;
    return runInUploadQueue("drive", async () => {
      if (batchSeq !== null && seq !== uploadSeqRef.current.drive) return null;
      const success = await driveUploadBackup(backup, profileName, { auto });
      if (success) {
        saveUploadCounts("drive", backup);
        clearDeletedAll("drive");
        clearUnsynced("drive", backup, profileId);
        autoUploadPausedRef.current.drive = false;
        autoUploadStoppedRef.current.drive = false;
      }
      return success;
    });
  };

  const uploadToSupabase = (backup, profileName, profileId, { batchSeq = null, auto = false } = {}) => {
    const seq = batchSeq ?? ++uploadSeqRef.current.supabase;
    return runInUploadQueue("supabase", async () => {
      if (batchSeq !== null && seq !== uploadSeqRef.current.supabase) return null;
      const success = await supabaseUploadBackup(backup, profileName, profileId, { auto });
      if (success) {
        saveUploadCounts("supabase", backup);
        clearDeletedAll("supabase");
        clearUnsynced("supabase", backup, profileId);
        autoUploadPausedRef.current.supabase = false;
        autoUploadStoppedRef.current.supabase = false;
        setLastSupabaseUploadDate(new Date().toISOString());
      }
      return success;
    });
  };

  // „При всяка промяна“: копието се качва във файла на всеки профил от targets, едно след друго (3-08б).
  // Качванията имат общ пореден номер — поискано междувременно ново качване пропуска останалите (те
  // са и в неговия списък, защото белезите им стоят). null — пропуснато, false — спира при първия провал.
  const uploadEachProfile = async (service, backup, targets, { auto = false } = {}) => {
    const batchSeq = ++uploadSeqRef.current[service];
    const upload = service === "drive" ? uploadToDrive : uploadToSupabase;
    for (const p of targets) {
      const ok = await upload(backup, p.name, p.id, { batchSeq, auto });
      if (!ok) return ok;
    }
    return true;
  };

  // Авто-качване през пазача. При рязък спад (или при първо качване, когато в облака има копие)
  // не качва, а пита веднъж; при „Не качвай“ авто-качването към услугата спира до следващо
  // отваряне или успешно ръчно качване. targets — профилите ({ id, name }), в чиито файлове се качва.
  // Връща резултата от doUpload, или null, ако качването е пропуснато. doUpload({ auto: true }) —
  // самото авто-качване (без мрежа — тихо, 3-10); „Качи“ от прозореца е ръчно и показва грешката.
  const autoUploadWithGuard = async (service, backup, doUpload, targets) => {
    if (autoUploadStoppedRef.current[service]) return null;
    if (isFirstUploadFromDevice(service)) {
      if (autoUploadPausedRef.current[service] || confirmDialogRef.current) return null;
      autoUploadPausedRef.current[service] = true; // без втора проверка, докато тази чака облака
      // Въпросът е за първия профил, който вече има копие в облака
      for (const p of targets) {
        const copies = await listCopiesBeforeUpload(service, p.name, p.id, { auto: true });
        if (!copies?.length) {
          if (copies) continue;
          autoUploadPausedRef.current[service] = false;
          return null;
        }
        if (confirmDialogRef.current) { // друг прозорец се е отворил междувременно — пак при следваща промяна
          autoUploadPausedRef.current[service] = false;
          return null;
        }
        setConfirmDialog(existingCopyDialog({ service, copies, backup, profileName: p.name, profileId: p.id, doUpload, auto: true }));
        return null;
      }
      autoUploadPausedRef.current[service] = false;
      return doUpload({ auto: true });
    }
    const deleted = findDeletedAll(service, backup);
    const drop = deleted ? null : findUploadDrop(service, backup);
    if (!deleted && !drop) return doUpload({ auto: true });
    if (autoUploadPausedRef.current[service] || confirmDialogRef.current) return null;
    autoUploadPausedRef.current[service] = true;
    setConfirmDialog({
      title: "Автоматичното качване е спряно",
      message: deleted ? deletedAllMessage(service, deleted) : uploadDropMessage(service, drop),
      confirmLabel: "Качи",
      cancelLabel: "Не качвай",
      tone: "warning",
      onConfirm: doUpload,
    });
    return null;
  };

  useEffect(() => {
    if (!profilesLoaded || !transactionsLoaded || !categoriesLoaded || !filtersLoaded || !currencyLoaded || !budgetsLoaded || !recurringLoaded) return;
    // всичко, което влиза в копието — и повтарящите се, бюджетите и валутата (одит 2026-10, 3-09)
    const snap = [transactions, expenseCategories, incomeCategories, savedFilters, profiles, recurringItems, budgets, currency, rate];
    const prev = driveSnapshotRef.current;
    const dataChanged = prev !== null && snap.some((v, i) => v !== prev[i]);
    driveSnapshotRef.current = snap;
    const restoreEnded = autoUploadRestoringRef.current.drive && !pendingBackup;
    autoUploadRestoringRef.current.drive = !!pendingBackup;
    if (pendingBackup) return;
    // Промяната се помни преди проверките за връзка — качва се, когато стане възможно (3-08).
    // След възстановяване, за което се пита „Да кача ли…“, некачените промени отпреди него влизат
    // в този въпрос и не се качват сами, докато той чака.
    if (restoreEnded) {
      if (restoreUploadAskRef.current?.includes("drive")) restoreUnsyncedRef.current.drive = takeUnsynced("drive");
    } else if (driveAutoSync === "onChange" && dataChanged) markUnsynced("drive", activeProfileId);
    if (!driveConnected) return;
    if (transactions.length === 0 && profiles.length <= 1) return;
    if (!activeProfile?.name) return;
    // Без интернет — без опит и без прозорец за грешка; качва се при връщане на интернета
    // (onlineCount), промяната вече е запомнена (одит 2026-10, 3-10)
    if (!navigator.onLine) return;

    // При провал hook-ът показва истинската причина (401 → „Свържи отново“, мрежа — тихо, 3-10)
    // Във файла на всеки профил с некачени промени, не само на отворения (3-08б)
    const driveTargets = driveAutoSync === "onChange" && !restoreEnded ? unsyncedProfiles("drive", dataChanged ? activeProfileId : null) : [];
    if (driveTargets.length > 0) {
      const timer = setTimeout(async () => {
        // ключът за Drive е изтекъл (3-02): „Свържи отново“ веднъж на отваряне, без опит за качване
        if (!driveHasToken()) { drivePromptReconnect(true); return; }
        let backup;
        try { backup = await buildBackupData(); } catch { driveSetMessage(autoUploadReadError("Google Drive")); return; }
        await autoUploadWithGuard("drive", backup, ({ auto = false } = {}) => uploadEachProfile("drive", backup, driveTargets, { auto }), driveTargets);
      }, 1500);
      return () => clearTimeout(timer);
    }

    if (driveAutoSync === "daily" && driveShouldRunDaily()) {
      const profileNameAtTrigger = activeProfile?.name;
      const profileIdAtTrigger = activeProfileId;
      const timer = setTimeout(async () => {
        if (!profileNameAtTrigger) return;
        // ключът за Drive е изтекъл (3-02): „Свържи отново“ веднъж на отваряне, без опит за качване
        if (!driveHasToken()) { drivePromptReconnect(true); return; }
        let backup;
        try { backup = await buildBackupData(); } catch { driveSetMessage(autoUploadReadError("Google Drive")); return; }
        await autoUploadWithGuard("drive", backup, async ({ auto = false } = {}) => {
          const ok = await uploadToDrive(backup, profileNameAtTrigger, profileIdAtTrigger, { auto });
          if (ok) driveMarkDailyDone();
          return ok;
        }, [{ id: profileIdAtTrigger, name: profileNameAtTrigger }]);
      }, 1500);
      return () => clearTimeout(timer);
    }
    // pendingCheckDay: при връщане към отворено приложение в нов ден „Веднъж дневно“ се проверява
    // наново, без да чака промяна в данните (одит 2026-10, 3-13); onlineCount — некачените промени (3-08)
  }, [transactions, expenseCategories, incomeCategories, savedFilters, profiles, recurringItems, budgets, currency, rate, driveAutoSync, driveConnected, pendingBackup, pendingCheckDay, onlineCount]);
  
  useEffect(() => {
    if (!profilesLoaded || !transactionsLoaded || !categoriesLoaded || !filtersLoaded || !currencyLoaded || !budgetsLoaded || !recurringLoaded) return;
    // всичко, което влиза в копието — и повтарящите се, бюджетите и валутата (одит 2026-10, 3-09)
    const snap = [transactions, expenseCategories, incomeCategories, savedFilters, profiles, recurringItems, budgets, currency, rate];
    const prev = supabaseSnapshotRef.current;
    const dataChanged = prev !== null && snap.some((v, i) => v !== prev[i]);
    supabaseSnapshotRef.current = snap;
    const restoreEnded = autoUploadRestoringRef.current.supabase && !pendingBackup;
    autoUploadRestoringRef.current.supabase = !!pendingBackup;
    if (pendingBackup) return;
    // некачените промени — както при Drive (3-08)
    if (restoreEnded) {
      if (restoreUploadAskRef.current?.includes("supabase")) restoreUnsyncedRef.current.supabase = takeUnsynced("supabase");
    } else if (supabaseAutoSync === "onChange" && dataChanged) markUnsynced("supabase", activeProfileId);
    if (!supabaseConnected || !supabaseEnabled) return;
    if (transactions.length === 0 && profiles.length <= 1) return;
    if (!activeProfile?.name) return;
    if (!navigator.onLine) return; // без интернет — както при Drive (3-10)

    const supabaseTargets = supabaseAutoSync === "onChange" && !restoreEnded ? unsyncedProfiles("supabase", dataChanged ? activeProfileId : null) : [];
    if (supabaseTargets.length > 0) {
      const timer = setTimeout(async () => {
        let backup;
        try { backup = await buildBackupData(); } catch { supabaseSetMessage(autoUploadReadError("Облака")); return; }
        await autoUploadWithGuard("supabase", backup, ({ auto = false } = {}) => uploadEachProfile("supabase", backup, supabaseTargets, { auto }), supabaseTargets);
      }, 1500);
      return () => clearTimeout(timer);
    }

    if (supabaseAutoSync === "daily" && supabaseShouldRunDaily()) {
      const profileNameAtTrigger = activeProfile?.name;
      const profileIdAtTrigger = activeProfileId;
      const timer = setTimeout(async () => {
        if (!profileNameAtTrigger) return;
        let backup;
        try { backup = await buildBackupData(); } catch { supabaseSetMessage(autoUploadReadError("Облака")); return; }
        await autoUploadWithGuard("supabase", backup, async ({ auto = false } = {}) => {
          const ok = await uploadToSupabase(backup, profileNameAtTrigger, profileIdAtTrigger, { auto });
          if (ok) supabaseMarkDailyDone();
          return ok;
        }, [{ id: profileIdAtTrigger, name: profileNameAtTrigger }]);
      }, 1500);
      return () => clearTimeout(timer);
    }
    // pendingCheckDay: при връщане към отворено приложение в нов ден „Веднъж дневно“ се проверява
    // наново, без да чака промяна в данните (одит 2026-10, 3-13); onlineCount — некачените промени (3-08)
  }, [transactions, expenseCategories, incomeCategories, savedFilters, profiles, recurringItems, budgets, currency, rate, supabaseAutoSync, supabaseConnected, supabaseEnabled, pendingBackup, pendingCheckDay, onlineCount]);

  // За авто-качването: да не покрива вече отворен прозорец за потвърждение
  useEffect(() => {
    confirmDialogRef.current = confirmDialog;
  }, [confirmDialog]);

  // Показва модал-напомняне след РЕАЛНО свързване с Google Drive (не при обикновено
  // презареждане на вече свързана сесия) — ако автоматичното качване все още е изключено.
  useEffect(() => {
    if (driveConnected && sessionStorage.getItem("pending_auto_upload_notice_drive") === "1") {
      sessionStorage.removeItem("pending_auto_upload_notice_drive");
      if (driveAutoSync === "off") setAutoUploadNotice("drive");
    }
  }, [driveConnected, driveAutoSync]);

  // Показва модал-напомняне след РЕАЛНО активиране на Облака (вход/регистрация или
  // натискане на "Активирай"), а не при обикновено презареждане на вече активна сесия.
  const prevSupabaseEnabledRef = useRef(supabaseEnabled);
  useEffect(() => {
    const wasEnabled = prevSupabaseEnabledRef.current;
    prevSupabaseEnabledRef.current = supabaseEnabled;
    if (!wasEnabled && supabaseEnabled && supabaseAutoSync === "off") {
      setAutoUploadNotice("supabase");
    }
  }, [supabaseEnabled, supabaseAutoSync]);

  useEffect(() => {
    if (transactions.length === 0 || expenseCategories.length === 0 || incomeCategories.length === 0) return;

    const interval = localStorage.getItem("backup_reminder_interval") ?? "weekly";
    if (interval === "off") return;

    const lastStr = localStorage.getItem("last_backup_reminder_date");
    const last = lastStr ? new Date(lastStr) : null;
    const now = new Date();

    let shouldShow = false;
    if (!last) {
      // Първо включване на брояча — не показваме веднага, а стартираме отброяването
      // от сега, за да не засипваме нов потребител с напомняне след първата транзакция
      localStorage.setItem("last_backup_reminder_date", now.toISOString());
      return;
    } else if (interval === "weekly") {
      shouldShow = (now - last) >= 7 * 24 * 60 * 60 * 1000;
    } else if (interval === "monthly") {
      shouldShow = now.getMonth() !== last.getMonth() || now.getFullYear() !== last.getFullYear();
    } else if (interval === "quarterly") {
      const monthsDiff = (now.getFullYear() - last.getFullYear()) * 12 + (now.getMonth() - last.getMonth());
      shouldShow = monthsDiff >= 3;
    }

    // Датата се записва при показването (ефектът за weeklyBackupVisible) — ако чакащите или друг прозорец
    // са отворени, напомнянето изчаква, а при затваряне на приложението дотогава не се губи
    if (shouldShow) {
      setTimeout(() => setShowWeeklyBackup(true), 500);
    }
  }, [transactions, expenseCategories, incomeCategories]);

  const handleFilter = useCallback((newFilters) => {
    setActiveFilters(newFilters);
    setIsFiltered(
      !!(newFilters.fromDate || newFilters.toDate || (newFilters.categories && newFilters.categories.length > 0) || newFilters.description?.trim())
    );
  }, []);
          
  const handleClearFilter = useCallback(() => {
    const empty = { fromDate: "", toDate: "", categories: [], description: "" };
    setFilters(empty);
    setActiveFilters(empty);
    setIsFiltered(false);
  }, []);

  // Преименуването минава и през всичко, което сочи към категорията по име: транзакциите, лимита в
  // бюджета, повтарящите се, запазените филтри и текущия филтър (одит 2026-10, 4-01 + 7-03).
  // Записите не са в една обща транзакция (решение 2026-10-28, вариант А): всяка част се записва
  // директно и връща true/false; при провал — червената лента и прозорец какво точно е останало със
  // старото име, с „Опитай пак“ само за неуспелите части (Б6-1в). Повторният опит смята от същото
  // състояние отпреди преименуването — докато прозорците са отворени, данните не могат да се сменят.
  const applyCategoryRename = async (type, oldName, newName, onlyParts) => {
    const oldKey = `${oldName}::${type}`;
    const newKey = `${newName}::${type}`;
    const renameList = (list) => sortCategories(list.map((c) => (c === oldName ? newName : c)));
    const counts = {
      transactions: transactions.filter((t) => t.category === oldName && t.type === type).length,
      recurring: recurringItems.filter((r) => r.category === oldName && r.type === type).length,
      filters: savedFilters.filter((f) => (f.categories || []).includes(oldKey)).length,
    };
    const writes = {
      categories: () => saveCategoriesDirectly(
        activeProfileId,
        type === "expense" ? renameList(expenseCategories) : expenseCategories,
        type === "income" ? renameList(incomeCategories) : incomeCategories
      ),
      transactions: () => renameTransactionsCategory(oldName, newName, type),
      budgets: () =>
        type === "expense" && budgetsLoaded && budgets.categoryLimits && oldName in budgets.categoryLimits
          ? restoreBudgets({
            ...budgets,
            categoryLimits: Object.fromEntries(
              Object.entries(budgets.categoryLimits).map(([cat, val]) => [cat === oldName ? newName : cat, val])
            ),
          })
          : true,
      recurring: () => renameRecurringCategory(type, oldName, newName),
      filters: () => renameCategoryKey(oldKey, newKey),
    };
    const failed = [];
    for (const part of onlyParts || Object.keys(writes)) {
      if (!(await writes[part]())) failed.push(part);
    }
    if (failed.length === 0) return;
    const labels = {
      categories: "списъка с категории",
      transactions: `транзакциите (${counts.transactions})`,
      budgets: "лимита в „Бюджетни лимити“",
      recurring: `повтарящите се транзакции (${counts.recurring})`,
      filters: `запазените филтри (${counts.filters})`,
    };
    setConfirmDialog({
      title: "Преименуването не е записано докрай",
      label: "⚠️ Грешка при запис",
      message: `Категорията „${oldName}“ е преименувана на „${newName}“, но новото име не можа да се запише в: ${failed.map((p) => labels[p]).join(", ")}. Там засега е останало старото име „${oldName}“ и тези данни няма да се броят към „${newName}“ във филтрите, бюджета и Excel отчета. Най-честата причина е, че няма място на устройството — освободете място и натиснете „Опитай пак“. Ако затворите, след презареждане тези данни може да останат със старото име.`,
      confirmLabel: "Опитай пак",
      cancelLabel: "Затвори",
      tone: "danger",
      onConfirm: () => applyCategoryRename(type, oldName, newName, failed),
    });
  };

  const handleEditCategory = (type, oldName, newName) => {
    if (!editCategory(type, oldName, newName)) return false;
    const trimmed = newName.trim();
    if (trimmed === oldName) return true;
    applyCategoryRename(type, oldName, trimmed);
    const oldKey = `${oldName}::${type}`;
    const newKey = `${trimmed}::${type}`;
    // Текущият филтър (и чрез него запомненият последен филтър)
    const renameInFilter = (f) =>
      f.categories && f.categories.includes(oldKey)
        ? { ...f, categories: [...new Set(f.categories.map((k) => (k === oldKey ? newKey : k)))] }
        : f;
    setFilters(renameInFilter);
    setActiveFilters(renameInFilter);
    return true;
  };

  // Какво сочи към категорията — показва се в прозореца за изтриване преди потвърждение (одит 2026-10, 4-06)
  const getCategoryUsage = (type, name) => {
    const key = `${name}::${type}`;
    const filters = savedFilters.filter((f) => (f.categories || []).includes(key));
    return {
      transactions: transactions.filter((t) => t.category === name && t.type === type).length,
      recurring: recurringItems.filter((r) => r.category === name && r.type === type).map((r) => r.description || "без описание"),
      hasLimit: type === "expense" && !!budgets.categoryLimits && name in budgets.categoryLimits,
      filters: filters.length,
      emptiedFilters: filters
        .filter((f) => isEmptyFilter({ ...f, categories: f.categories.filter((k) => k !== key) }))
        .map((f) => f.name),
    };
  };

  // Изтриването минава и през всичко, което сочи към категорията (одит 2026-10, 4-06; решение 2026-10-28):
  // „Без категория“ — транзакциите, повтарящите се и филтрите минават там; „Изтрий“ — транзакциите се
  // изтриват, категорията се маха от филтрите (празните се изтриват), а при повтарящи се не е позволено
  // (CategoryManager); лимитът в бюджета се маха и в двата случая. Както при преименуването (Б6-1в):
  // всяка част се записва директно, при провал — прозорец с „Опитай пак“ само за неуспелите части.
  const applyCategoryDelete = async (type, name, choice, onlyParts) => {
    const reassign = choice === "reassign";
    const key = `${name}::${type}`;
    const noneKey = `Без категория::${type}`;
    const usage = getCategoryUsage(type, name);
    const listWithout = (list) => {
      const rest = list.filter((c) => c !== name);
      return reassign && !rest.some((c) => c.toLowerCase() === "без категория")
        ? sortCategories([...rest, "Без категория"])
        : rest;
    };
    const writes = {
      categories: () => saveCategoriesDirectly(
        activeProfileId,
        type === "expense" ? listWithout(expenseCategories) : expenseCategories,
        type === "income" ? listWithout(incomeCategories) : incomeCategories
      ),
      transactions: () =>
        reassign ? renameTransactionsCategory(name, "Без категория", type) : deleteTransactionsByCategory(name, type),
      budgets: () =>
        usage.hasLimit && budgetsLoaded
          ? restoreBudgets({
            ...budgets,
            categoryLimits: Object.fromEntries(Object.entries(budgets.categoryLimits).filter(([cat]) => cat !== name)),
          })
          : true,
      // При „Изтрий“ повтарящи се няма (иначе изтриването не е позволено)
      recurring: () => (reassign ? renameRecurringCategory(type, name, "Без категория") : true),
      filters: () => (reassign ? renameCategoryKey(key, noneKey) : removeCategoryKey(key)),
    };
    const failed = [];
    for (const part of onlyParts || Object.keys(writes)) {
      if (!(await writes[part]())) failed.push(part);
    }
    if (failed.length === 0) return;
    const labels = {
      categories: "списъка с категории",
      transactions: reassign
        ? `транзакциите (${usage.transactions}) — не са преместени в „Без категория“`
        : `транзакциите (${usage.transactions}) — не са изтрити`,
      budgets: "лимита в „Бюджетни лимити“ — не е премахнат",
      recurring: `повтарящите се транзакции (${usage.recurring.length}) — не са преместени в „Без категория“`,
      filters: `запазените филтри (${usage.filters})`,
    };
    setConfirmDialog({
      title: "Изтриването не е записано докрай",
      label: "⚠️ Грешка при запис",
      message: `Категорията „${name}“ е изтрита, но промяната не можа да се запише в: ${failed.map((p) => labels[p]).join("; ")}. Там засега е останала „${name}“ — категория, която вече я няма в списъка, затова тези данни няма да се виждат правилно във филтрите, бюджета и Excel отчета. Най-честата причина е, че няма място на устройството — освободете място и натиснете „Опитай пак“. Ако затворите, след презареждане тези данни може да останат с „${name}“.`,
      confirmLabel: "Опитай пак",
      cancelLabel: "Затвори",
      tone: "danger",
      onConfirm: () => applyCategoryDelete(type, name, choice, failed),
    });
  };

  const handleDeleteCategory = (type, name, choice) => {
    // Защита — CategoryManager не показва „Изтрий всички транзакции“, докато има повтарящи се
    if (choice === "delete" && getCategoryUsage(type, name).recurring.length > 0) return;
    deleteCategory(type, name);
    if (choice === "reassign" && name !== "Без категория") addCategory(type, "Без категория");
    applyCategoryDelete(type, name, choice);
    // Текущият филтър (и чрез него запомненият последен филтър): „Без категория“ вместо изтритата или без нея
    const key = `${name}::${type}`;
    const noneKey = `Без категория::${type}`;
    const fixFilter = (f) =>
      f.categories && f.categories.includes(key)
        ? {
          ...f,
          categories: choice === "reassign"
            ? [...new Set(f.categories.map((k) => (k === key ? noneKey : k)))]
            : f.categories.filter((k) => k !== key),
        }
        : f;
    setFilters(fixFilter);
    const nextActive = fixFilter(activeFilters);
    if (nextActive !== activeFilters) handleFilter(nextActive);
  };
  const handleDeleteProfile = async (id) => {
    await deleteAllTransactionsByProfile(id);
    await deleteAllRecurringByProfile(id);
    await deleteProfileCategories(id);
    await deleteProfileSavedFilters(id);
    await deleteProfileCurrency(id);
    await deleteProfileBudgets(id);
    try {
      const db = await openDB();
      await new Promise((resolve) => {
        const tx = db.transaction("last_filter", "readwrite");
        tx.objectStore("last_filter").delete(id);
        tx.oncomplete = resolve;
        tx.onerror = resolve;
      });
    } catch { /* тихо */ }
    await deleteProfile(id);
  };

  const handleCategoriesImported = (newCategories) => {
    addCategoriesFromImport("expense", newCategories.expense);
    addCategoriesFromImport("income", newCategories.income);
  };
  const handleConfirmPending = async (toAdd) => {
    // Второ натискане, докато тече записът, не добавя транзакциите още веднъж (одит 2026-10, 1Б-02)
    if (pendingConfirmBusyRef.current) return;
    // Чакащите са на профил, който вече не е активен: нищо не се добавя и не се маркира —
    // ще се предложат пак, когато той е активен (одит 2026-10, 1А-02)
    if (pendingRecurring.some((p) => p.profileId !== activeProfileId)) {
      setShowPendingModal(false);
      setPendingRecurring([]);
      return;
    }
    pendingConfirmBusyRef.current = true;
    // Маркираме последната дата за ВСЕКИ recurringId независимо дали е добавен или пропуснат
    const lastDates = {};
    pendingRecurring.forEach((p) => { lastDates[p.recurringId] = p.date; });
    // Първо датите, после транзакциите: ако записът на датите не мине, не се добавя нищо —
    // иначе същите дати се предлагат пак и се добавят втори път (одит 2026-10, 7-04).
    // markAsAdded не хвърля — при грешка връща false.
    const marked = await markAsAdded(lastDates);
    if (marked) {
      for (const item of toAdd) {
        addTransaction({
          type: item.type,
          category: item.category,
          amount: item.amount,
          date: item.date,
          description: item.description,
        });
      }
    }
    setShowPendingModal(false);
    setPendingRecurring([]);
    pendingConfirmBusyRef.current = false;
    if (!marked && toAdd.length > 0) {
      alert("Чакащите транзакции не бяха добавени — записът в базата не мина. Ще бъдат предложени отново.");
    }
  };
  // „Затвори“/„×“: само затваря и отлага — нищо не се маркира, чакащите се предлагат пак при следващо
  // отваряне или в нов ден (одит 2026-10, 4-07)
  const handleSnoozePending = () => {
    const profileId = pendingRecurring[0]?.profileId ?? activeProfileId;
    const ids = pendingRecurring.map((p) => p.recurringId);
    setPendingSnoozed((prev) => ({ ...prev, [profileId]: { day: pendingCheckDay, ids } }));
    setShowPendingModal(false);
    setPendingRecurring([]);
  };
  // „Пропусни всички“: след потвърждение — досегашното „Затвори“ (всички се маркират като видяни).
  // run е действието на самия прозорец (изключва бутоните му, докато тече записът)
  const requestSkipPending = (run) => {
    const n = pendingRecurring.length;
    setConfirmDialog({
      title: "Пропускане на чакащите",
      message: `Пропусни ${n} ${n === 1 ? "чакаща транзакция" : "чакащи транзакции"}? Няма да бъдат предложени отново.`,
      confirmLabel: "Да, пропусни",
      tone: "danger",
      onConfirm: run,
    });
  };
  // Нулира цялото състояние на възстановяването (pendingBackup ≠ null спира auto-sync)
  const resetRestoreState = () => {
    completedRestoreProfilesRef.current = [];
    restoreCurrentProfileRef.current = null;
    pendingNewProfilesRef.current = [];
    restoreMergePlanRef.current = {};
    setShowRestoreConfirm(false);
    setShowConflictModal(false);
    setShowRestoreDuplicates(false);
    setShowAddNewProfilesConfirm(false);
    setRestoreLossReport(null);
    setConflictProfiles([]);
    setConflictChoices({});
    setPendingBackup(null);
    setPendingNewProfiles([]);
    setAddNewProfiles(null);
    setNameOnlyMatchIds([]);
    setRestoreBackupNames({});
    setRestoreDuplicates([]);
    setRestoreUniqueTransactions([]);
    setRestoreSelectedDuplicates([]);
    setPendingMergeProfileId(null);
    setPendingRemainingProfiles([]);
  };
  // Грешка по време на възстановяването: казва кои профили са приложени и кой — частично (одит 2026-10, 2А-01)
  const failRestore = (err) => {
    console.error("Грешка при възстановяване от резервно копие", err);
    reportDBError();
    setRestoreError({ done: [...completedRestoreProfilesRef.current], partial: restoreCurrentProfileRef.current });
    resetRestoreState();
  };
  // Успешен край на възстановяването (без нови профили и след въпроса за тях): обобщението съдържа
  // всички профили, филтърът се изчиства само ако данните на активния профил са сменени, а
  // състоянието се нулира изцяло (одит 2026-10, 2А-07, 2А-18, 2Б-04)
  const finalizeRestore = (extra = []) => {
    const summary = [...completedRestoreProfilesRef.current, ...extra];
    if (summary.some((r) => r.id === activeProfileId && r.choice !== "local")) handleClearFilter();
    // Авто-качването пропуска промените от възстановяването; при „При всяка промяна“ се пита,
    // ако нещо е записано (одит 2026-10, 2А-09)
    const changed = summary.length === 0 || summary.some((r) => r.choice !== "local" && r.choice !== "skipped");
    const askServices = [
      driveConnected && driveAutoSync === "onChange" && "drive",
      supabaseConnected && supabaseEnabled && supabaseAutoSync === "onChange" && "supabase",
    ].filter(Boolean);
    restoreUploadAskRef.current = changed && askServices.length > 0 ? askServices : null;
    resetRestoreState();
    setRestoreDoneType(summary.length > 0 ? summary : [{ name: "", choice: "backup" }]);
    setShowRestoreDone(true);
  };
  // Една стъпка на възстановяването (до следващия въпрос към потребителя или до края): докато тече,
  // екранът е блокиран, а второ натискане не прави нищо (одит 2026-10, 2Б-01, 2А-10, 2А-19)
  const runRestoreStep = async (step) => {
    if (restoreBusyRef.current) return;
    restoreBusyRef.current = true;
    document.activeElement?.blur?.(); // Enter в поле под прозореца да не добави транзакция
    setRestoreInProgress(true);
    // Без finally: с него react-hooks lint спира да проверява целия компонент
    try {
      await step();
    } catch (err) {
      failRestore(err);
    }
    restoreBusyRef.current = false;
    setRestoreInProgress(false);
  };

  // Транзакциите на профила от резервното копие, с нови id-та
  const restoreBackupTxs = (backupData, profileId) => copyWithNewIds(
    (backupData.transactions || []).filter((t) => t.profileId === profileId),
    { profileId },
  );
  // Настройките на профила в резервното копие (одит 2026-10, 2А-02). Общите полета на копието
  // (currency, rate, budgets, expenseCategories, incomeCategories) са на профила, активен при
  // свалянето: до 1.6 валутата и лимитите, а в ранните 1.5 и категориите, са записани само за него.
  // null → копието няма данни за профила и той остава с каквото има (нов профил — подразбиращите се)
  const backupProfileSettings = (backupData, profileId) => {
    const isBackupActive = profileId === backupData.activeProfileId;
    // Преди 1.5 (без profileCategories) категориите са общи за всички профили
    const categories = backupData.profileCategories?.[profileId]
      || (!backupData.profileCategories || isBackupActive
        ? { expense: backupData.expenseCategories || [], income: backupData.incomeCategories || [] }
        : null);
    const currency = backupData.profileCurrencies?.[profileId]
      || (isBackupActive && backupData.currency ? { currency: backupData.currency, rate: backupData.rate } : null);
    const budgets = backupData.profileBudgets?.[profileId] || (isBackupActive ? backupData.budgets || null : null);
    return { categories, currency, budgets };
  };
  // Без празни и повторения (главни/малки букви не се различават, както в addCategory)
  const uniqueCategories = (list) => {
    const seen = new Set();
    return list.filter((c) => typeof c === "string").map((c) => c.trim()).filter((c) => {
      const key = c.toLowerCase();
      if (!c || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  // Списъците + категориите на транзакциите и повтарящите се на профила в копието, без повторения
  const withUsedCategories = (expense, income, backupData, profileId) => {
    const used = [...(backupData.transactions || []), ...(backupData.recurringItems || [])]
      .filter((item) => item.profileId === profileId);
    const usedOfType = (type) => used.filter((item) => item.type === type).map((item) => item.category);
    return {
      expense: uniqueCategories([...expense, ...usedOfType("expense")]),
      income: uniqueCategories([...income, ...usedOfType("income")]),
    };
  };
  // Категориите на профила: „Замести“ / нов профил — от копието, ако ги има там, иначе остават
  // локалните (нов профил — подразбиращите се); „Обедини“ — локалните + от копието. Добавят се и
  // категориите на транзакциите и повтарящите се на профила в копието, които липсват в списъка (2А-02)
  const restoreProfileCategories = async (bp, choice, backupData) => {
    const fromBackup = backupProfileSettings(backupData, bp.id).categories;
    let expense;
    let income;
    if (choice === "backup" && fromBackup) {
      expense = fromBackup.expense;
      income = fromBackup.income;
    } else {
      // Както useCategories при зареждане: без запис → подразбиращите се
      const local = (await runTx("categories", "readonly", (store) => store.get(bp.id)))?.categories;
      const hasLocal = local && typeof local === "object";
      expense = hasLocal ? (Array.isArray(local.expense) ? local.expense : []) : DEFAULT_EXPENSE_CATEGORIES;
      income = hasLocal ? (Array.isArray(local.income) ? local.income : []) : DEFAULT_INCOME_CATEGORIES;
      if (fromBackup) {
        expense = [...expense, ...fromBackup.expense];
        income = [...income, ...fromBackup.income];
      }
    }
    ({ expense, income } = withUsedCategories(expense, income, backupData, bp.id));
    ensureSaved(await saveCategoriesDirectly(bp.id, expense, income));
    if (bp.id === activeProfileId) {
      setExpenseCategoriesFromBackup(expense);
      setIncomeCategoriesFromBackup(income);
    }
  };
  // Валутата и лимитите на профила от копието; ако ги няма там — не се пипат (2А-02)
  const restoreProfileCurrencyAndBudgets = async (bp, backupData) => {
    const { currency: profileCurrencyData, budgets: profileBudgetsData } = backupProfileSettings(backupData, bp.id);
    if (profileCurrencyData) {
      if (bp.id === activeProfileId) {
        ensureSaved(await restoreCurrency(profileCurrencyData.currency, profileCurrencyData.rate));
      } else {
        await runTx("currency", "readwrite", (store) =>
          store.put({ id: bp.id, currency: profileCurrencyData.currency, rate: profileCurrencyData.rate }));
      }
    }
    if (profileBudgetsData) {
      if (bp.id === activeProfileId) {
        ensureSaved(await restoreBudgets(profileBudgetsData));
      } else {
        await runTx("budgets", "readwrite", (store) => store.put({ id: bp.id, ...profileBudgetsData }));
      }
    }
  };
  // Добавя новите профили (само в резервното копие) заедно с данните им
  const restoreNewProfiles = async (backupData) => {
    for (const bp of pendingNewProfilesRef.current) {
      restoreCurrentProfileRef.current = bp.name;
      ensureSaved(await addOrUpdateProfile(bp));
      // Транзакции
      ensureSaved(await replaceAllTransactions(restoreBackupTxs(backupData, bp.id), bp.id));
      // Категории, валута, бюджети
      await restoreProfileCategories(bp, "backup", backupData);
      await restoreProfileCurrencyAndBudgets(bp, backupData);
      // Филтри
      if (backupData.savedFilters) {
        const profileFilters = backupData.savedFilters.filter((f) => f.profileId === bp.id);
        ensureSaved(await restoreFilters(await withFreeIds("saved_filters", bp.id, profileFilters, ""), bp.id));
      }
      // Повтарящи се
      if (backupData.recurringItems) {
        const profileRecurring = backupData.recurringItems.filter((r) => r.profileId === bp.id);
        ensureSaved(await restoreRecurring(await withFreeIds("recurring", bp.id, profileRecurring, "recurring_"), bp.id));
      }
      completedRestoreProfilesRef.current.push({ id: bp.id, name: bp.name, choice: "backup" });
      restoreCurrentProfileRef.current = null;
    }
  };
  // Отговор за „Вероятни дубликати“: само се запомня, записът е накрая (одит 2026-10, 2А-08)
  const handleRestoreDuplicatesConfirm = async () => {
    if (!pendingBackup) return;
    restoreMergePlanRef.current[pendingMergeProfileId] = [
      ...restoreUniqueTransactions,
      ...restoreDuplicates.filter((t) => restoreSelectedDuplicates.includes(t.id)),
    ];
    setRestoreDuplicates([]);
    setRestoreUniqueTransactions([]);
    setRestoreSelectedDuplicates([]);
    setPendingMergeProfileId(null);
    setShowRestoreDuplicates(false);

    // Продължи с въпросите за останалите профили
    await askRestoreQuestions(pendingRemainingProfiles, pendingBackup);
  };
  // Категория, която се различава от съществуваща само по главни/малки букви, приема съществуващото
  // изписване — и в списъка, и в транзакциите (одит 2026-10, 1А-16)
  const handleMergeImport = (transactions, backupExpenseCategories, backupIncomeCategories) => {
    const expense = linkCategories(expenseCategories, backupExpenseCategories);
    const income = linkCategories(incomeCategories, backupIncomeCategories);
    addTransactions(applyCategorySpelling(transactions, { expense: expense.resolve, income: income.resolve }));
    addCategoriesFromImport("expense", expense.added);
    addCategoriesFromImport("income", income.added);
  };
  // „Копирай от друг профил“: освен транзакциите добавя и категориите, които активният профил няма
  // (по тип, без значение на главни/малки букви, както „Обедини“) — иначе транзакциите са извън списъка,
  // а Excel отчетът и формите ги пропускат (одит 2026-10, 5-6, 1А-16). Връща добавените категории за
  // реда в „Готово“.
  const handleCopyTransactions = (copiedTransactions) => {
    const addedCategories = [];
    const resolvers = {};
    [["expense", expenseCategories], ["income", incomeCategories]].forEach(([type, listed]) => {
      const { added, resolve } = linkCategories(listed, copiedTransactions.filter((t) => t.type === type).map((t) => t.category));
      resolvers[type] = resolve;
      const missing = [...added].sort((a, b) => a.localeCompare(b, "bg"));
      if (missing.length === 0) return;
      addCategoriesFromImport(type, missing);
      missing.forEach((name) => addedCategories.push({ name, type }));
    });
    addTransactions(applyCategorySpelling(copiedTransactions, resolvers));
    return addedCategories;
  };
  // Всяко четене минава през runTx; грешка хвърля BACKUP_READ_ERROR, вместо тихо да сложи празен
  // списък — досега се сваляше копие с всички профили, но без транзакциите на неактивните (7-02).
  // Данните на активния профил се вземат от паметта (там са и още незаписаните промени) само ако са
  // заредени за него; докато профилът се зарежда (смяна на профил) — от базата, иначе копието
  // беше без неговите транзакции (2А-12).
  const buildBackupData = async () => {
    if (!profilesLoaded) throw new Error(BACKUP_READ_ERROR);
    const readAt = Date.now();
    const activeReady = transactionsLoaded && categoriesLoaded && currencyLoaded && budgetsLoaded;
    const read = {};
    try {
      for (const store of BACKUP_STORES) {
        read[store] = (await runTx(store, "readonly", (s) => s.getAll())) || [];
      }
    } catch (err) {
      reportDBError();
      console.error("Грешка при четене на данните за резервно копие", err);
      throw new Error(BACKUP_READ_ERROR);
    }

    const allProfileCategories = {};
    read.categories.forEach((entry) => {
      allProfileCategories[entry.type] = {
        expense: entry.categories?.expense || [],
        income: entry.categories?.income || [],
      };
    });
    const allProfileCurrencies = {};
    read.currency.forEach((entry) => {
      allProfileCurrencies[entry.id] = { currency: entry.currency, rate: entry.rate };
    });
    const allProfileBudgets = {};
    read.budgets.forEach((entry) => {
      const { id, ...rest } = entry;
      allProfileBudgets[id] = rest;
    });
    let allTransactions = read.transactions;
    if (activeReady) {
      allProfileCategories[activeProfileId] = { expense: expenseCategories, income: incomeCategories };
      allProfileCurrencies[activeProfileId] = { currency, rate };
      allProfileBudgets[activeProfileId] = budgets;
      allTransactions = [...read.transactions.filter((t) => t.profileId !== activeProfileId), ...transactions];
    } else if (!allProfileCategories[activeProfileId]) {
      // Без запис в базата профилът ползва категориите по подразбиране (както useCategories)
      allProfileCategories[activeProfileId] = { expense: DEFAULT_EXPENSE_CATEGORIES, income: DEFAULT_INCOME_CATEGORIES };
    }
    const activeCurrency = allProfileCurrencies[activeProfileId];

    const backup = {
      version: "1.6",
      date: new Date().toISOString(),
      profiles,
      activeProfileId,
      transactions: allTransactions,
      expenseCategories: allProfileCategories[activeProfileId].expense,
      incomeCategories: allProfileCategories[activeProfileId].income,
      profileCategories: allProfileCategories,
      savedFilters: read.saved_filters,
      // Без запис в базата (профилът не е зареден) — без валута и лимити: възстановяването не ги пипа
      currency: activeCurrency?.currency,
      rate: activeCurrency?.rate,
      budgets: allProfileBudgets[activeProfileId],
      profileCurrencies: allProfileCurrencies,
      profileBudgets: allProfileBudgets,
      recurringItems: read.recurring,
    };
    backupReadAtRef.current.set(backup, readAt);
    return backup;
  };

  const downloadBackupFile = (data, onlyProfile = false) => {
    exportBackup(data.transactions, data.expenseCategories, data.incomeCategories, data.savedFilters, data.currency, data.rate, data.budgets, data.profiles, data.activeProfileId, data.recurringItems, activeProfile?.name, data.profileCategories, data.profileCurrencies, data.profileBudgets, onlyProfile);
    // Копие само на един профил не е пълно резервно копие — напомнянето за седмично копие остава
    if (onlyProfile) return;
    const now = new Date().toISOString();
    localStorage.setItem("last_local_backup_date", now);
    setLastLocalBackupDate(now);
  };

  // Резервен път при грешка в базата: само активният профил от паметта — точно това, което червената
  // лента съветва да се спаси. Копието е цяло за този профил, а другите профили ги няма в него,
  // затова възстановяването му не ги пипа (7-02).
  const offerActiveProfileBackup = (message) => {
    const inMemory = activeProfile && transactionsLoaded && categoriesLoaded && currencyLoaded && budgetsLoaded && filtersLoaded && recurringLoaded;
    if (!inMemory) {
      alert(message);
      return;
    }
    const count = transactions.length;
    setConfirmDialog({
      title: "Резервното копие не е направено",
      message: `${message} Мога да сваля само профил „${activeProfile.name}“ (${count} ${count === 1 ? "транзакция" : "транзакции"}) така, както се вижда на екрана. Другите профили няма да са в това копие.`,
      confirmLabel: `Свали само „${activeProfile.name}“`,
      tone: "warning",
      onConfirm: () => downloadBackupFile({
        profiles: profiles.filter((p) => p.id === activeProfileId),
        activeProfileId,
        transactions,
        expenseCategories,
        incomeCategories,
        profileCategories: { [activeProfileId]: { expense: expenseCategories, income: incomeCategories } },
        savedFilters,
        currency,
        rate,
        budgets,
        profileCurrencies: { [activeProfileId]: { currency, rate } },
        profileBudgets: { [activeProfileId]: budgets },
        recurringItems,
      }, true),
    });
  };

  // Копие за ръчно качване; при грешка в базата — съобщение и null (нищо не се качва)
  const backupForManualUpload = async (service) => {
    try {
      return await buildBackupData();
    } catch (err) {
      const setMessage = service === "drive" ? driveSetMessage : supabaseSetMessage;
      setMessage(`❌ ${err.message} Нищо не е качено в ${UPLOAD_SERVICE_LABELS[service]}.`);
      return null;
    }
  };

  // Ръчно „Запази в Google Drive / облака“: при първо качване от устройството и съществуващо
  // копие в облака — въпрос „Възстанови / Качи все пак“; при рязък спад — потвърждение.
  const manualUploadWithGuard = async (service, backup, doUpload, profileName, profileId) => {
    if (isFirstUploadFromDevice(service)) {
      const copies = await listCopiesBeforeUpload(service, profileName, profileId);
      if (!copies) return;
      if (copies.length) {
        setConfirmDialog(existingCopyDialog({ service, copies, backup, profileName, profileId, doUpload, auto: false }));
        return;
      }
      await doUpload();
      return;
    }
    const deleted = findDeletedAll(service, backup);
    const drop = deleted ? null : findUploadDrop(service, backup);
    if (deleted || drop) {
      setConfirmDialog({
        title: deleted ? "Качване след изтриване" : "Рязко намаляване на данните",
        message: deleted ? deletedAllMessage(service, deleted) : uploadDropMessage(service, drop),
        confirmLabel: "Качи",
        tone: "warning",
        onConfirm: doUpload,
      });
      return;
    }
    await doUpload();
  };
  const handleDriveUpload = async () => {
    const backup = await backupForManualUpload("drive");
    if (!backup) return;
    const profileName = activeProfile?.name;
    await manualUploadWithGuard("drive", backup, () => uploadToDrive(backup, profileName, activeProfileId), profileName, activeProfileId);
  };
  const handleSupabaseUpload = async () => {
    const backup = await backupForManualUpload("supabase");
    if (!backup) return;
    const profileName = activeProfile?.name;
    const profileId = activeProfileId;
    await manualUploadWithGuard("supabase", backup, () => uploadToSupabase(backup, profileName, profileId), profileName, profileId);
  };

  // След прозореца „Възстановяването … е завършено“: въпрос дали възстановените данни да се качат
  // (при „При всяка промяна“). „Не качвай“ спира авто-качването до следващото отваряне, за да не
  // качи възстановеното при първата промяна (одит 2026-10, 2А-09)
  const closeRestoreDone = async () => {
    setShowRestoreDone(false);
    const services = restoreUploadAskRef.current;
    restoreUploadAskRef.current = null;
    const unsyncedBefore = restoreUnsyncedRef.current;
    restoreUnsyncedRef.current = { drive: [], supabase: [] };
    if (!services || !activeProfile?.name) return;
    const backup = await backupForManualUpload(services[0]);
    if (!backup) return;
    const profileName = activeProfile.name;
    // Отвореният профил и профилите с некачени промени отпреди възстановяването (3-08б)
    const targets = Object.fromEntries(services.map((s) => [s, [
      activeProfile,
      ...profiles.filter((p) => p.id !== activeProfileId && unsyncedBefore[s].includes(p.id)),
    ]]));
    const others = [...new Set(services.flatMap((s) => targets[s].slice(1).map((p) => `„${p.name}“`)))];
    const where = services.map((s) => UPLOAD_SERVICE_LABELS[s]).join(" и в ");
    const warnings = services.map((s) => {
      const deleted = findDeletedAll(s, backup);
      if (deleted) return ` След „Изтрий всички данни“ профил „${deleted.name}“ има ${deleted.now} ${deleted.now === 1 ? "транзакция" : "транзакции"} (преди изтриването: ${deleted.before}).`;
      const drop = findUploadDrop(s, backup);
      return drop ? ` Транзакциите на профил „${drop.name}“ са намалели от ${drop.prev} на ${drop.now} спрямо последното качване в ${UPLOAD_SERVICE_LABELS[s]}.` : "";
    });
    setConfirmDialog({
      title: "Да кача ли възстановените данни?",
      message:
        `Автоматичното качване е включено. „Качи“ качва данните от това устройство в ${where} като днешно копие на профил „${profileName}“` +
        (others.length > 0 ? `, както и на ${others.join(", ")} (там има некачени промени отпреди възстановяването),` : "") +
        ` и заменя днешното копие там; по-старите копия се пазят.` +
        [...new Set(warnings)].join("") +
        " „Не качвай“ оставя облака непроменен и спира автоматичното качване до следващото отваряне на приложението.",
      confirmLabel: "Качи",
      cancelLabel: "Не качвай",
      tone: "warning",
      onConfirm: async () => {
        for (const s of services) {
          for (const p of targets[s]) {
            if (s === "drive") await uploadToDrive(backup, p.name, p.id);
            else await uploadToSupabase(backup, p.name, p.id);
          }
        }
      },
      onCancel: () => {
        services.forEach((s) => { autoUploadStoppedRef.current[s] = true; });
      },
    });
  };

  // „Възстанови от Google Drive / облака“: 1 копие — направо, повече — избор на дата
  const restoreFromCloud = async (service) => {
    const copies = service === "drive"
      ? await driveListBackups(activeProfile?.name)
      : await supabaseListBackups(activeProfile?.name, activeProfileId);
    if (!copies) return;
    if (copies.length === 1) {
      const data = service === "drive"
        ? await driveDownloadBackup(copies[0].fileId)
        : await supabaseDownloadBackup(copies[0].fileName);
      if (data) await startCloudRestore(data, service);
    } else {
      setCloudBackupChoices({ source: service, copies });
    }
  };

  // Общо начало на възстановяването (файл и облак): брои локалните транзакции и показва
  // прозореца за съвпадащи профили или за потвърждение. Състоянието (вкл. pendingBackup, който
  // спира auto-sync) се задава чак след успешното четене — при грешка нищо не остава зададено
  // (одит 2026-10, 2А-05, 1А-05). Копието първо минава през общата проверка (2А-06, 3-15).
  const beginRestore = async (rawData, source) => {
    const { data: normalized, remappedIds } = normalizeBackupProfileIds(validateAndMigrateBackup(rawData));
    // Профил, който го има и на устройството, запазва локалното си име и дата на създаване — в
    // прозорците и при запис („Замести“ / „Обедини“); името от копието само се показва (одит 2026-10, 2А-13, 2Б-03)
    const backupNames = {};
    const data = {
      ...normalized,
      profiles: normalized.profiles.map((bp) => {
        const lp = profiles.find((p) => p.id === bp.id);
        if (!lp) return bp;
        if (lp.name !== bp.name) backupNames[bp.id] = bp.name;
        return { ...bp, ...lp };
      }),
    };
    // Профили, които съществуват и в приложението, и в резервното копие — само по id: съвпаденията
    // по име вече са с локалния id, а несвързаните при сблъсък са нови (одит 2026-10, 2А-14)
    const conflicts = (data.profiles || []).filter((bp) => profiles.some((lp) => lp.id === bp.id));
    const newProfiles = (data.profiles || []).filter((bp) => !profiles.some((lp) => lp.id === bp.id));
    let allTxs;
    try {
      allTxs = (await runTx("transactions", "readonly", (store) => store.getAll())) || [];
    } catch (err) {
      reportDBError();
      console.error("Грешка при четене на транзакциите преди възстановяване", err);
      throw new Error("Данните на устройството не могат да бъдат прочетени. Възстановяването не започна.", { cause: err });
    }
    const counts = {};
    profiles.forEach((lp) => {
      counts[lp.id] = allTxs.filter((t) => t.profileId === lp.id).length;
    });

    setRestoreSource(source);
    setNameOnlyMatchIds(remappedIds);
    setRestoreBackupNames(backupNames);
    setPendingBackup(data);
    // Новите профили (само в резервното копие) — отделно
    pendingNewProfilesRef.current = newProfiles;
    setPendingNewProfiles(newProfiles);
    setLocalTransactionCounts(counts);
    if (conflicts.length > 0) {
      // „Замести“ по подразбиране само за отворения профил: копието носи всички профили, но
      // другите в него може да са по-стари от тези на устройството (одит 2026-10, 3-16)
      const initialChoices = {};
      conflicts.forEach((p) => { initialChoices[p.id] = p.id === activeProfileId ? "backup" : "local"; });
      setConflictProfiles(conflicts);
      setConflictChoices(initialChoices);
      setShowConflictModal(true);
    } else {
      setShowRestoreConfirm(true);
    }
  };

  // Начало на възстановяване от Google Drive или Облака (след изтегляне на избраното копие)
  const startCloudRestore = async (rawData, source) => {
    if (restoreBusyRef.current) return; // друго възстановяване още записва (одит 2026-10, 2А-19)
    try {
      await beginRestore(rawData, source);
    } catch (err) {
      alert(err.message);
    }
  };

  // Размер на копие от облака за списъка за избор (null, ако облакът не го е върнал)
  const formatBackupSize = (bytes) => {
    if (bytes == null) return null;
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleBackupExport = async () => {
    let data;
    try {
      data = await buildBackupData();
    } catch (err) {
      offerActiveProfileBackup(err.message);
      return;
    }
    downloadBackupFile(data);
  };

  const normalizeBackupProfileIds = (data) => {
    const idMap = {};
    const remappedIds = [];
    const backupIds = new Set((data.profiles || []).map((bp) => bp.id));
    // Имената на профилите трябва да са различни (useProfiles) — несвързаният получава „Име (2)“
    const takenNames = new Set([...profiles, ...(data.profiles || [])].map((p) => p.name.toLowerCase()));
    const freeName = (name) => {
      let i = 2;
      while (takenNames.has(`${name} (${i})`.toLowerCase())) i++;
      takenNames.add(`${name} (${i})`.toLowerCase());
      return `${name} (${i})`;
    };
    let renamed = false;
    const newProfiles = (data.profiles || []).map((bp) => {
      const lp = profiles.find((p) => p.id !== bp.id && p.name.toLowerCase() === bp.name.toLowerCase());
      // Без свързване по име, ако профилът съвпада по id, ако id-то на локалния профил е на друг
      // профил в копието или друг профил от копието вече е свързан с него — иначе два профила
      // получават един id и данните им се смесват; несвързаният остава със своя id и се предлага
      // като нов (одит 2026-10, 2А-14)
      const idMatch = profiles.some((p) => p.id === bp.id);
      if (lp && !idMatch && !backupIds.has(lp.id) && !remappedIds.includes(lp.id)) {
        idMap[bp.id] = lp.id;
        remappedIds.push(lp.id);
        return { ...bp, id: lp.id };
      }
      if (lp && !idMatch) {
        renamed = true;
        return { ...bp, name: freeName(bp.name) };
      }
      return bp;
    });
    if (Object.keys(idMap).length === 0 && !renamed) return { data, remappedIds: [] };
    const remapId = (id) => idMap[id] || id;
    const newData = {
      ...data,
      profiles: newProfiles,
      activeProfileId: remapId(data.activeProfileId),
      transactions: (data.transactions || []).map((t) => ({ ...t, profileId: remapId(t.profileId) })),
      savedFilters: (data.savedFilters || []).map((f) => ({ ...f, profileId: remapId(f.profileId) })),
      recurringItems: (data.recurringItems || []).map((r) => ({ ...r, profileId: remapId(r.profileId) })),
    };
    if (data.profileCategories) {
      const remapped = {};
      Object.entries(data.profileCategories).forEach(([id, val]) => { remapped[remapId(id)] = val; });
      newData.profileCategories = remapped;
    }
    if (data.profileCurrencies) {
      const remapped = {};
      Object.entries(data.profileCurrencies).forEach(([id, val]) => { remapped[remapId(id)] = val; });
      newData.profileCurrencies = remapped;
    }
    if (data.profileBudgets) {
      const remapped = {};
      Object.entries(data.profileBudgets).forEach(([id, val]) => { remapped[remapId(id)] = val; });
      newData.profileBudgets = remapped;
    }
    return { data: newData, remappedIds };
  };

  const handleBackupFileSelect = async (e) => {
    const file = e.target.files[0];
    if (!file || restoreBusyRef.current) return; // друго възстановяване още записва (одит 2026-10, 2А-19)
    try {
      const rawData = await importBackup(file);
      await beginRestore(rawData, "file");
    } catch (err) {
      alert(err.message);
    }
  };
  const finishRestoreForProfile = async (bp, choice, backupData) => {
    await restoreProfileCategories(bp, choice, backupData);
    if (choice === "backup") await restoreProfileCurrencyAndBudgets(bp, backupData);

    if (backupData.savedFilters) {
      let filters = backupData.savedFilters.filter((f) => f.profileId === bp.id);
      if (choice === "merge") filters = mergeByIdAndKey(await getProfileRecords("saved_filters", bp.id), filters, filterKey);
      filters = await withFreeIds("saved_filters", bp.id, filters, "");
      ensureSaved(await restoreFilters(filters, bp.id));
      if (bp.id === activeProfileId) setSavedFilters(filters.map((f) => ({ ...f, profileId: bp.id })));
    }
    const notes = [];
    if (backupData.recurringItems) {
      let items = backupData.recurringItems.filter((r) => r.profileId === bp.id);
      if (choice === "merge") {
        const merged = mergeRecurring(await getProfileRecords("recurring", bp.id), items);
        items = merged.items;
        merged.newerDates.forEach((d) => notes.push(
          `Повтаряща се „${d.name}“: последното добавяне е взето от резервното копие (${d.backup} вместо ${d.local || "няма"}), там е по-късно. Описанието и сумата са тези от устройството.`
        ));
      }
      ensureSaved(await restoreRecurring(await withFreeIds("recurring", bp.id, items, "recurring_"), bp.id));
    }
    return notes;
  };

  // Първо всички въпроси, после един запис: „Обедини“ профилите с вероятни дубликати се питат един
  // след друг, после — за новите профили; до последния отговор нищо не е записано, така че „Откажи“
  // не оставя частично възстановяване (одит 2026-10, 2А-08). Хвърля при грешка в базата — хваща я
  // runRestoreStep (failRestore)
  const askRestoreQuestions = async (remainingProfiles, backupData) => {
    for (const [idx, bp] of remainingProfiles.entries()) {
      const isNew = pendingNewProfilesRef.current.some((np) => np.id === bp.id);
      if (isNew || conflictChoices[bp.id] !== "merge") continue;

      const localTxsForProfile = await getProfileRecords("transactions", bp.id);
      const backupTxs = restoreBackupTxs(backupData, bp.id);
      const dupes = backupTxs.filter((bt) =>
        localTxsForProfile.some(
          (e) =>
            e.date === bt.date &&
            e.category === bt.category &&
            e.type === bt.type &&
            Math.abs(Number(e.amount) - Number(bt.amount)) < 0.01
        )
      );
      const unique = backupTxs.filter((bt) => !dupes.includes(bt));
      if (dupes.length > 0) {
        setRestoreUniqueTransactions(unique);
        setRestoreDuplicates(dupes);
        setRestoreSelectedDuplicates([]);
        setPendingMergeProfileId(bp.id);
        setPendingRemainingProfiles(remainingProfiles.slice(idx + 1));
        setShowRestoreConfirm(false);
        setShowConflictModal(false);
        setShowRestoreDuplicates(true);
        return;
      }
      restoreMergePlanRef.current[bp.id] = unique;
    }

    if (pendingNewProfilesRef.current.length > 0) {
      setShowAddNewProfilesConfirm(true);
      return;
    }

    await applyRestore(backupData, false);
  };

  // Записва всичко наведнъж, след последния отговор. Хвърля при грешка в базата (failRestore)
  const applyRestore = async (backupData, addNew) => {
    for (const bp of backupData.profiles || []) {
      const isNew = pendingNewProfilesRef.current.some((np) => np.id === bp.id);
      if (isNew) continue;
      const choice = conflictChoices[bp.id] || "backup";
      if (choice === "local") {
        completedRestoreProfilesRef.current.push({ id: bp.id, name: bp.name, choice: "local" });
        continue;
      }

      restoreCurrentProfileRef.current = bp.name;
      if (choice === "merge") {
        const toAdd = restoreMergePlanRef.current[bp.id] || [];
        if (toAdd.length > 0) {
          const existingTxs = bp.id === activeProfileId
            ? transactions
            : await getProfileRecords("transactions", bp.id);
          ensureSaved(await replaceAllTransactions([...existingTxs, ...toAdd], bp.id));
        }
      } else {
        ensureSaved(await replaceAllTransactions(restoreBackupTxs(backupData, bp.id), bp.id));
      }
      const notes = await finishRestoreForProfile(bp, choice, backupData);
      ensureSaved(await addOrUpdateProfile(bp));
      completedRestoreProfilesRef.current.push({ id: bp.id, name: bp.name, choice, notes });
      restoreCurrentProfileRef.current = null;
    }

    const newProfiles = pendingNewProfilesRef.current;
    if (addNew) {
      await restoreNewProfiles(backupData);
      finalizeRestore();
    } else {
      finalizeRestore(newProfiles.length > 0 ? [{ name: newProfiles.map((p) => p.name).join(", "), choice: "skipped" }] : []);
    }
  };

  // За всеки профил със „Замести“: какво ще изчезне или ще се промени спрямо устройството (одит 2026-10,
  // 3-16). Отвореният профил — от паметта (там са и още незаписаните промени), другите — от базата;
  // след възстановяването ще имат същото, което записва applyRestore. Хвърля при грешка в базата
  const buildRestoreLossReport = async (backupData) => {
    const report = [];
    for (const bp of backupData.profiles || []) {
      if (pendingNewProfilesRef.current.some((np) => np.id === bp.id)) continue;
      if ((conflictChoices[bp.id] || "backup") !== "backup") continue;
      const isActive = bp.id === activeProfileId;
      let local;
      if (isActive) {
        local = {
          transactions,
          categories: { expense: expenseCategories, income: incomeCategories },
          currency: { currency, rate },
          budgets,
          recurring: recurringItems,
          filters: savedFilters,
        };
      } else {
        const storedCategories = (await runTx("categories", "readonly", (store) => store.get(bp.id)))?.categories;
        const hasCategories = storedCategories && typeof storedCategories === "object";
        const storedCurrency = await runTx("currency", "readonly", (store) => store.get(bp.id));
        local = {
          transactions: await getProfileRecords("transactions", bp.id),
          // както хуковете при зареждане: без запис — подразбиращите се категории и EUR
          categories: hasCategories
            ? { expense: Array.isArray(storedCategories.expense) ? storedCategories.expense : [], income: Array.isArray(storedCategories.income) ? storedCategories.income : [] }
            : { expense: DEFAULT_EXPENSE_CATEGORIES, income: DEFAULT_INCOME_CATEGORIES },
          currency: validCurrency(storedCurrency?.currency, storedCurrency?.rate),
          budgets: (await runTx("budgets", "readonly", (store) => store.get(bp.id))) || null,
          recurring: await getProfileRecords("recurring", bp.id),
          filters: await getProfileRecords("saved_filters", bp.id),
        };
      }
      const settings = backupProfileSettings(backupData, bp.id);
      // Без категории/валута/лимити в копието възстановяването не ги пипа (restoreProfile*)
      const restoredCategories = withUsedCategories(
        settings.categories ? settings.categories.expense : local.categories.expense,
        settings.categories ? settings.categories.income : local.categories.income,
        backupData, bp.id,
      );
      const entry = {
        id: bp.id,
        name: bp.name,
        transactions: diffTransactions(local.transactions, (backupData.transactions || []).filter((t) => t.profileId === bp.id)),
        categories: diffCategories(local.categories, restoredCategories),
        budgets: settings.budgets ? diffBudgets(local.budgets, settings.budgets) : [],
        currency: settings.currency ? diffCurrency(local.currency, validCurrency(settings.currency.currency, settings.currency.rate)) : null,
        recurring: diffRecords(
          local.recurring,
          (backupData.recurringItems || []).filter((r) => r.profileId === bp.id),
          recurringKey,
          ["type", "category", "amount", "variableAmount", "description", "startDate", "endDate", "period", "customDays", "lastAdded"],
        ),
        filters: diffRecords(
          local.filters,
          (backupData.savedFilters || []).filter((f) => f.profileId === bp.id),
          filterKey,
          ["name", "fromDate", "toDate", "categories", "description"],
        ),
      };
      report.push({ ...entry, hasLoss: hasRestoreLoss(entry) });
    }
    return report;
  };

  // „Потвърди“: ако „Замести“ ще изтрие или промени нещо — първо прозорецът с разликите (3-16)
  const handleRestoreConfirmClick = async () => {
    const report = await buildRestoreLossReport(pendingBackup);
    if (report.some((r) => r.hasLoss)) {
      setRestoreLossReport(report);
      return;
    }
    await handleRestoreConfirm();
  };
  // „Обедини вместо това“: профилите със загуби минават на „Обедини“ и прозорецът за потвърждение се
  // показва отново с новия избор (записът тръгва чак след повторното „Потвърди“)
  const handleRestoreLossMerge = () => {
    const ids = restoreLossReport.filter((r) => r.hasLoss).map((r) => r.id);
    setConflictChoices((prev) => ({ ...prev, ...Object.fromEntries(ids.map((id) => [id, "merge"])) }));
    setRestoreLossReport(null);
    setShowRestoreConfirm(true);
  };
  // „Назад“: към избора за профилите (без съвпадащи профили няма какво да се сменя — към потвърждението)
  const handleRestoreLossBack = () => {
    setRestoreLossReport(null);
    if (conflictProfiles.length > 0) setShowConflictModal(true);
    else setShowRestoreConfirm(true);
  };

  const handleRestoreConfirm = async () => {
    completedRestoreProfilesRef.current = [];
    restoreCurrentProfileRef.current = null;
    restoreMergePlanRef.current = {};
    await askRestoreQuestions(pendingBackup.profiles || [], pendingBackup);
  };

  return (
    <div className="min-h-screen bg-transparent">
      {driveMessage === "blocked" && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100] p-4">
          <div className="bg-blue-50 rounded-2xl shadow-xl w-full max-w-sm">
            <div className="px-5 py-4 border-b border-orange-200">
              <h2 className="text-base font-semibold text-orange-700">⚠️ Внимание!</h2>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="bg-orange-50 rounded-xl p-4 border border-orange-200">
                <p className="text-sm text-orange-700">Свързването е отменено. Натиснете <strong>'Свържи с Google Drive'</strong> за да опитате отново.</p>
              </div>
              <button onClick={() => driveSetMessage("")} className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 transition">Разбрах</button>
            </div>
          </div>
        </div>
      )}
      {driveMessage === "reconnect" && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100] p-4">
          <div className="bg-blue-50 rounded-2xl shadow-xl w-full max-w-sm">
            <div className="px-5 py-4 border-b border-orange-200">
              <h2 className="text-base font-semibold text-orange-700">🔌 Връзката с Google Drive изтече</h2>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="bg-orange-50 rounded-xl p-4 border border-orange-200">
                <p className="text-sm text-orange-700">
                  Google пази връзката с Drive около 1 час. Докато не се свържете отново, копия в Google Drive не се качват и не могат да се възстановяват. Изборът ви за автоматично качване е запазен.
                </p>
              </div>
              <button
                onClick={() => { driveSetMessage(""); driveConnect(); }}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 transition"
              >
                🔗 Свържи отново
              </button>
              <button onClick={() => driveSetMessage("")} className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition">Не сега</button>
            </div>
          </div>
        </div>
      )}
      {driveMessage && driveMessage !== "allow" && driveMessage !== "blocked" && driveMessage !== "reconnect" && (
        <>
          {driveMessage.startsWith("✅") ? (
            <div className="fixed top-[calc(var(--banner-h)+1rem)] left-1/2 -translate-x-1/2 z-[100] rounded-xl shadow-lg px-4 py-3 max-w-sm w-full mx-4 border-2 bg-emerald-50 border-emerald-300">
              <div className="flex justify-between items-start gap-2">
                <p className="text-sm font-medium text-emerald-800">{driveMessage}</p>
                <button onClick={() => driveSetMessage("")} className="text-emerald-400 hover:text-emerald-600 text-lg leading-none flex-shrink-0">×</button>
              </div>
            </div>
          ) : (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100] p-4">
              <div className="bg-blue-50 rounded-2xl shadow-xl w-full max-w-sm">
                <div className={`px-5 py-4 border-b ${driveMessage.startsWith("❌") ? "border-red-200" : "border-orange-200"}`}>
                  <h2 className={`text-base font-semibold ${driveMessage.startsWith("❌") ? "text-red-700" : "text-orange-700"}`}>
                    {driveMessage.startsWith("❌") ? "❌ Грешка" : "⚠️ Внимание!"}
                  </h2>
                </div>
                <div className="px-5 py-4 space-y-3">
                  <div className={`rounded-xl p-4 border ${driveMessage.startsWith("❌") ? "bg-red-50 border-red-200" : "bg-orange-50 border-orange-200"}`}>
                    <p className={`text-sm ${driveMessage.startsWith("❌") ? "text-red-700" : "text-orange-700"}`}>
                      {driveMessage.replace(/^❌\s*/, "").replace(/^⚠️\s*/, "").replace(/^🔌\s*/, "")}
                    </p>
                  </div>
                  <button onClick={() => driveSetMessage("")} className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 transition">Разбрах</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
      {supabaseShowNewPassword && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100] p-4">
          <div className="bg-blue-50 rounded-2xl shadow-xl w-full max-w-sm">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-700">Нова парола</h2>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-sm text-gray-600">Въведете новата си парола:</p>
              <input
                type="password"
                placeholder="Нова парола"
                value={supabaseNewPassword}
                onChange={(e) => supabaseSetNewPassword(e.target.value)}
                className="w-full text-sm px-3 py-2 rounded-xl border border-gray-200 bg-white outline-none"
              />
              {supabaseMessage && <p className={`text-xs px-1 ${supabaseMessage.startsWith("✅") ? "text-green-600" : "text-red-500"}`}>{supabaseMessage}</p>}
              <button
                onClick={supabaseUpdatePassword}
                disabled={supabaseNewPasswordLoading}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 transition"
              >
                {supabaseNewPasswordLoading ? "Запазване..." : "Запази новата парола"}
              </button>
              <button
                onClick={() => supabaseSetShowNewPassword(false)}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
              >
                Откажи
              </button>
            </div>
          </div>
        </div>
      )}
      {supabaseMessage && (
        <>
          {supabaseMessage.startsWith("✅") ? (
            <div className="fixed top-[calc(var(--banner-h)+1rem)] left-1/2 -translate-x-1/2 z-[100] rounded-xl shadow-lg px-4 py-3 max-w-sm w-full mx-4 border-2 bg-emerald-50 border-emerald-300">
              <div className="flex justify-between items-start gap-2">
                <p className="text-sm font-medium text-emerald-800">{supabaseMessage}</p>
                <button onClick={() => supabaseSetMessage("")} className="text-emerald-400 hover:text-emerald-600 text-lg leading-none flex-shrink-0">×</button>
              </div>
            </div>
          ) : (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100] p-4">
              <div className="bg-blue-50 rounded-2xl shadow-xl w-full max-w-sm">
                <div className={`px-5 py-4 border-b ${supabaseMessage.startsWith("❌") ? "border-red-200" : "border-orange-200"}`}>
                  <h2 className={`text-base font-semibold ${supabaseMessage.startsWith("❌") ? "text-red-700" : "text-orange-700"}`}>
                    {supabaseMessage.startsWith("❌") ? "❌ Грешка" : "⚠️ Внимание!"}
                  </h2>
                </div>
                <div className="px-5 py-4 space-y-3">
                  <div className={`rounded-xl p-4 border ${supabaseMessage.startsWith("❌") ? "bg-red-50 border-red-200" : "bg-orange-50 border-orange-200"}`}>
                    <p className={`text-sm ${supabaseMessage.startsWith("❌") ? "text-red-700" : "text-orange-700"}`}>
                      {supabaseMessage.replace(/^❌\s*/, "").replace(/^🔌\s*/, "")}
                    </p>
                  </div>
                  <button onClick={() => supabaseSetMessage("")} className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 transition">Разбрах</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
      {bannersVisible && (
        <div ref={bannerStackRef} className="fixed top-0 left-0 right-0 z-[121] flex flex-col shadow-lg">
      {dbWriteError && (
        <div className="bg-red-500 text-white px-4 py-2.5 flex items-center justify-between gap-3">
          <p className="text-sm font-medium">
            {dbWriteError === "quota"
              ? "⚠️ Няма място на устройството — данните не се запазват! Освободете място и свалете резервно копие (Данни → Свали резервно копие)."
              : "⚠️ Проблем при запазване на данните! Свалете резервно копие (Данни → Свали резервно копие) и презаредете страницата."}
          </p>
          <button onClick={() => setDbWriteError(false)} className="text-white/80 hover:text-white text-lg leading-none flex-shrink-0">×</button>
        </div>
      )}
      {multiTabWarning && (
        <div className="bg-orange-500 text-white px-4 py-2.5 flex items-center justify-between gap-3">
          <p className="text-sm font-medium">⚠️ Приложението е отворено и в друг раздел или прозорец. Работата на две места едновременно може да доведе до загуба на данни — затворете другото копие и презаредете тази страница.</p>
          <button onClick={() => setMultiTabWarning(false)} className="text-white/80 hover:text-white text-lg leading-none flex-shrink-0">×</button>
        </div>
      )}
      {showUpdateAvailable && (
        <div className="bg-blue-600 text-white px-4 py-2.5 flex items-center justify-between gap-3">
          <p className="text-sm font-medium">🔄 Налична е нова версия на приложението.</p>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => updateSWRef.current?.(true)}
              className="text-xs font-semibold bg-white text-blue-600 px-3 py-1.5 rounded-lg hover:bg-blue-50 transition"
            >
              Обнови
            </button>
            <button onClick={() => setShowUpdateAvailable(false)} className="text-white/80 hover:text-white text-lg leading-none">×</button>
          </div>
        </div>
      )}
        </div>
      )}
      <div className="max-w-3xl mx-auto px-4 py-6">

        {/* Transaction Form */}
        <TransactionForm
          onAdd={addTransaction}
          onEdit={editTransaction}
          editingTransaction={editingTransaction}
          onCancelEdit={() => setEditingTransaction(null)}
          expenseCategories={expenseCategories}
          incomeCategories={incomeCategories}
          transactions={transactions}
          currency={currency}
          rate={rate}
          onUpdateCurrency={updateCurrency}
          onResetToEur={resetToEur}
          convert={convert}
          isLoaded={currencyLoaded}
          activeProfile={activeProfile}
          onOpenProfileModal={() => setShowProfileModal(true)}
        />

        {/* Summary Cards */}
        <SummaryCards
          summary={summary}
          isFiltered={isFiltered}
          budgets={budgets}
          filteredTransactions={filteredTransactions}
          allTransactions={transactions}
        />

        {/* Filter Bar */}
        <div className="bg-blue-50 rounded-2xl shadow-md overflow-hidden mb-6">
          <button
            onClick={() => setShowFilterPanel((prev) => !prev)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition"
          >
            <div className="flex items-center gap-2">
              <Search className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-semibold text-gray-600">Филтриране</span>
              {isFiltered && (
                <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-lg font-bold animate-pulse">
                  ⚠️ АКТИВЕН ФИЛТЪР
                </span>
              )}
            </div>
            <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showFilterPanel ? "rotate-180" : ""}`} />
          </button>
          {showFilterPanel && (
            <div className="border-t border-gray-100">
              <FilterBar
                filters={filters}
                setFilters={setFilters}
                onFilter={handleFilter}
                onClear={handleClearFilter}
                isFiltered={isFiltered}
                expenseCategories={expenseCategories}
                incomeCategories={incomeCategories}
                savedFilters={savedFilters}
                onSaveFilter={saveFilter}
                onDeleteFilter={deleteFilter}
              />
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col gap-3 mb-6">

          {/* Данни */}
          <div className="bg-blue-50 rounded-2xl shadow-md overflow-hidden">
            <button
              onClick={() => setShowDataPanel((prev) => !prev)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition"
            >
              <div className="flex items-center gap-2">
                <FileDown className="w-4 h-4 text-gray-400" />
                <span className="text-sm font-semibold text-gray-600">Данни</span>
              </div>
              <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showDataPanel ? "rotate-180" : ""}`} />
            </button>
            {showDataPanel && (
              <div className="px-4 pb-4 flex flex-col gap-2 border-t border-gray-100 pt-3">
                <button
                  onClick={() => setShowMonthlyStats(true)}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition"
                >
                  <TrendingUp className="w-4 h-4" />
                  Месечна статистика
                </button>
                <button
                  onClick={() => setShowCharts(true)}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-purple-50 text-purple-500 hover:bg-purple-100 transition"
                >
                  <BarChart2 className="w-4 h-4" />
                  Графики
                </button>
                <button
                  onClick={() => { setImportExportMode("import"); setShowImportExport(true); }}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-orange-50 text-orange-500 hover:bg-orange-100 transition"
                >
                  <Upload className="w-4 h-4" />
                  Импорт от Excel
                </button>
                <button
                  onClick={() => { setImportExportMode("export"); setShowImportExport(true); }}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-green-50 text-green-600 hover:bg-green-100 transition"
                >
                  <FileDown className="w-4 h-4" />
                  Експорт към Excel
                </button>
                <button
                  onClick={handleBackupExport}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-blue-50 text-blue-500 hover:bg-blue-100 transition"
                >
                  <FileDown className="w-4 h-4" />
                  Свали резервно копие
                </button>
                {lastLocalBackupDate && (
                  <p className="text-xs text-gray-400 px-1">
                    последно сваляне: {new Date(lastLocalBackupDate).toLocaleDateString("bg-BG", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </p>
                )}
                <button
                  onClick={() => { backupFileRef.current.value = ""; backupFileRef.current.click(); }}
                  disabled={restoreInProgress}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-blue-50 text-blue-500 hover:bg-blue-100 transition"
                >
                  <Upload className="w-4 h-4" />
                  Възстанови от файл
                </button>
                <button
                  onClick={() => setShowDeleteAll(true)}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-red-50 text-red-500 hover:bg-red-100 transition"
                >
                  <Trash2 className="w-4 h-4" />
                  Изтрий всички данни
                </button>

                {storageUsage && (
                  <div className="px-1">
                    <p className="text-xs text-gray-400">
                      Заето място на устройството: {formatBytes(storageUsage.usage)} от {formatBytes(storageUsage.quota)} ({storageUsage.ratio < 0.001 ? "под 0,1" : (storageUsage.ratio * 100).toLocaleString("bg-BG", { maximumFractionDigits: storageUsage.ratio < 0.1 ? 1 : 0 })}%)
                    </p>
                    {storageUsage.ratio >= STORAGE_WARN_RATIO && (
                      <p className="text-xs text-orange-500 font-medium mt-1 bg-orange-50 rounded-lg px-2 py-1">
                        ⚠️ Мястото на устройството почти е свършило. Свалете резервно копие и освободете място, иначе записът на нови данни може да се провали.
                      </p>
                    )}
                  </div>
                )}

                <div className="border-t border-gray-200 pt-2 mt-1">
                  <p className="text-xs font-semibold text-gray-400 mb-2 px-1">Напомняне за резервно копие</p>
                  <div className="flex flex-col gap-1 px-1">
                    {[
                      { value: "off", label: "Изключено" },
                      { value: "weekly", label: "Веднъж седмично" },
                      { value: "monthly", label: "Веднъж месечно" },
                      { value: "quarterly", label: "Веднъж на 3 месеца" },
                    ].map((opt) => (
                      <label key={opt.value} className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                        <input
                          type="radio"
                          name="backupReminder"
                          value={opt.value}
                          checked={backupReminderInterval === opt.value}
                          onChange={() => setConfirmDialog({
                            title: "Смяна на напомнянето за резервно копие",
                            message: `Напомнянето за резервно копие ще бъде променено на „${opt.label}“.`,
                            confirmLabel: "Потвърди",
                            tone: "warning",
                            onConfirm: () => {
                              localStorage.setItem("backup_reminder_interval", opt.value);
                              setBackupReminderInterval(opt.value);
                            },
                          })}
                          className="accent-blue-500"
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="border-t border-gray-200 pt-2 mt-1">
                  <p className="text-xs font-semibold text-gray-400 mb-2 px-1">Google Drive</p>
                  {!driveConnected ? (
                    <>
                      <div className="text-xs text-orange-500 font-medium px-1 mb-2 bg-orange-50 rounded-lg py-1">
                        ⚠️ ако браузърът поиска разрешение за cookies - разрешете и натиснете бутона "Свържи с Google Drive" отново
                      </div>
                      <button
                        onClick={() => {
                          if (supabaseConnected) {
                            setShowCrossServiceWarning("toDrive");
                          } else {
                            setShowDataPanel(true);
                            sessionStorage.setItem("pending_auto_upload_notice_drive", "1");
                            driveConnect();
                          }
                        }}
                        disabled={driveUploadLoading || driveDownloadLoading}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-blue-50 text-blue-500 hover:bg-blue-100 transition w-full"
                      >
                        🔗 Свържи с Google Drive
                      </button>
                    </>
                  ) : (
                    <>
                      {driveNeedsReconnect && (
                        <div className="bg-orange-50 border border-orange-200 rounded-xl px-3 py-2 mb-2">
                          <p className="text-xs text-orange-700 font-semibold mb-0.5">🔌 Връзката с Google Drive изтече</p>
                          <p className="text-xs text-orange-600 mb-2">
                            Копия в Google Drive не се качват, докато не се свържете отново. Изборът за автоматично качване е запазен.
                          </p>
                          <button
                            onClick={driveConnect}
                            className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 transition w-full"
                          >
                            🔗 Свържи отново
                          </button>
                        </div>
                      )}
                      <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-2">
                        <p className="text-xs text-amber-700 font-semibold mb-0.5">⏱️ Забележка за връзката с Google</p>
                        <p className="text-xs text-amber-600">
                          Google пази връзката с Drive около <strong>1 час</strong>. След това качването (и автоматичното) спира, докато не натиснете „Свържи отново“ — приложението ще ви подкани, а изборът за автоматично качване се запазва. За постоянна връзка без прекъсвания използвайте резервно копие в Облака.
                        </p>
                      </div>
                      <div className="flex flex-col gap-1 px-1 py-1 mb-1">
                        <p className="text-xs text-gray-500 mb-1">Автоматично качване:</p>
                        {[
                          { value: "off", label: "Изключено" },
                          { value: "onChange", label: "При всяка промяна" },
                          { value: "daily", label: "Веднъж дневно" },
                        ].map((opt) => (
                          <label key={opt.value} className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                            <input
                              type="radio"
                              name="driveAutoSync"
                              value={opt.value}
                              checked={driveAutoSync === opt.value}
                              onChange={() => setConfirmDialog({
                                title: "Смяна на автоматичното качване",
                                message: `Автоматичното качване в Google Drive ще бъде променено на „${opt.label}“.`,
                                confirmLabel: "Потвърди",
                                tone: "warning",
                                onConfirm: () => driveToggleAutoSync(opt.value),
                              })}
                              className="accent-blue-500"
                            />
                            {opt.label}
                          </label>
                        ))}
                      </div>
                      <button
                        onClick={handleDriveUpload}
                        disabled={driveUploadLoading}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-blue-50 text-blue-500 hover:bg-blue-100 transition w-full mb-1"
                      >
                        ☁️ {driveUploadLoading ? "Качване..." : "Запази в Google Drive"}
                      </button>
                      {localStorage.getItem("last_drive_upload_date") && (
                        <p className="text-xs text-gray-400 px-1">
                          последно качване: {new Date(localStorage.getItem("last_drive_upload_date")).toLocaleDateString("bg-BG", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </p>
                      )}
                      <button
                        onClick={() => restoreFromCloud("drive")}
                        disabled={driveDownloadLoading || !!cloudBackupChoices || showConflictModal || showRestoreConfirm || showRestoreDuplicates || showAddNewProfilesConfirm || restoreInProgress}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-green-50 text-green-600 hover:bg-green-100 transition w-full mb-1"
                      >
                        ⬇️ {driveDownloadLoading ? "Изтегляне..." : "Възстанови от Google Drive"}
                      </button>
                      {supabaseConnected && (
                        <p className="text-xs text-orange-500 px-1 mb-1">
                          ⚠️ Ще изключи и Облака (обща връзка).
                        </p>
                      )}
                      <button
                        onClick={() => setConfirmDialog({
                          title: "Изключване на Google Drive",
                          message: "Синхронизацията с Google Drive на това устройство ще бъде спряна и автоматичното качване ще се изключи (другите ви устройства остават свързани). Файловете в Google Drive остават непокътнати."
                            + (supabaseConnected ? " Това ще прекъсне и връзката с Облака (обща връзка)." : ""),
                          confirmLabel: "Изключи",
                          tone: "danger",
                          onConfirm: driveDisconnect,
                        })}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-red-50 text-red-400 hover:bg-red-100 transition w-full"
                      >
                        🔌 Изключи Google Drive
                      </button>
                    </>
                  )}
                  </div>

                <div className="border-t border-gray-200 pt-2 mt-1">
                  <p className="text-xs font-semibold text-gray-400 mb-1 px-1">☁️ Резервно копие в Облака</p>
                  {!supabaseConnected ? (
                    <div className="flex flex-col gap-2">
                      <div className="flex gap-2 px-1">
                        <button
                          onClick={() => supabaseSetAuthMode("login")}
                          className={`text-xs px-3 py-1 rounded-lg transition ${supabaseAuthMode === "login" ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-600"}`}
                        >
                          Вход
                        </button>
                        <button
                          onClick={() => supabaseSetAuthMode("register")}
                          className={`text-xs px-3 py-1 rounded-lg transition ${supabaseAuthMode === "register" ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-600"}`}
                        >
                          Регистрация
                        </button>
                      </div>
                      <input
                        type="email"
                        placeholder="Имейл"
                        value={supabaseAuthEmail}
                        onChange={(e) => supabaseSetAuthEmail(e.target.value)}
                        className="text-xs px-3 py-2 rounded-xl border border-gray-200 bg-white outline-none"
                      />
                      <input
                        type="password"
                        placeholder="Парола"
                        value={supabaseAuthPassword}
                        onChange={(e) => supabaseSetAuthPassword(e.target.value)}
                        className="text-xs px-3 py-2 rounded-xl border border-gray-200 bg-white outline-none"
                      />
                      {supabaseAuthMode === "login" && (
                        <button
                          onClick={() => { supabaseSetShowReset(true); supabaseSetAuthError(""); }}
                          className="text-xs text-blue-400 hover:text-blue-600 text-left px-1"
                        >
                          Забравена парола?
                        </button>
                      )}
                      {supabaseShowReset && (
                        <div className="flex flex-col gap-2 bg-blue-50 border border-blue-200 rounded-xl p-3">
                          <p className="text-xs text-blue-700 font-medium">Въведете имейла си и ще получите линк за нова парола:</p>
                          <input
                            type="email"
                            placeholder="Имейл"
                            value={supabaseResetEmail}
                            onChange={(e) => supabaseSetResetEmail(e.target.value)}
                            className="text-xs px-3 py-2 rounded-xl border border-gray-200 bg-white outline-none"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={supabaseSendResetEmail}
                              disabled={supabaseResetLoading}
                              className="flex-1 px-3 py-2 rounded-xl text-xs font-medium bg-blue-500 text-white hover:bg-blue-600 transition"
                            >
                              {supabaseResetLoading ? "Изпращане..." : "Изпрати"}
                            </button>
                            <button
                              onClick={() => { supabaseSetShowReset(false); supabaseSetAuthError(""); }}
                              className="flex-1 px-3 py-2 rounded-xl text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
                            >
                              Откажи
                            </button>
                          </div>
                        </div>
                      )}
                      {supabaseAuthError && (
                        <p className={`text-xs px-1 ${supabaseAuthError.startsWith("✅") ? "text-green-600" : "text-red-500"}`}>
                          {supabaseAuthError}
                        </p>
                      )}
                      <button
                        onClick={() => {
                          if (driveConnected) {
                            setShowCrossServiceWarning("toSupabase");
                          } else {
                            supabaseConnectWithEmail();
                          }
                        }}
                        disabled={supabaseAuthLoading}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-blue-50 text-blue-500 hover:bg-blue-100 transition w-full"
                      >
                        🔗 {supabaseAuthLoading ? "Зареждане..." : supabaseAuthMode === "login" ? "Влез в облака" : "Регистрирай се"}
                      </button>
                    </div>
                  ) : !supabaseEnabled ? (
                    <button
                      onClick={supabaseEnable}
                      className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-blue-50 text-blue-500 hover:bg-blue-100 transition w-full mb-1"
                    >
                      🔗 Активирай резервно копие в Облака
                    </button>
                  ) : (
                    <>
                      <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-2 mb-2">
                        <p className="text-xs text-green-700 font-semibold mb-0.5">✅ Без ограничения на сесията</p>
                        <p className="text-xs text-green-600">
                          Сесията се поддържа автоматично. Не е нужно повторно вписване.
                        </p>
                      </div>
                      <div className="flex flex-col gap-1 px-1 py-1 mb-1">
                        <p className="text-xs text-gray-500 mb-1">Автоматично качване:</p>
                        {[
                          { value: "off", label: "Изключено" },
                          { value: "onChange", label: "При всяка промяна" },
                          { value: "daily", label: "Веднъж дневно" },
                        ].map((opt) => (
                          <label key={opt.value} className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                            <input
                              type="radio"
                              name="supabaseAutoSync"
                              value={opt.value}
                              checked={supabaseAutoSync === opt.value}
                              onChange={() => setConfirmDialog({
                                title: "Смяна на автоматичното качване",
                                message: `Автоматичното качване в Облака ще бъде променено на „${opt.label}“.`,
                                confirmLabel: "Потвърди",
                                tone: "warning",
                                onConfirm: () => supabaseToggleAutoSync(opt.value),
                              })}
                              className="accent-blue-500"
                            />
                            {opt.label}
                          </label>
                        ))}
                      </div>
                      <button
                        onClick={handleSupabaseUpload}
                        disabled={supabaseUploadLoading}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-blue-50 text-blue-500 hover:bg-blue-100 transition w-full mb-1"
                      >
                        ☁️ {supabaseUploadLoading ? "Качване..." : "Запази в облака"}
                      </button>
                      {lastSupabaseUploadDate && (
                        <p className="text-xs text-gray-400 px-1 mb-1">
                          последно качване: {new Date(lastSupabaseUploadDate).toLocaleDateString("bg-BG", {
                            day: "2-digit", month: "2-digit", year: "numeric",
                            hour: "2-digit", minute: "2-digit"
                          })}
                        </p>
                      )}
                      <button
                        onClick={() => restoreFromCloud("supabase")}
                        disabled={supabaseDownloadLoading || !!cloudBackupChoices || showConflictModal || showRestoreConfirm || showRestoreDuplicates || showAddNewProfilesConfirm || restoreInProgress}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-green-50 text-green-600 hover:bg-green-100 transition w-full mb-1"
                      >
                        ⬇️ {supabaseDownloadLoading ? "Изтегляне..." : "Възстанови от облака"}
                      </button>
                      <button
                        onClick={() => setConfirmDialog({
                          title: "Деактивиране на резервното копие",
                          message: "Автоматичното и ръчното качване в Облака ще спрат. Вписването в акаунта се запазва — можете да активирате отново по всяко време.",
                          confirmLabel: "Деактивирай",
                          tone: "warning",
                          onConfirm: supabaseDisable,
                        })}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-gray-100 text-gray-500 hover:bg-gray-200 transition w-full mt-1 mb-1"
                      >
                        ⏸️ Деактивирай резервно копие
                      </button>
                      {driveConnected && (
                        <p className="text-xs text-orange-500 px-1 mb-1">
                          ⚠️ Ще изключи и Google Drive (обща връзка).
                        </p>
                      )}
                      <button
                        onClick={() => setConfirmDialog({
                          title: "Изход от Облака",
                          message: "Ще излезете от акаунта в Облака на това устройство и синхронизацията тук ще спре (другите ви устройства остават вписани). Резервните копия в Облака остават запазени и достъпни при следващо вписване."
                            + (driveConnected ? " Това ще прекъсне и връзката с Google Drive (обща връзка)." : ""),
                          confirmLabel: "Изход",
                          tone: "danger",
                          onConfirm: supabaseDisconnect,
                        })}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-red-50 text-red-400 hover:bg-red-100 transition w-full"
                      >
                        🔌 Изход от облака
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Бутони над историята */}
        <div className="flex flex-col gap-3 mb-3">
          <button
            onClick={() => setShowBudget(true)}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-medium bg-orange-50 text-orange-500 hover:bg-orange-100 transition shadow-sm"
          >
            <AlertTriangle className="w-4 h-4" />
            Бюджетни лимити
          </button>
          <button
            onClick={() => setShowCategoryManager(true)}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-medium bg-green-50 text-green-600 hover:bg-green-100 transition shadow-sm"
          >
            <Settings className="w-4 h-4" />
            Управление на категории
          </button>
          <button
            onClick={() => { if (!showPendingModal) setShowRecurringModal(true); }}
            disabled={showPendingModal}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-medium bg-purple-50 text-purple-500 hover:bg-purple-100 transition shadow-sm disabled:opacity-40"
          >
            <RefreshCw className="w-4 h-4" />
            Повтарящи се транзакции
          </button>
          
          <button
            onClick={() => setShowUserGuide(true)}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-medium bg-blue-50 text-blue-500 hover:bg-blue-100 transition shadow-sm"
          >
            <Info className="w-4 h-4" />
            Ръководство за потребителя
          </button>
        </div>

        {/* Transaction List */}
        <TransactionList
          transactions={filteredTransactions}
          isFiltered={isFiltered}
          profileId={activeProfileId}
          onEdit={(t) => {
            setEditingTransaction(t);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          onDelete={deleteTransaction}
        />
      </div>

      {/* Modals */}
      {showCategoryManager && (
        <CategoryManager
          expenseCategories={expenseCategories}
          incomeCategories={incomeCategories}
          onAdd={addCategory}
          onEdit={handleEditCategory}
          onDelete={handleDeleteCategory}
          getUsage={getCategoryUsage}
          onClose={() => setShowCategoryManager(false)}
        />
      )}

      
      {showImportExport && (
        <ImportExportModal
          onClose={() => setShowImportExport(false)}
          transactions={transactions}
          filteredTransactions={filteredTransactions}
          isFiltered={isFiltered}
          activeFilters={activeFilters}
          onImportAdd={addTransactions}
          onImportReplace={replaceAllTransactions}
          onCategoriesImported={handleCategoriesImported}
          mode={importExportMode}
          expenseCategories={expenseCategories}
          incomeCategories={incomeCategories}
          profileName={activeProfile?.name}
        />
      )}

      {showMonthlyStats && (
        <MonthlyStats
          transactions={transactions}
          filteredTransactions={filteredTransactions}
          isFiltered={isFiltered}
          activeFilters={activeFilters}
          onClose={() => setShowMonthlyStats(false)}
          rollingMonths={rollingMonths}
          onRollingMonthsChange={setRollingMonths}
          profileName={activeProfile?.name}
        />
      )}

      {showCharts && (
        <ChartsModal
          transactions={transactions}
          filteredTransactions={filteredTransactions}
          isFiltered={isFiltered}
          activeFilters={activeFilters}
          onClose={() => setShowCharts(false)}
          rollingMonths={rollingMonths}
        />
      )}

      <input
        ref={backupFileRef}
        type="file"
        accept=".json"
        onChange={handleBackupFileSelect}
        className="hidden"
      />
      {showRestoreDuplicates && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-blue-50 rounded-2xl shadow-xl w-full max-w-sm max-h-[90vh] overflow-y-auto">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-700">Вероятни дубликати</h2>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div className="bg-orange-50 rounded-xl px-3 py-2 text-xs text-orange-700">
                ⚠️ Намерени са <strong>{restoreDuplicates.length}</strong> вероятни дубликата за <strong>{profiles.find(p => p.id === pendingMergeProfileId)?.name ?? ""}</strong> (същата дата, категория, тип и сума вече съществуват). Уникални транзакции за добавяне: <strong>{restoreUniqueTransactions.length}</strong>.
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-gray-600">Вероятни дубликати:</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setRestoreSelectedDuplicates(restoreDuplicates.map((t) => t.id))}
                      className="text-xs px-2 py-1 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition"
                    >
                      Избери всички дубликати
                    </button>
                    <button
                      onClick={() => setRestoreSelectedDuplicates([])}
                      className="text-xs px-2 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
                    >
                      Откажи всички дубликати
                    </button>
                  </div>
                </div>
                <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
                  {restoreDuplicates.map((t) => (
                    <label
                      key={t.id}
                      className={`flex items-center gap-3 px-3 py-2 rounded-xl border cursor-pointer transition ${
                        restoreSelectedDuplicates.includes(t.id)
                          ? "border-blue-300 bg-blue-50"
                          : "border-gray-200 bg-white"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={restoreSelectedDuplicates.includes(t.id)}
                        onChange={() => setRestoreSelectedDuplicates((prev) =>
                          prev.includes(t.id) ? prev.filter((d) => d !== t.id) : [...prev, t.id]
                        )}
                        className="accent-blue-500 flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-700 truncate">{t.category}</p>
                        <p className="text-xs text-gray-400">{t.date} · {Number(t.amount).toFixed(2)} EUR</p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
                        t.type === "expense" ? "bg-red-100 text-red-600" : "bg-green-100 text-green-600"
                      }`}>
                        {t.type === "expense" ? "Разход" : "Приход"}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <button
                onClick={() => runRestoreStep(handleRestoreDuplicatesConfirm)}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition"
              >
                Потвърди ({restoreUniqueTransactions.length + restoreSelectedDuplicates.length} транзакции)
              </button>
              <p className="text-xs text-gray-400 px-1">
                Откажи ще спре цялото възстановяване — нищо от резервното копие няма да бъде записано.
              </p>
              <button
                onClick={resetRestoreState}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
              >
                Откажи
              </button>
            </div>
          </div>
        </div>
      )}
      {showAddNewProfilesConfirm && pendingNewProfiles.length > 0 && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-blue-50 rounded-2xl shadow-xl w-full max-w-sm max-h-[90dvh] flex flex-col">
            <div className="px-5 py-4 border-b border-gray-100 shrink-0">
              <h2 className="text-base font-semibold text-gray-700">Нови профили в резервното копие</h2>
            </div>
            <div className="px-5 py-4 space-y-3 overflow-y-auto min-h-0">
              <p className="text-sm text-gray-600">
                Следните профили са в резервното копие, но не съществуват локално. Искате ли да ги добавите заедно с техните данни?
              </p>
              <div className="flex flex-col gap-1.5">
                {pendingNewProfiles.map((p) => (
                  <div key={p.id} className="bg-white rounded-xl px-3 py-2 border border-gray-200 text-sm text-gray-700">
                    👤 {p.name}
                  </div>
                ))}
              </div>
            </div>
            <div className="px-5 py-4 border-t border-gray-100 space-y-3 shrink-0">
              <button
                onClick={() => runRestoreStep(() => applyRestore(pendingBackup, true))}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 transition"
              >
                Да, добави ги
              </button>
              <button
                onClick={() => runRestoreStep(() => applyRestore(pendingBackup, false))}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
              >
                Не, пропусни ги
              </button>
              <p className="text-xs text-gray-400 px-1">
                Откажи ще спре цялото възстановяване — нищо от резервното копие няма да бъде записано.
              </p>
              <button
                onClick={resetRestoreState}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
              >
                Откажи
              </button>
            </div>
          </div>
        </div>
      )}
      {showConflictModal && conflictProfiles.length > 0 && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-blue-50 rounded-2xl shadow-xl w-full max-w-sm max-h-[90dvh] flex flex-col">
            <div className="px-5 py-4 border-b border-gray-100 shrink-0">
              <h2 className="text-base font-semibold text-gray-700">Съвпадащи профили</h2>
            </div>
            <div className="px-5 py-4 space-y-4 overflow-y-auto min-h-0">
              <p className="text-sm text-gray-600">
                Следните профили съществуват и в приложението, и в резервното копие. Изберете какво да се направи за всеки:
              </p>
              {/* Само отвореният профил е със „Замести“ по подразбиране (одит 2026-10, 3-16) */}
              {conflictProfiles.some((p) => p.id !== activeProfileId) && (
                <p className="text-xs text-gray-500">
                  {conflictProfiles.some((p) => p.id === activeProfileId)
                    ? `По подразбиране се заменя само отвореният профил „${activeProfile?.name ?? ""}“. `
                    : "По подразбиране не се заменя нито един профил. "}
                  За другите е избрано „Запази само локалните“ — в копието те може да са по-стари, отколкото на устройството. Сменете избора, ако искате и техните данни от копието.
                </p>
              )}
              {conflictProfiles.map((p) => (
                <div key={p.id} className="bg-white rounded-xl p-3 border border-gray-200">
                  <p className="text-sm font-semibold text-gray-700 mb-2">👤 {p.name}</p>
                  {restoreBackupNames[p.id] && (
                    <p className="text-xs text-gray-500 -mt-1 mb-2">
                      В резервното копие: „{restoreBackupNames[p.id]}“. Името на устройството остава „{p.name}“.
                    </p>
                  )}
                  {nameOnlyMatchIds.includes(p.id) && (
                    <div className="bg-yellow-50 border border-yellow-300 rounded-lg px-3 py-2 mb-2">
                      <p className="text-xs text-yellow-700">
                        ⚠️ Забелязахме друг профил със същото име — сигурен ли си, че е един и същ човек? Ако не си сигурен, избери "Запази само локалните данни".
                      </p>
                    </div>
                  )}
                  <div className="flex flex-col gap-1.5">
                    <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                      <input
                        type="radio"
                        name={`conflict_${p.id}`}
                        value="backup"
                        checked={conflictChoices[p.id] === "backup"}
                        onChange={() => setConflictChoices((prev) => ({ ...prev, [p.id]: "backup" }))}
                      />
                      Зареди данните от резервното копие (замести локалните)
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                      <input
                        type="radio"
                        name={`conflict_${p.id}`}
                        value="local"
                        checked={conflictChoices[p.id] === "local"}
                        onChange={() => setConflictChoices((prev) => ({ ...prev, [p.id]: "local" }))}
                      />
                      Запази само локалните данни (игнорирай резервното копие)
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                      <input
                        type="radio"
                        name={`conflict_${p.id}`}
                        value="merge"
                        checked={conflictChoices[p.id] === "merge"}
                        onChange={() => setConflictChoices((prev) => ({ ...prev, [p.id]: "merge" }))}
                      />
                      Обедини (добави транзакциите от резервното копие към съществуващите)
                    </label>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-5 py-4 border-t border-gray-100 flex flex-col gap-2 shrink-0">
              <button
                onClick={() => { setShowConflictModal(false); setShowRestoreConfirm(true); }}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 transition"
              >
                Продължи
              </button>
              <button
                onClick={() => { completedRestoreProfilesRef.current = []; setShowConflictModal(false); setConflictProfiles([]); setConflictChoices({}); setPendingBackup(null); setPendingNewProfiles([]); pendingNewProfilesRef.current = []; setNameOnlyMatchIds([]); }}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
              >
                Откажи
              </button>
            </div>
          </div>
        </div>
      )}

      {cloudBackupChoices && (
              <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
                <div className="bg-blue-50 rounded-2xl shadow-xl w-full max-w-sm max-h-[90vh] flex flex-col">
                  <div className="px-5 py-4 border-b border-gray-100 shrink-0">
                    <h2 className="text-base font-semibold text-gray-700">
                      Изберете резервно копие
                    </h2>
                  </div>
                  <div className="px-5 pt-5 pb-3 space-y-3 overflow-y-auto min-h-0">
                    <p className="text-sm text-gray-600">
                      {cloudBackupChoices.source === "drive" ? "В Google Drive" : "В облака"} има {cloudBackupChoices.copies.length} резервни копия за профил „{activeProfile?.name}“ (по едно на ден). Изберете от коя дата да се възстанови.
                      {cloudBackupChoices.source === "supabase" && " Ако сте на ново устройство или профилът е създаден наново, вашето копие обикновено е „от друго устройство или по-стар профил“."}
                    </p>
                    {cloudBackupChoices.copies.map((copy) => (
                      <button
                        key={copy.fileId || copy.fileName}
                        onClick={async () => {
                          const source = cloudBackupChoices.source;
                          setCloudBackupChoices(null);
                          const data = source === "drive"
                            ? await driveDownloadBackup(copy.fileId)
                            : await supabaseDownloadBackup(copy.fileName);
                          if (data) await startCloudRestore(data, source);
                        }}
                        className="w-full text-left bg-white rounded-xl p-3 border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition"
                      >
                        <p className="text-sm font-medium text-gray-700">
                          {copy.updatedAt
                            ? new Date(copy.updatedAt).toLocaleDateString("bg-BG", {
                                day: "2-digit", month: "2-digit", year: "numeric",
                                hour: "2-digit", minute: "2-digit"
                              })
                            : copy.fileName}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {[
                            formatBackupSize(copy.size),
                            cloudBackupChoices.source === "supabase" && (copy.isSameProfile ? "от този профил" : "от друго устройство или по-стар профил"),
                          ].filter(Boolean).join(" · ")}
                        </p>
                      </button>
                    ))}
                  </div>
                  <div className="px-5 pb-5 pt-2 shrink-0">
                    <button
                      onClick={() => setCloudBackupChoices(null)}
                      className="w-full px-4 py-2 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
                    >
                      Откажи
                    </button>
                  </div>
                </div>
              </div>
      )}

      {showRestoreConfirm && pendingBackup && (
              <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
                <div className="bg-blue-50 rounded-2xl shadow-xl w-full max-w-sm max-h-[90vh] flex flex-col">
                  <div className="px-5 py-4 border-b border-gray-100 shrink-0">
                    <h2 className="text-base font-semibold text-gray-700">
                      Възстановяване от резервно копие
                    </h2>
                  </div>
                  <div className="px-5 pt-5 pb-3 space-y-3 overflow-y-auto min-h-0">
                    {/* Копие само на един профил, свалено при грешка в базата (одит 2026-10, 7-02) */}
                    {pendingBackup.onlyProfile && (
                      <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
                        <p className="text-sm text-blue-700 font-medium mb-1">ℹ️ Копие само на един профил</p>
                        <p className="text-sm text-blue-600">
                          Това копие е свалено при проблем с данните на устройството и съдържа само профил „{(pendingBackup.profiles || []).map((p) => p.name).join(", ")}“. Другите профили на устройството няма да бъдат променени.
                        </p>
                      </div>
                    )}
                    {/* Без съвпадащи профили всички профили от копието са нови — локалните данни не се пипат (одит 2026-10, 2Б-02) */}
                    {conflictProfiles.length === 0 && (
                      <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
                        <p className="text-sm text-blue-700 font-medium mb-1">ℹ️ Само нови профили</p>
                        <p className="text-sm text-blue-600">
                          Резервното копие съдържа само профили, които ги няма на устройството ({pendingNewProfiles.length}): {pendingNewProfiles.map((p) => p.name).join(", ")}. След „Потвърди“ ще бъдете попитани дали да ги добавите.
                        </p>
                        <p className="text-sm text-blue-600 mt-2">Данните на устройството няма да бъдат променени.</p>
                      </div>
                    )}
                    {conflictProfiles.map((bp) => {
                      const choice = conflictChoices[bp.id] || "backup";
                      const localCount = localTransactionCounts[bp.id] ?? transactions.filter(t => t.profileId === bp.id).length;
                      const backupCount = (pendingBackup.transactions || []).filter(t => t.profileId === bp.id).length;
                      return (
                        <div key={bp.id}>
                          {choice === "backup" && (
                            <div className="bg-orange-50 rounded-xl p-4">
                              <p className="text-sm text-orange-700 font-medium mb-1">⚠️ Внимание!</p>
                              <p className="text-sm text-orange-600">
                                Всички съществуващи данни за {bp.name} ({localCount} транзакции) ще бъдат заменени с данните от резервното копие ({backupCount} транзакции).
                              </p>
                              <p className="text-sm text-orange-600 mt-2">Това действие не може да бъде отменено.</p>
                            </div>
                          )}
                          {choice === "merge" && (
                            <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
                              <p className="text-sm text-blue-700 font-medium mb-1">ℹ️ Обединяване за {bp.name}</p>
                              <p className="text-sm text-blue-600">
                                Транзакциите от резервното копие ще бъдат добавени към съществуващите. Вероятните дубликати ще бъдат показани за преглед.
                              </p>
                            </div>
                          )}
                          {choice === "local" && (
                            <div className="bg-green-50 rounded-xl p-4 border border-green-200">
                              <p className="text-sm text-green-700 font-medium mb-1">✅ Локалните данни за {bp.name} се запазват</p>
                              <p className="text-sm text-green-600">
                                Данните от резервното копие за {bp.name} няма да бъдат заредени.
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="px-5 pt-2 pb-5 space-y-3 shrink-0">
                    <button
                      onClick={() => { setShowRestoreConfirm(false); runRestoreStep(handleRestoreConfirmClick); }}
                      className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 transition"
                    >
                      Потвърди
                    </button>
                    <button
                      onClick={() => { completedRestoreProfilesRef.current = []; setShowRestoreConfirm(false); setPendingBackup(null); setPendingNewProfiles([]); pendingNewProfilesRef.current = []; setConflictProfiles([]); setConflictChoices({}); setNameOnlyMatchIds([]); }}
                      className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
                    >
                      Откажи
                    </button>
                  </div>
                </div>
              </div>
            )}

      {restoreLossReport && pendingBackup && (
        <RestoreLossModal
          report={restoreLossReport}
          backupDate={pendingBackup.date}
          onConfirm={() => { setRestoreLossReport(null); runRestoreStep(handleRestoreConfirm); }}
          onMerge={handleRestoreLossMerge}
          onBack={handleRestoreLossBack}
        />
      )}

      {showCrossServiceWarning && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100] p-4">
          <div className="bg-blue-50 rounded-2xl shadow-xl w-full max-w-sm">
            <div className="px-5 py-4 border-b border-orange-200">
              <h2 className="text-base font-semibold text-orange-700">⚠️ Внимание!</h2>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="bg-orange-50 rounded-xl p-4 border border-orange-200">
                <p className="text-sm text-orange-700">
                  {showCrossServiceWarning === "toDrive"
                    ? "Google Drive и Облакът споделят една и съща връзка. Свързването с Google Drive ще изключи текущата връзка с Облака."
                    : supabaseAuthMode === "register"
                      // регистрация без сесия (потвърждение по имейл) не пипа Google сесията (3-12)
                      ? "Google Drive и Облакът споделят една и съща връзка. Ако регистрацията ви впише веднага, връзката с Google Drive ще се изключи. Ако получите имейл за потвърждение, Google Drive остава свързан до първия ви вход в Облака."
                      : "Google Drive и Облакът споделят една и съща връзка. Влизането в Облака ще изключи текущата връзка с Google Drive."}
                </p>
              </div>
              <button
                onClick={() => {
                  const action = showCrossServiceWarning;
                  setShowCrossServiceWarning(null);
                  markExpectedServiceSwitch();
                  if (action === "toDrive") {
                    // Облакът се изключва изрично — иначе остава „активиран“ и при сесия от
                    // Google може да качва финансови данни в Supabase (одит 2026-10, 3-02)
                    supabaseDisable();
                    setShowDataPanel(true);
                    // както при прекия бутон — след връщането от Google да излезе „Още една стъпка“ (3-14)
                    sessionStorage.setItem("pending_auto_upload_notice_drive", "1");
                    driveConnect();
                  } else {
                    supabaseConnectWithEmail();
                  }
                }}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 transition"
              >
                {showCrossServiceWarning === "toSupabase" && supabaseAuthMode === "register" ? "Продължи с регистрацията" : "Продължи и изключи другата връзка"}
              </button>
              <button
                onClick={() => setShowCrossServiceWarning(null)}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
              >
                Откажи
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[110] p-4">
          <div className="bg-blue-50 rounded-2xl shadow-xl w-full max-w-sm">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-700">{confirmDialog.title}</h2>
            </div>
            <div className="px-5 py-5 space-y-3">
              <div className={`rounded-xl p-4 border ${confirmDialog.tone === "danger" ? "bg-red-50 border-red-200" : "bg-orange-50 border-orange-200"}`}>
                <p className={`text-sm font-medium mb-1 ${confirmDialog.tone === "danger" ? "text-red-700" : "text-orange-700"}`}>{confirmDialog.label || "⚠️ Потвърждение"}</p>
                <p className={`text-sm ${confirmDialog.tone === "danger" ? "text-red-600" : "text-orange-600"}`}>
                  {confirmDialog.message}
                </p>
              </div>
              <button
                onClick={() => {
                  const { onConfirm: fn, restoreFrom } = confirmDialog;
                  setConfirmDialog(null);
                  fn?.();
                  if (restoreFrom) restoreFromCloud(restoreFrom);
                }}
                className={`w-full px-4 py-2.5 rounded-xl text-sm font-medium text-white transition ${confirmDialog.tone === "danger" ? "bg-red-500 hover:bg-red-600" : "bg-blue-500 hover:bg-blue-600"}`}
              >
                {confirmDialog.confirmLabel}
              </button>
              {confirmDialog.extraLabel && (
                <button
                  onClick={() => { const fn = confirmDialog.onExtra; setConfirmDialog(null); fn?.(); }}
                  className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-white text-blue-600 border border-blue-200 hover:bg-blue-50 transition"
                >
                  {confirmDialog.extraLabel}
                </button>
              )}
              <button
                onClick={() => { const fn = confirmDialog.onCancel; setConfirmDialog(null); fn?.(); }}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
              >
                {confirmDialog.cancelLabel || "Откажи"}
              </button>
            </div>
          </div>
        </div>
      )}

      {autoUploadNotice && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[110] p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-700">
                {autoUploadNotice === "drive" ? "Свързано с Google Drive" : "Свързано с Облака"}
              </h2>
            </div>
            <div className="px-5 py-5 space-y-3">
              <div className="rounded-xl p-4 border bg-orange-50 border-orange-200">
                <p className="text-sm font-medium mb-1 text-orange-700">⚠️ Още една стъпка</p>
                <p className="text-sm text-orange-600">
                  Връзката е успешна, но <strong>автоматичното качване все още е изключено</strong> по подразбиране. Резервни копия няма да се качват сами, докато не изберете „При всяка промяна“ или „Веднъж дневно“ от опциите за автоматично качване в панела „Данни“.
                </p>
              </div>
              <button
                onClick={() => setAutoUploadNotice(null)}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 transition"
              >
                Разбрах
              </button>
            </div>
          </div>
        </div>
      )}

      {weeklyBackupVisible && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-blue-50 rounded-2xl shadow-xl w-full max-w-sm">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-700">
                Седмично резервно копие
              </h2>
            </div>
            <div className="px-5 py-5 space-y-3">
              <p className="text-sm text-gray-600">
                Искате ли да свалите седмичното резервно копие с всички данни?
              </p>
              <button
                onClick={async () => {
                  setShowWeeklyBackup(false);
                  await handleBackupExport();
                }}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 transition"
              >
                Да, свали резервно копие
              </button>
              <button
                onClick={() => setShowWeeklyBackup(false)}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
              >
                Не сега
              </button>
            </div>
          </div>
        </div>
      )}

      {showBudget && (
        <BudgetModal
          budgets={budgets}
          onSave={updateBudgets}
          onClose={() => setShowBudget(false)}
          expenseCategories={expenseCategories}
          activeFilterCategories={activeFilters.categories}
          isFiltered={isFiltered}
        />
      )}

      {showProfileModal && (
        <ProfileModal
          profiles={profiles}
          activeProfileId={activeProfileId}
          onSwitch={switchProfile}
          onCreate={createProfile}
          onDelete={handleDeleteProfile}
          onRename={renameProfile}
          onClose={() => setShowProfileModal(false)}
          onOpenMerge={() => setShowMergeModal(true)}
          onOpenCopy={() => setShowCopyModal(true)}
          canClose={profiles.length > 0}
        />
      )}
      {showRecurringModal && (
        <RecurringModal
          recurringItems={recurringItems}
          expenseCategories={expenseCategories}
          incomeCategories={incomeCategories}
          onAdd={addRecurring}
          onEdit={editRecurring}
          onDelete={deleteRecurring}
          onClose={() => setShowRecurringModal(false)}
        />
      )}

      {showPendingModal && pendingRecurring.length > 0 && (
        <PendingRecurringModal
          pendingItems={pendingRecurring}
          onConfirm={handleConfirmPending}
          onClose={handleSnoozePending}
          onSkipAll={requestSkipPending}
        />
      )}
      {showUserGuide && (
        <UserGuideModal onClose={() => setShowUserGuide(false)} />
      )}

      {showRestoreDone && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-blue-50 rounded-2xl shadow-xl w-full max-w-sm">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-700">
                Възстановяването {restoreSource === "drive" ? "от Google Drive" : restoreSource === "supabase" ? "от облака" : "от файла"} е завършено
              </h2>
            </div>
            <div className="px-5 py-5 space-y-3">
              <div className="bg-green-50 rounded-xl p-4">
                <div className="text-sm text-green-700 font-medium mb-1">
                  {restoreDoneType.map((r, i) => (
                    <div key={i}>
                      {r.choice === "skipped"
                        ? `ℹ️ Новите профили не бяха добавени${r.name ? `: ${r.name}` : ""}.`
                        : r.name === ""
                        ? "✅ Данните са възстановени успешно."
                        : r.choice === "merge"
                        ? `✅ Данните за ${r.name} са обединени успешно.`
                        : r.choice === "local"
                        ? `✅ Данните за ${r.name} са запазени локално.`
                        : `✅ Данните за ${r.name} са възстановени успешно.`}
                      {r.notes?.map((note, j) => (
                        <p key={j} className="text-xs font-normal text-green-700 mt-1">ℹ️ {note}</p>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
              <button
                onClick={closeRestoreDone}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 transition"
              >
                Разбрах
              </button>
            </div>
          </div>
        </div>
      )}
      {restoreInProgress && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[115] p-4" role="alertdialog" aria-busy="true" aria-label="Възстановяване">
          <div className="bg-blue-50 rounded-2xl shadow-xl w-full max-w-xs px-5 py-6 flex flex-col items-center gap-3 text-center">
            <RefreshCw className="w-6 h-6 text-blue-500 animate-spin" />
            <p className="text-base font-semibold text-gray-700">Възстановяване…</p>
            <p className="text-xs text-gray-500">Данните се записват. Не затваряйте и не презареждайте приложението.</p>
          </div>
        </div>
      )}
      {restoreError && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-blue-50 rounded-2xl shadow-xl w-full max-w-sm max-h-[90vh] overflow-y-auto">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-700">
                Възстановяването спря поради грешка
              </h2>
            </div>
            <div className="px-5 py-5 space-y-3">
              <div className="bg-red-50 rounded-xl p-4 text-sm text-red-700 space-y-2">
                <p>Записът в паметта на устройството не успя и възстановяването беше прекъснато.</p>
                {restoreError.partial && (
                  <p className="font-medium">⚠️ Профил „{restoreError.partial}“ е възстановен само частично — проверете данните му.</p>
                )}
                <p>Профилите от копието, които не са изброени тук, не са променени.</p>
              </div>
              {restoreError.done.length > 0 && (
                <div className="bg-green-50 rounded-xl p-4 text-sm text-green-700 font-medium">
                  {restoreError.done.map((r, i) => (
                    <div key={i}>
                      {r.choice === "merge"
                        ? `✅ Данните за ${r.name} са обединени успешно.`
                        : r.choice === "local"
                        ? `✅ Данните за ${r.name} са запазени локално.`
                        : `✅ Данните за ${r.name} са възстановени успешно.`}
                      {r.notes?.map((note, j) => (
                        <p key={j} className="text-xs font-normal text-green-700 mt-1">ℹ️ {note}</p>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-gray-500">
                Презаредете страницата, за да видите данните, които са записани. Ако грешката се повтаря, освободете място на устройството и опитайте отново.
              </p>
              <button
                onClick={() => setRestoreError(null)}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 transition"
              >
                Разбрах
              </button>
            </div>
          </div>
        </div>
      )}
      {showCopyModal && (
        <CopyTransactionsModal
          profiles={profiles}
          activeProfileId={activeProfileId}
          activeProfileName={activeProfile?.name}
          onClose={() => setShowCopyModal(false)}
          onAdd={handleCopyTransactions}
        />
      )}

      {showMergeModal && (
        <MergeProfileModal
          onClose={() => setShowMergeModal(false)}
          onMerge={handleMergeImport}
          activeProfile={activeProfile}
          existingTransactions={transactions}
        />
      )}

      {showDeleteAll && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-blue-50 rounded-2xl shadow-xl w-full max-w-sm">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-700">
                Изтриване на всички данни
              </h2>
            </div>
            <div className="px-5 py-5 space-y-3">
              <div className="bg-red-50 rounded-xl p-4">
                <p className="text-sm text-red-700 font-medium mb-1">⚠️ Внимание!</p>
                <p className="text-sm text-red-600">
                  Всички транзакции ({transactions.length}) ще бъдат изтрити. Категориите ще останат.
                </p>
                <p className="text-sm text-red-600 mt-2">
                  Това действие не може да бъде отменено.
                </p>
              </div>
              {(driveConnected || (supabaseConnected && supabaseEnabled)) && (
                <div className="bg-orange-50 rounded-xl p-3 border border-orange-200">
                  <p className="text-sm text-orange-700">
                    ⚠️ Изтриват се само транзакциите на профил „{activeProfile?.name}“ на това устройство. Копията в {[driveConnected && "Google Drive", supabaseConnected && supabaseEnabled && "Облака"].filter(Boolean).join(" и ")} не се трият. Преди да ги замени с по-малко транзакции — автоматично или при „Запази“ — приложението ще ви попита.
                  </p>
                </div>
              )}
              <button
                onClick={() => {
                  markDeletedAll(activeProfileId, transactions.length);
                  replaceAllTransactions([]);
                  setShowDeleteAll(false);
                }}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-red-500 text-white hover:bg-red-600 transition"
              >
                Да, изтрий всичко
              </button>
              <button
                onClick={() => setShowDeleteAll(false)}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition"
              >
                Откажи
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;