import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Settings, Info, Upload, FileDown, Trash2, TrendingUp, ChevronDown, Search, BarChart2, AlertTriangle, User, RefreshCw } from "lucide-react";
import { useTransactions } from "./hooks/useTransactions";
import { useCategories, deleteProfileCategories, saveToDB as saveCategoriesDirectly } from "./hooks/useCategories";
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES } from "./constants/categories";
import { deleteProfileBudgets } from "./hooks/useBudgets";
import { deleteProfileSavedFilters } from "./hooks/useSavedFilters";
import { deleteProfileCurrency } from "./hooks/useCurrency";
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
import { useSavedFilters } from "./hooks/useSavedFilters";
import { useCurrency } from "./hooks/useCurrency";
import { useBudgets } from "./hooks/useBudgets";
import BudgetModal from "./components/BudgetModal";
import RecurringModal from "./components/RecurringModal";
import PendingRecurringModal from "./components/PendingRecurringModal";
import { useRecurring } from "./hooks/useRecurring";
import UserGuideModal from "./components/UserGuideModal";
import { useGoogleDrive } from "./hooks/useGoogleDrive";
import { useSupabaseStorage } from "./hooks/useSupabaseStorage";
import { openDB, onDBWriteError, runTx, reportDBError } from "./utils/db";
import { markExpectedServiceSwitch } from "./utils/crossServiceSwitch";
import { registerSW } from "virtual:pwa-register";

// Записите на един профил от store. При грешка или прекъсната транзакция отхвърля, вместо да
// виси завинаги (одит 2026-10, 1А-05)
const getProfileRecords = async (storeName, profileId) =>
  ((await runTx(storeName, "readonly", (store) => store.getAll())) || []).filter((r) => r.profileId === profileId);

