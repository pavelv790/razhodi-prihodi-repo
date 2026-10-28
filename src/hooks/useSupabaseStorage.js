import { useState, useCallback, useEffect, useRef } from "react";
import {
  uploadBackupToSupabase,
  listBackupsFromSupabase,
  downloadBackupFileFromSupabase,
} from "../utils/supabaseStorage";
import {
  signUpWithEmail,
  signInWithEmail,
  signOutFromSupabase,
  getCurrentSession,
  resetPassword,
} from "../utils/supabaseAuth";
import { supabase } from "../utils/supabase";
import { takeCloudLinkError } from "../utils/googleDrive";
import { isGoogleSession } from "../utils/authSession";
import { getLocalDateKey } from "../utils/formatters";
import { isExpectedServiceSwitch, markExpectedServiceSwitch } from "../utils/crossServiceSwitch";

const STORAGE_KEY = "supabase_storage_settings";

export function useSupabaseStorage() {
  const [connected, setConnected] = useState(false);
  const connectedRef = useRef(false);
  const selfDisconnectUntilRef = useRef(0);
  const setConnectedBoth = (val) => { connectedRef.current = val; setConnected(val); };
  const [enabled, setEnabled] = useState(
    () => localStorage.getItem("supabase_storage_enabled") === "true"
  );
  const [autoSync, setAutoSync] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return "off";
    try {
      const parsed = JSON.parse(saved);
      return parsed.autoSync || "off";
    } catch {
      return "off"; // повреден запис в localStorage
    }
  });
  const [uploadLoading, setUploadLoading] = useState(false);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [message, setMessage] = useState("");

  const showMessage = (msg) => {
    setMessage(msg);
    if (msg.startsWith("✅")) {
      setTimeout(() => setMessage(""), 3000);
    }
  };

  // Проверява дали потребителят е вписан (Supabase сесията вече я управлява useGoogleDrive)
  useEffect(() => {
    // Развален или изтекъл линк за смяна на парола връща с `error=…` в адреса — auth-js нищо не
    // съобщава (3-14б). Грешка на Google вход взима useGoogleDrive (виж takeCloudLinkError).
    const linkError = takeCloudLinkError();
    if (linkError) showMessage(linkError);

    const check = async () => {
      try {
        const session = await getCurrentSession();
        if (session?.user && !isGoogleSession(session)) {
          setConnectedBoth(true);
        }
      } catch (err) {
        // няма интернет или Supabase не е достъпен
      }
    };
    check();

    let subscription;
    try {
      const { data } = supabase.auth.onAuthStateChange((event, session) => {
        // Сесия от вход през Google (Drive), не през имейл/парола (Облак) — не я броим като
        // връзка с Облака, дори да е валидна. Разпознава се по начина на вход, не по
        // provider_token: той изчезва при опресняване на сесията (одит 2026-10, 3-02).
        const isConnected = !!session?.user && !isGoogleSession(session);
        if (!isConnected) {
          const wasConnected = connectedRef.current;
          setConnectedBoth(false);
          const isSelfDisconnect = Date.now() < selfDisconnectUntilRef.current;
          if (wasConnected && !isSelfDisconnect && !isExpectedServiceSwitch()) {
            showMessage("🔌 Връзката с Облака беше прекъсната. Свържете се отново, ако желаете.");
          }
        } else {
          setConnectedBoth(true);
        }
        if (event === "PASSWORD_RECOVERY") {
          setShowNewPassword(true);
        }
      });
      subscription = data.subscription;
    } catch (err) {
      // няма интернет или Supabase не е достъпен
    }

    return () => subscription?.unsubscribe();
  }, []);
  const [authMode, setAuthMode] = useState("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordLoading, setNewPasswordLoading] = useState(false);

  const translateSupabaseError = (msg) => {
    if (!msg) return "Непозната грешка.";
    if (msg.includes("New password should be different")) return "Новата парола трябва да се различава от старата.";
    if (msg.includes("Password should be at least")) return "Паролата трябва да е поне 6 символа.";
    if (msg.includes("Invalid login credentials")) return "Грешен имейл или парола.";
    if (msg.includes("missing email or phone")) return "Моля въведете имейл адрес.";
    if (msg.includes("password recovery requires an email")) return "Възстановяването на парола изисква имейл адрес.";
    if (msg.includes("signup requires an email")) return "Регистрацията изисква имейл адрес.";
    if (msg.includes("invalid email")) return "Невалиден имейл адрес.";
    if (msg.includes("should be different from the old password")) return "Новата парола трябва да се различава от старата.";
    if (msg.includes("Email not confirmed")) return "Имейлът не е потвърден. Отворете връзката в имейла, изпратен при регистрацията, и опитайте отново.";
    if (msg.includes("User already registered")) return "Вече съществува акаунт с този имейл.";
    if (msg.includes("Unable to validate email address")) return "Невалиден имейл адрес.";
    if (msg.includes("Email rate limit exceeded")) return "Твърде много опити. Опитайте по-късно.";
    if (msg.includes("Token has expired")) return "Линкът е изтекъл. Поискайте нов.";
    return msg;
  };

  const updatePassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      setMessage("❌ Паролата трябва да е поне 6 символа.");
      return;
    }
    setNewPasswordLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw new Error(error.message);
      setShowNewPassword(false);
      setNewPassword("");
      showMessage("✅ Паролата е сменена успешно!");
    } catch (err) {
      setMessage("❌ " + translateSupabaseError(err.message));
    } finally {
      setNewPasswordLoading(false);
    }
  };
  const sendResetEmail = async () => {
    if (!resetEmail || !resetEmail.includes("@")) {
      setAuthError("❌ Моля въведете имейл адрес.");
      return;
    }
    setResetLoading(true);
    setAuthError("");
    try {
      await resetPassword(resetEmail);
      setAuthError("✅ Изпратен е имейл с линк за нова парола. Проверете пощата си.");
      setShowReset(false);
    } catch (err) {
      setAuthError("❌ " + translateSupabaseError(err.message));
      return;
    } finally {
      setResetLoading(false);
    }
  };

  const connectWithEmail = async () => {
    if (!authEmail || !authEmail.includes("@")) {
      setAuthError("❌ Моля въведете имейл адрес.");
      return;
    }
    if (!authPassword || authPassword.length < 6) {
      setAuthError("❌ Паролата трябва да е поне 6 символа.");
      return;
    }
    setAuthLoading(true);
    setAuthError("");
    try {
      if (authMode === "register") {
        const data = await signUpWithEmail(authEmail, authPassword);
        // При включено потвърждение по имейл Supabase връща потребител без сесия — не сме
        // вписани, докато имейлът не се потвърди (одит 2026-10, 3-12). Същото връща и при вече
        // регистриран имейл (нарочно, без грешка) — затова съобщението споменава и „Вход“.
        if (!data?.session) {
          setAuthMode("login");
          setAuthPassword("");
          setAuthError(`✅ Изпратихме имейл за потвърждение на ${authEmail}. Отворете връзката в него, после се върнете тук и натиснете „Влез в облака“. Ако вече имате акаунт с този имейл — направо влезте.`);
          return;
        }
        setConnectedBoth(true);
        setEnabled(true);
        localStorage.setItem("supabase_storage_enabled", "true");
        setAuthError("✅ Регистрацията е успешна!");
      } else {
        await signInWithEmail(authEmail, authPassword);
        setConnectedBoth(true);
        setEnabled(true);
        localStorage.setItem("supabase_storage_enabled", "true");
      }
    } catch (err) {
      setAuthError("❌ " + translateSupabaseError(err.message));
    } finally {
      setAuthLoading(false);
    }
  };

  const saveSettings = (newAutoSync) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ autoSync: newAutoSync }));
  };

  const disconnectSupabase = async () => {
    selfDisconnectUntilRef.current = Date.now() + 5000;
    markExpectedServiceSwitch();
    try {
      await signOutFromSupabase();
    } catch (err) {
      // изходът не е направен (напр. няма връзка) — вписването и настройките остават (3-11)
      showMessage(`❌ Изходът от Облака не е направен — ${err.message} Опитайте отново; дотогава сте вписани и настройките са непроменени.`);
      return;
    }
    setConnectedBoth(false);
    setEnabled(false);
    setAutoSync("off");
    saveSettings("off");
    localStorage.setItem("supabase_storage_enabled", "false");
    showMessage("🔌 Излязохте от Облака.");
  };

  const shouldRunDaily = () => {
    const today = getLocalDateKey();
    return localStorage.getItem("supabase_daily_backup_last") !== today;
  };

  const markDailyDone = () => {
    const today = getLocalDateKey();
    localStorage.setItem("supabase_daily_backup_last", today);
  };

  const toggleAutoSync = (val) => {
    setAutoSync(val);
    saveSettings(val);
  };

  // auto — авто-качване: без мрежа нищо не се показва, промяната остава некачена и се пробва
  // пак (одит 2026-10, 3-10)
  const uploadBackup = useCallback(async (backupData, profileName, profileId, { auto = false } = {}) => {
    if (!connected) {
      showMessage("❌ Не сте вписани в облака.");
      return false;
    }
    setUploadLoading(true);
    setMessage("");
    try {
      await uploadBackupToSupabase(backupData, profileName, profileId);
      localStorage.setItem("last_supabase_upload_date", new Date().toISOString());
      showMessage("✅ Качено резервно копие в облака.");
      return true;
    } catch (err) {
      if (!(auto && err.network)) showMessage("❌ " + err.message);
      return false;
    } finally {
      setUploadLoading(false);
    }
  }, [connected]);

  // Връща списъка с копия (виж listBackupsFromSupabase) или null при грешка.
  // При 0 копия — съобщение и null; с beforeUpload (проверка преди първо качване) — [] без
  // съобщение и без „Изтегляне...“ на бутона за възстановяване.
  const listBackups = useCallback(async (profileName, profileId, { beforeUpload = false, auto = false } = {}) => {
    if (!connected) {
      showMessage("❌ Не сте вписани в облака.");
      return null;
    }
    if (!beforeUpload) setDownloadLoading(true);
    setMessage("");
    try {
      const copies = await listBackupsFromSupabase(profileName, profileId);
      if (!copies.length && !beforeUpload) {
        showMessage("❌ Няма намерено резервно копие в облака.");
        return null;
      }
      return copies;
    } catch (err) {
      if (!(auto && err.network)) showMessage("❌ " + err.message);
      return null;
    } finally {
      if (!beforeUpload) setDownloadLoading(false);
    }
  }, [connected]);

  const downloadBackup = useCallback(async (fileName) => {
    if (!connected) {
      showMessage("❌ Не сте вписани в облака.");
      return null;
    }
    setDownloadLoading(true);
    setMessage("");
    try {
      const data = await downloadBackupFileFromSupabase(fileName);
      showMessage("✅ Резервно копие изтеглено успешно.");
      return data;
    } catch (err) {
      showMessage("❌ " + err.message);
      return null;
    } finally {
      setDownloadLoading(false);
    }
  }, [connected]);

  const enable = () => {
    localStorage.setItem("supabase_storage_enabled", "true");
    setEnabled(true);
  };
  const disable = () => {
    localStorage.setItem("supabase_storage_enabled", "false");
    setEnabled(false);
    setAutoSync("off");
    saveSettings("off");
  };

  return {
    connected,
    enabled,
    enable,
    disable,
    authMode,
    setAuthMode,
    authEmail,
    setAuthEmail,
    authPassword,
    setAuthPassword,
    authLoading,
    authError,
    setAuthError,
    connectWithEmail,
    disconnectSupabase,
    autoSync,
    uploadLoading,
    downloadLoading,
    message,
    setMessage,
    toggleAutoSync,
    uploadBackup,
    listBackups,
    downloadBackup,
    shouldRunDaily,
    markDailyDone,
    resetLoading,
    showReset,
    setShowReset,
    resetEmail,
    setResetEmail,
    sendResetEmail,
    showNewPassword,
    setShowNewPassword,
    newPassword,
    setNewPassword,
    newPasswordLoading,
    updatePassword,
  };
}