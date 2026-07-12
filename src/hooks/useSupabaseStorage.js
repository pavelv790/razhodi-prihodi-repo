import { useState, useCallback, useEffect } from "react";
import {
  uploadBackupToSupabase,
  downloadBackupFromSupabase,
} from "../utils/supabaseStorage";
import {
  signUpWithEmail,
  signInWithEmail,
  signOutFromSupabase,
  getCurrentSession,
  resetPassword,
} from "../utils/supabaseAuth";
import { supabase } from "../utils/supabase";

const STORAGE_KEY = "supabase_storage_settings";

export function useSupabaseStorage() {
  const [connected, setConnected] = useState(false);
  const [enabled, setEnabled] = useState(
    () => localStorage.getItem("supabase_storage_enabled") === "true"
  );
  const [autoSync, setAutoSync] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return "off";
    const parsed = JSON.parse(saved);
    return parsed.autoSync || "off";
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
    const check = async () => {
      try {
        const session = await getCurrentSession();
        if (session?.user) {
          setConnected(true);
        }
      } catch (err) {
        // няма интернет или Supabase не е достъпен
      }
    };
    check();

    let subscription;
    try {
      const { data } = supabase.auth.onAuthStateChange((event, session) => {
        setConnected(!!session?.user);
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
    if (msg.includes("Email not confirmed")) return "Имейлът не е потвърден.";
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
        await signUpWithEmail(authEmail, authPassword);
        setConnected(true);
        setEnabled(true);
        localStorage.setItem("supabase_storage_enabled", "true");
        setAuthError("✅ Регистрацията е успешна!");
      } else {
        await signInWithEmail(authEmail, authPassword);
        setConnected(true);
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
    await signOutFromSupabase();
    setConnected(false);
    setEnabled(false);
    setAutoSync("off");
    saveSettings("off");
    localStorage.setItem("supabase_storage_enabled", "false");
  };

  const shouldRunDaily = () => {
    const today = new Date().toISOString().slice(0, 10);
    return localStorage.getItem("supabase_daily_backup_last") !== today;
  };

  const markDailyDone = () => {
    const today = new Date().toISOString().slice(0, 10);
    localStorage.setItem("supabase_daily_backup_last", today);
  };

  const toggleAutoSync = (val) => {
    setAutoSync(val);
    saveSettings(val);
  };

  const uploadBackup = useCallback(async (backupData, profileName) => {
    if (!connected) {
      showMessage("❌ Не сте вписани в облака.");
      return false;
    }
    setUploadLoading(true);
    setMessage("");
    try {
      await uploadBackupToSupabase(backupData, profileName);
      localStorage.setItem("last_supabase_upload_date", new Date().toISOString());
      showMessage("✅ Качено резервно копие в облака.");
      return true;
    } catch (err) {
      showMessage("❌ " + err.message);
      return false;
    } finally {
      setUploadLoading(false);
    }
  }, [connected]);

  const downloadBackup = useCallback(async (profileName) => {
    if (!connected) {
      showMessage("❌ Не сте вписани в облака.");
      return null;
    }
    setDownloadLoading(true);
    setMessage("");
    try {
      const data = await downloadBackupFromSupabase(profileName);
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