// Провален запис спира възстановяването, вместо то да завърши с „успешно“ (одит 2026-10, 2А-01)
const ensureSaved = (ok) => {
  if (ok === false) throw new Error("Записът в базата не успя.");
};

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
    reassignTransactionsCategory,
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
  const { savedFilters, saveFilter, deleteFilter, restoreFilters, setSavedFilters, isLoaded: filtersLoaded } = useSavedFilters(activeProfileId);
  const { currency, rate, updateCurrency, resetToEur, convert, isLoaded: currencyLoaded, restoreCurrency } = useCurrency(activeProfileId);
  const { budgets, updateBudgets, restoreBudgets } = useBudgets(activeProfileId);
  const {
    recurringItems,
    addRecurring,
    editRecurring,
    deleteRecurring,
    markAsAdded,
    deleteAllByProfile: deleteAllRecurringByProfile,
    restoreRecurring,
    getPendingTransactions,
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
  // Форма: { title, message, confirmLabel, tone: "danger" | "warning", onConfirm }
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
  const [showCrossServiceWarning, setShowCrossServiceWarning] = useState(null); // 'toDrive' | 'toSupabase' | null
  const [backupReminderInterval, setBackupReminderInterval] = useState(
    () => localStorage.getItem("backup_reminder_interval") ?? "weekly"
  );
  const [lastLocalBackupDate, setLastLocalBackupDate] = useState(
    () => localStorage.getItem("last_local_backup_date") ?? null
  );
  const {
    connected: driveConnected,
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
  useEffect(() => {
    if (!activeProfileId || recurringItems.length === 0) return;
    if (showRecurringModal) return;
    if (showPendingModal) return;
    if (showConflictModal || showRestoreConfirm || showRestoreDuplicates || showAddNewProfilesConfirm || restoreInProgress) return;
    const pending = getPendingTransactions();
    if (pending.length > 0) {
      setPendingRecurring(pending);
      setShowPendingModal(true);
    }
  }, [activeProfileId, recurringItems, showRecurringModal, showConflictModal, showRestoreConfirm, showRestoreDuplicates, showAddNewProfilesConfirm, restoreInProgress]);
  const driveSnapshotRef = useRef(null);
  const supabaseSnapshotRef = useRef(null);
  // Пауза на авто-качването след „Не качвай“ в пазача за рязък спад (до следващо отваряне)
  const autoUploadPausedRef = useRef({ drive: false, supabase: false });
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
  const [dbWriteError, setDbWriteError] = useState(false);
  useEffect(() => {
    onDBWriteError(() => setDbWriteError(true));
  }, []);
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

  // Копията на профила в облака ([] ако няма) или null при грешка (съобщението вече е показано)
  const listCopiesBeforeUpload = (service, profileName, profileId) =>
    service === "drive"
      ? driveListBackups(profileName, { beforeUpload: true })
      : supabaseListBackups(profileName, profileId, { beforeUpload: true });

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

  const uploadToDrive = async (backup, profileName) => {
    const success = await driveUploadBackup(backup, profileName);
    if (success) {
      saveUploadCounts("drive", backup);
      clearDeletedAll("drive");
      autoUploadPausedRef.current.drive = false;
    }
    return success;
  };

  const uploadToSupabase = async (backup, profileName, profileId) => {
    const success = await supabaseUploadBackup(backup, profileName, profileId);
    if (success) {
      saveUploadCounts("supabase", backup);
      clearDeletedAll("supabase");
      autoUploadPausedRef.current.supabase = false;
      setLastSupabaseUploadDate(new Date().toISOString());
    }
    return success;
  };

  // Авто-качване през пазача. При рязък спад (или при първо качване, когато в облака има копие)
  // не качва, а пита веднъж; при „Не качвай“ авто-качването към услугата спира до следващо
  // отваряне или успешно ръчно качване.
  // Връща резултата от doUpload, или null, ако качването е пропуснато.
  const autoUploadWithGuard = async (service, backup, doUpload, profileName, profileId) => {
    if (isFirstUploadFromDevice(service)) {
      if (autoUploadPausedRef.current[service] || confirmDialogRef.current) return null;
      autoUploadPausedRef.current[service] = true; // без втора проверка, докато тази чака облака
      const copies = await listCopiesBeforeUpload(service, profileName, profileId);
      if (!copies?.length) {
        autoUploadPausedRef.current[service] = false;
        return copies ? doUpload() : null;
      }
      if (confirmDialogRef.current) { // друг прозорец се е отворил междувременно — пак при следваща промяна
        autoUploadPausedRef.current[service] = false;
        return null;
      }
      setConfirmDialog(existingCopyDialog({ service, copies, backup, profileName, profileId, doUpload, auto: true }));
      return null;
    }
    const deleted = findDeletedAll(service, backup);
    const drop = deleted ? null : findUploadDrop(service, backup);
    if (!deleted && !drop) return doUpload();
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
    if (!profilesLoaded || !transactionsLoaded || !categoriesLoaded || !filtersLoaded || !currencyLoaded) return;
    const snap = [transactions, expenseCategories, incomeCategories, savedFilters, profiles];
    const prev = driveSnapshotRef.current;
    const dataChanged = prev !== null && snap.some((v, i) => v !== prev[i]);
    driveSnapshotRef.current = snap;
    if (pendingBackup) return;
    if (!driveConnected) return;
    if (transactions.length === 0 && profiles.length <= 1) return;
    if (!activeProfile?.name) return;

    if (driveAutoSync === "onChange" && dataChanged) {
      const profileNameAtTrigger = activeProfile?.name;
      const profileIdAtTrigger = activeProfileId;
      const timer = setTimeout(async () => {
        if (!profileNameAtTrigger) return;
        const backup = await buildBackupData();
        const success = await autoUploadWithGuard("drive", backup, () => uploadToDrive(backup, profileNameAtTrigger), profileNameAtTrigger, profileIdAtTrigger);
        if (success === false) {
          driveSetMessage("⚠️ Автоматичното качване в Google Drive не успя. Сесията може да е изтекла — свържете се отново.");
        }
      }, 1500);
      return () => clearTimeout(timer);
    }

    if (driveAutoSync === "daily" && driveShouldRunDaily()) {
      const profileNameAtTrigger = activeProfile?.name;
      const profileIdAtTrigger = activeProfileId;
      const timer = setTimeout(async () => {
        if (!profileNameAtTrigger) return;
        const backup = await buildBackupData();
        const success = await autoUploadWithGuard("drive", backup, async () => {
          const ok = await uploadToDrive(backup, profileNameAtTrigger);
          if (ok) driveMarkDailyDone();
          return ok;
        }, profileNameAtTrigger, profileIdAtTrigger);
        if (success === false) {
          driveSetMessage("⚠️ Автоматичното качване в Google Drive не успя. Сесията може да е изтекла — свържете се отново.");
        }
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [transactions, expenseCategories, incomeCategories, savedFilters, profiles, driveAutoSync, driveConnected, pendingBackup]);
  
  useEffect(() => {
    if (!profilesLoaded || !transactionsLoaded || !categoriesLoaded || !filtersLoaded || !currencyLoaded) return;
    const snap = [transactions, expenseCategories, incomeCategories, savedFilters, profiles];
    const prev = supabaseSnapshotRef.current;
    const dataChanged = prev !== null && snap.some((v, i) => v !== prev[i]);
    supabaseSnapshotRef.current = snap;
    if (pendingBackup) return;
    if (!supabaseConnected || !supabaseEnabled) return;
    if (transactions.length === 0 && profiles.length <= 1) return;
    if (!activeProfile?.name) return;
    
    if (supabaseAutoSync === "onChange" && dataChanged) {
      const profileNameAtTrigger = activeProfile?.name;
      const profileIdAtTrigger = activeProfileId;
      const timer = setTimeout(async () => {
        if (!profileNameAtTrigger) return;
        const backup = await buildBackupData();
        await autoUploadWithGuard("supabase", backup, () => uploadToSupabase(backup, profileNameAtTrigger, profileIdAtTrigger), profileNameAtTrigger, profileIdAtTrigger);
      }, 1500);
      return () => clearTimeout(timer);
    }

    if (supabaseAutoSync === "daily" && supabaseShouldRunDaily()) {
      const profileNameAtTrigger = activeProfile?.name;
      const profileIdAtTrigger = activeProfileId;
      const timer = setTimeout(async () => {
        if (!profileNameAtTrigger) return;
        const backup = await buildBackupData();
        await autoUploadWithGuard("supabase", backup, async () => {
          const ok = await uploadToSupabase(backup, profileNameAtTrigger, profileIdAtTrigger);
          if (ok) supabaseMarkDailyDone();
          return ok;
        }, profileNameAtTrigger, profileIdAtTrigger);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [transactions, expenseCategories, incomeCategories, savedFilters, profiles, supabaseAutoSync, supabaseConnected, supabaseEnabled, pendingBackup]);

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

    if (shouldShow) {
      localStorage.setItem("last_backup_reminder_date", now.toISOString());
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

  const handleDeleteCategory = (type, name, choice) => {
    if (choice === "delete") {
      deleteTransactionsByCategory(name, type);
    } else {
      reassignTransactionsCategory(name, type);
      if (name !== "Без категория") addCategory(type, "Без категория");
    }
    deleteCategory(type, name);
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
    for (const item of toAdd) {
      addTransaction({
        type: item.type,
        category: item.category,
        amount: item.amount,
        date: item.date,
        description: item.description,
      });
    }
    // Маркираме последната дата за ВСЕКИ recurringId независимо дали е добавен или пропуснат
    const allIds = [...new Set(pendingRecurring.map((p) => p.recurringId))];
    for (const id of allIds) {
      const lastDate = pendingRecurring
        .filter((p) => p.recurringId === id)
        .at(-1)?.date;
      if (lastDate) await markAsAdded(id, lastDate);
    }
    setShowPendingModal(false);
    setPendingRecurring([]);
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
    setConflictProfiles([]);
    setConflictChoices({});
    setPendingBackup(null);
    setPendingNewProfiles([]);
    setAddNewProfiles(null);
    setNameOnlyMatchIds([]);
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
  const restoreBackupTxs = (backupData, profileId) => (backupData.transactions || [])
    .filter((t) => t.profileId === profileId)
    .map((t, i) => ({ ...t, profileId, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${i}` }));
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
    const used = [...(backupData.transactions || []), ...(backupData.recurringItems || [])]
      .filter((item) => item.profileId === bp.id);
    const usedOfType = (type) => used.filter((item) => item.type === type).map((item) => item.category);
    expense = uniqueCategories([...expense, ...usedOfType("expense")]);
    income = uniqueCategories([...income, ...usedOfType("income")]);
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
        ensureSaved(await restoreFilters(profileFilters, bp.id));
      }
      // Повтарящи се
      if (backupData.recurringItems) {
        const profileRecurring = backupData.recurringItems.filter((r) => r.profileId === bp.id);
        ensureSaved(await restoreRecurring(profileRecurring, bp.id));
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
  const handleMergeImport = (transactions, expenseCategories, incomeCategories) => {
    addTransactions(transactions);
    addCategoriesFromImport("expense", expenseCategories);
    addCategoriesFromImport("income", incomeCategories);
  };
  const buildBackupData = async () => {
    const db = await openDB();
    const allCats = await new Promise((resolve) => {
      const tx = db.transaction("categories", "readonly");
      const req = tx.objectStore("categories").getAll();
      req.onsuccess = () => {
        const fromDB = (req.result || []).filter((t) => t.type !== activeProfileId);
        resolve([...fromDB]);
      };
      req.onerror = () => resolve([]);
    });
    const allProfileCategories = {};
    allCats.forEach((entry) => {
      allProfileCategories[entry.type] = {
        expense: entry.categories?.expense || [],
        income: entry.categories?.income || [],
      };
    });
    // Категориите на активния профил се вземат от state за да са най-актуални
    allProfileCategories[activeProfileId] = { expense: expenseCategories, income: incomeCategories };
    const allTransactions = await new Promise((resolve) => {
      const tx = db.transaction("transactions", "readonly");
      const req = tx.objectStore("transactions").getAll();
      req.onsuccess = () => {
        const fromDB = (req.result || []).filter((t) => t.profileId !== activeProfileId);
        resolve([...fromDB, ...transactions]);
      };
      req.onerror = () => resolve(transactions);
    });

    const allSavedFilters = await new Promise((resolve) => {
      const tx = db.transaction("saved_filters", "readonly");
      const req = tx.objectStore("saved_filters").getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
      
    const allRecurringItems = await new Promise((resolve) => {
      const tx = db.transaction("recurring", "readonly");
      const req = tx.objectStore("recurring").getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });

    const allCurrencies = await new Promise((resolve) => {
      const tx = db.transaction("currency", "readonly");
      const req = tx.objectStore("currency").getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
    const allProfileCurrencies = {};
    allCurrencies.forEach((entry) => {
      allProfileCurrencies[entry.id] = { currency: entry.currency, rate: entry.rate };
    });
    allProfileCurrencies[activeProfileId] = { currency, rate };

    const allBudgetsRecords = await new Promise((resolve) => {
      const tx = db.transaction("budgets", "readonly");
      const req = tx.objectStore("budgets").getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
    const allProfileBudgets = {};
    allBudgetsRecords.forEach((entry) => {
      const { id, ...rest } = entry;
      allProfileBudgets[id] = rest;
    });
    allProfileBudgets[activeProfileId] = budgets;

    return {
      version: "1.6",
      date: new Date().toISOString(),
      profiles,
      activeProfileId,
      transactions: allTransactions,
      expenseCategories,
      incomeCategories,
      profileCategories: allProfileCategories,
      savedFilters: allSavedFilters,
      currency,
      rate,
      budgets,
      profileCurrencies: allProfileCurrencies,
      profileBudgets: allProfileBudgets,
      recurringItems: allRecurringItems,
    };
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
    const backup = await buildBackupData();
    const profileName = activeProfile?.name;
    await manualUploadWithGuard("drive", backup, () => uploadToDrive(backup, profileName), profileName, activeProfileId);
  };
  const handleSupabaseUpload = async () => {
    const backup = await buildBackupData();
    const profileName = activeProfile?.name;
    const profileId = activeProfileId;
    await manualUploadWithGuard("supabase", backup, () => uploadToSupabase(backup, profileName, profileId), profileName, profileId);
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
    const { data, remappedIds } = normalizeBackupProfileIds(validateAndMigrateBackup(rawData));
    // Профили, които съществуват и в приложението, и в резервното копие
    const conflicts = (data.profiles || []).filter((bp) =>
      profiles.some((lp) => lp.id === bp.id || lp.name.toLowerCase() === bp.name.toLowerCase())
    );
    const newProfiles = (data.profiles || []).filter((bp) =>
      !profiles.some((lp) => lp.id === bp.id || lp.name.toLowerCase() === bp.name.toLowerCase())
    );
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
    setPendingBackup(data);
    // Новите профили (само в резервното копие) — отделно
    pendingNewProfilesRef.current = newProfiles;
    setPendingNewProfiles(newProfiles);
    setLocalTransactionCounts(counts);
    if (conflicts.length > 0) {
      const initialChoices = {};
      conflicts.forEach((p) => { initialChoices[p.id] = "backup"; });
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
    const data = await buildBackupData();
    exportBackup(data.transactions, data.expenseCategories, data.incomeCategories, data.savedFilters, data.currency, data.rate, data.budgets, data.profiles, data.activeProfileId, data.recurringItems, activeProfile?.name, data.profileCategories, data.profileCurrencies, data.profileBudgets);
    const now = new Date().toISOString();
    localStorage.setItem("last_local_backup_date", now);
    setLastLocalBackupDate(now);
  };

  const normalizeBackupProfileIds = (data) => {
    const idMap = {};
    const remappedIds = [];
    const newProfiles = (data.profiles || []).map((bp) => {
      const lp = profiles.find((p) => p.id !== bp.id && p.name.toLowerCase() === bp.name.toLowerCase());
      if (lp) {
        idMap[bp.id] = lp.id;
        remappedIds.push(lp.id);
        return { ...bp, id: lp.id };
      }
      return bp;
    });
    if (Object.keys(idMap).length === 0) return { data, remappedIds: [] };
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
      const profileFilters = backupData.savedFilters.filter((f) => f.profileId === bp.id);
      if (choice === "merge") {
        const existingFilters = await getProfileRecords("saved_filters", bp.id);
        const newFilters = profileFilters.filter((bf) =>
          !existingFilters.some((ef) => ef.name === bf.name && ef.fromDate === bf.fromDate && ef.toDate === bf.toDate)
        );
        const merged = [...existingFilters, ...newFilters];
        ensureSaved(await restoreFilters(merged, bp.id));
        if (bp.id === activeProfileId) setSavedFilters(merged.map((f) => ({ ...f, profileId: bp.id })));
      } else {
        ensureSaved(await restoreFilters(profileFilters, bp.id));
        if (bp.id === activeProfileId) setSavedFilters(profileFilters.map((f) => ({ ...f, profileId: bp.id })));
      }
    }
    if (backupData.recurringItems) {
      const profileRecurring = backupData.recurringItems.filter((r) => r.profileId === bp.id);
      if (choice === "merge") {
        const existingRecurring = await getProfileRecords("recurring", bp.id);
        const newItems = profileRecurring.filter((br) =>
          !existingRecurring.some((er) => er.description === br.description && er.category === br.category && er.period === br.period)
        );
        ensureSaved(await restoreRecurring([...existingRecurring, ...newItems], bp.id));
      } else {
        ensureSaved(await restoreRecurring(profileRecurring, bp.id));
      }
    }
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
      await finishRestoreForProfile(bp, choice, backupData);
      ensureSaved(await addOrUpdateProfile(bp));
      completedRestoreProfilesRef.current.push({ id: bp.id, name: bp.name, choice });
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
      {driveMessage && driveMessage !== "allow" && driveMessage !== "blocked" && (
        <>
          {driveMessage.startsWith("✅") ? (
            <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] rounded-xl shadow-lg px-4 py-3 max-w-sm w-full mx-4 border-2 bg-emerald-50 border-emerald-300">
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
            <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] rounded-xl shadow-lg px-4 py-3 max-w-sm w-full mx-4 border-2 bg-emerald-50 border-emerald-300">
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
      {multiTabWarning && (
        <div className="fixed top-0 left-0 right-0 z-[119] bg-orange-500 text-white px-4 py-2.5 flex items-center justify-between gap-3 shadow-lg">
          <p className="text-sm font-medium">⚠️ Приложението е отворено и в друг раздел или прозорец. Работата на две места едновременно може да доведе до загуба на данни — затворете другото копие и презаредете тази страница.</p>
          <button onClick={() => setMultiTabWarning(false)} className="text-white/80 hover:text-white text-lg leading-none flex-shrink-0">×</button>
        </div>
      )}
      {dbWriteError && (
        <div className="fixed top-0 left-0 right-0 z-[120] bg-red-500 text-white px-4 py-2.5 flex items-center justify-between gap-3 shadow-lg">
          <p className="text-sm font-medium">⚠️ Проблем при запазване на данните! Свалете резервно копие (Данни → Свали резервно копие) и презаредете страницата.</p>
          <button onClick={() => setDbWriteError(false)} className="text-white/80 hover:text-white text-lg leading-none flex-shrink-0">×</button>
        </div>
      )}
      {showUpdateAvailable && (
        <div className="fixed top-0 left-0 right-0 z-[121] bg-blue-600 text-white px-4 py-2.5 flex items-center justify-between gap-3 shadow-lg">
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
                      <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-2">
                        <p className="text-xs text-amber-700 font-semibold mb-0.5">⏱️ Забележка за връзката с Google</p>
                        <p className="text-xs text-amber-600">
                          Връзката с Google може да се прекъсне в два случая: (1) ако не сте качвали нищо повече от <strong>1 час</strong> — следващото качване може да се провали; (2) ако не сте отваряли приложението повече от <strong>седмица</strong> — ще трябва да се свържете отново. При проблем натиснете "Изключи Google Drive" и се свържете отново. За постоянна връзка без прекъсвания използвайте качване на резервно копие в Облака.
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
                          message: "Синхронизацията с Google Drive ще бъде спряна и автоматичното качване ще се изключи. Файловете в Google Drive остават непокътнати."
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
                          message: "Ще излезете напълно от акаунта в Облака и синхронизацията ще спре. Резервните копия в Облака остават запазени и достъпни при следващо вписване."
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
          onEdit={editCategory}
          onDelete={handleDeleteCategory}
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
          <div className="bg-blue-50 rounded-2xl shadow-xl w-full max-w-sm">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-700">Нови профили в резервното копие</h2>
            </div>
            <div className="px-5 py-4 space-y-3">
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
          <div className="bg-blue-50 rounded-2xl shadow-xl w-full max-w-sm">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-700">Съвпадащи профили</h2>
            </div>
            <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
              <p className="text-sm text-gray-600">
                Следните профили съществуват и в приложението, и в резервното копие. Изберете какво да се направи за всеки:
              </p>
              {conflictProfiles.map((p) => (
                <div key={p.id} className="bg-white rounded-xl p-3 border border-gray-200">
                  <p className="text-sm font-semibold text-gray-700 mb-2">👤 {p.name}</p>
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
            <div className="px-5 py-4 border-t border-gray-100 flex flex-col gap-2">
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
                    {conflictProfiles.length === 0 && (
                      <div className="bg-orange-50 rounded-xl p-4">
                        <p className="text-sm text-orange-700 font-medium mb-1">⚠️ Внимание!</p>
                        <p className="text-sm text-orange-600">
                          Данните от резервното копие ще бъдат заредени. Съществуващите данни може да бъдат засегнати.
                        </p>
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
                      onClick={() => { setShowRestoreConfirm(false); runRestoreStep(handleRestoreConfirm); }}
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
                    : "Google Drive и Облакът споделят една и съща връзка. Влизането в Облака ще изключи текущата връзка с Google Drive."}
                </p>
              </div>
              <button
                onClick={() => {
                  const action = showCrossServiceWarning;
                  setShowCrossServiceWarning(null);
                  markExpectedServiceSwitch();
                  if (action === "toDrive") {
                    setShowDataPanel(true);
                    driveConnect();
                  } else {
                    supabaseConnectWithEmail();
                  }
                }}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 transition"
              >
                Продължи и изключи другата връзка
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
                <p className={`text-sm font-medium mb-1 ${confirmDialog.tone === "danger" ? "text-red-700" : "text-orange-700"}`}>⚠️ Потвърждение</p>
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
                onClick={() => setConfirmDialog(null)}
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

      {showWeeklyBackup && (
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
                  const data = await buildBackupData();
                  exportBackup(data.transactions, data.expenseCategories, data.incomeCategories, data.savedFilters, data.currency, data.rate, data.budgets, data.profiles, data.activeProfileId, data.recurringItems, activeProfile?.name, data.profileCategories, data.profileCurrencies, data.profileBudgets);
                  const now = new Date().toISOString();
                  localStorage.setItem("last_local_backup_date", now);
                  setLastLocalBackupDate(now);
                  setShowWeeklyBackup(false);
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
          onClose={() => {
            // При затваряне без потвърждение — маркираме всички като видяни
            handleConfirmPending([]);
          }}
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
                    </div>
                  ))}
                </div>
              </div>
              <button
                onClick={() => setShowRestoreDone(false)}
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
          onAdd={addTransactions}
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