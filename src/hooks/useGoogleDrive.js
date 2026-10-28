import { useState, useCallback, useEffect, useRef } from "react";
import {
  signInWithGoogle,
  signOutFromGoogle,
  isSignedIn,
  uploadBackupToDrive,
  listBackupsFromDrive,
  downloadBackupFileFromDrive,
  restoreSessionFromSupabase,
  setAccessToken,
  clearAccessToken,
  takeGoogleSignInError,
  clearGoogleSignInPending,
} from "../utils/googleDrive";
import { supabase } from "../utils/supabase";
import { isGoogleSession } from "../utils/authSession";
import { getLocalDateKey } from "../utils/formatters";
import { isExpectedServiceSwitch, markExpectedServiceSwitch } from "../utils/crossServiceSwitch";

const STORAGE_KEY = "google_drive_settings";

export function useGoogleDrive() {
  // connected — Supabase сесията е от вход през Google (Drive е избран и остава избран);
  // needsReconnect — ключът за достъп до Drive е изтекъл (≈1 ч след входа): качването и
  // възстановяването чакат „Свържи отново“, изборът за автоматично качване се пази (3-02)
  const [connected, setConnected] = useState(false);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const connectedRef = useRef(false);
  const selfDisconnectUntilRef = useRef(0);
  const reconnectPromptedRef = useRef(false);
  const setConnectedBoth = (val) => { connectedRef.current = val; setConnected(val); };
  const [autoSync, setAutoSync] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return "off";
    try {
      const parsed = JSON.parse(saved);
      // обратна съвместимост със стара boolean стойност
      if (parsed.autoSync === true) return "onChange";
      if (parsed.autoSync === false) return "off";
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

  useEffect(() => {
    // Връщане от Google с отказ (`error=access_denied…` в адреса): signInWithOAuth само
    // пренасочва и никога не хвърля, затова отказът се чете от адреса (3-14). Прозорецът
    // „Още една стъпка“ не трябва да излиза при следващо свързване.
    if (takeGoogleSignInError()) {
      sessionStorage.removeItem("pending_auto_upload_notice_drive");
      setMessage("blocked");
    }

    const restore = async () => {
      try {
        const restored = await restoreSessionFromSupabase();
        if (restored) {
          setConnectedBoth(true);
          setNeedsReconnect(!isSignedIn());
        }
      } catch (err) {
        // няма интернет или Supabase не е достъпен
      }
    };
    restore();

    let subscription;
    try {
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        if (_event === "PASSWORD_RECOVERY") return;
        if (isGoogleSession(session)) {
          clearGoogleSignInPending();
          // при опресняване на сесията provider_token липсва — Drive остава свързан
          if (session.provider_token) setAccessToken(session.provider_token);
          setConnectedBoth(true);
          setNeedsReconnect(!isSignedIn());
        } else {
          const wasConnected = connectedRef.current;
          clearAccessToken();
          setConnectedBoth(false);
          setNeedsReconnect(false);
          const isSelfDisconnect = Date.now() < selfDisconnectUntilRef.current;
          if (wasConnected && !isSelfDisconnect && !isExpectedServiceSwitch()) {
            showMessage("🔌 Връзката с Google Drive беше прекъсната. Свържете се отново, ако желаете.");
          }
        }
      });
      subscription = data.subscription;
    } catch (err) {
      // няма интернет или Supabase не е достъпен
    }

    return () => subscription?.unsubscribe();
  }, []);

  const saveSettings = (newAutoSync) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ autoSync: newAutoSync }));
  };

  const shouldRunDaily = () => {
    const today = getLocalDateKey();
    return localStorage.getItem("drive_daily_backup_last") !== today;
  };

  const markDailyDone = () => {
    const today = getLocalDateKey();
    localStorage.setItem("drive_daily_backup_last", today);
  };

  const connect = async () => {
    setMessage("");
    try {
      await signInWithGoogle();
    } catch (err) {
      showMessage("blocked");
    }
  };

  const disconnect = async () => {
    selfDisconnectUntilRef.current = Date.now() + 5000;
    markExpectedServiceSwitch();
    try {
      await signOutFromGoogle();
    } catch (err) {
      // изходът не е направен (напр. няма връзка) — връзката и настройките остават (3-11)
      showMessage(`❌ Google Drive не е изключен — ${err.message} Опитайте отново; дотогава връзката и настройките са непроменени.`);
      return;
    }
    setConnectedBoth(false);
    setNeedsReconnect(false);
    setAutoSync("off");
    saveSettings("off");
    showMessage("🔌 Не сте свързани с Google Drive.");
  };

  const toggleAutoSync = (val) => {
    setAutoSync(val);
    saveSettings(val);
  };

  // Ключът за Drive е изтекъл: прозорец „Свържи отново“ (message === "reconnect").
  // При автоматично качване (auto) — само веднъж на отваряне на приложението, после тихо.
  const promptReconnect = useCallback((auto = false) => {
    setNeedsReconnect(true);
    if (auto && reconnectPromptedRef.current) return;
    reconnectPromptedRef.current = true;
    setMessage("reconnect");
  }, []);

  // Преди заявка към Drive: има ли валиден ключ (ако не — „Свържи отново“ или „Първо се свържете“)
  const requireToken = useCallback(() => {
    if (isSignedIn()) return true;
    if (connectedRef.current) promptReconnect();
    else showMessage("❌ Първо се свържете с Google Drive.");
    return false;
  }, [promptReconnect]);

  // Грешка от Drive: при отхвърлен ключ (401 → ключът е изчистен) — „Свържи отново“
  const showDriveError = useCallback((err) => {
    if (!isSignedIn() && connectedRef.current) promptReconnect();
    else showMessage("❌ " + err.message);
  }, [promptReconnect]);

  // auto — авто-качване: без мрежа нищо не се показва, промяната остава некачена и се пробва
  // пак (одит 2026-10, 3-10)
  const uploadBackup = useCallback(async (backupData, profileName, { auto = false } = {}) => {
    if (!requireToken()) return false;
    setUploadLoading(true);
    setMessage("");
    try {
      await uploadBackupToDrive(backupData, profileName);
      localStorage.setItem("last_drive_upload_date", new Date().toISOString());
      showMessage("✅ Качено резервно копие в Google Drive.");
      return true;
    } catch (err) {
      if (!(auto && err.network)) showDriveError(err);
      return false;
    } finally {
      setUploadLoading(false);
    }
  }, [requireToken, showDriveError]);

  // Връща списъка с копия (виж listBackupsFromDrive) или null при грешка.
  // При 0 копия — съобщение и null; с beforeUpload (проверка преди първо качване) — [] без
  // съобщение и без „Изтегляне...“ на бутона за възстановяване.
  const listBackups = useCallback(async (profileName, { beforeUpload = false, auto = false } = {}) => {
    if (!requireToken()) return null;
    if (!beforeUpload) setDownloadLoading(true);
    setMessage("");
    try {
      const copies = await listBackupsFromDrive(profileName);
      if (!copies.length && !beforeUpload) {
        showMessage("❌ Няма намерено резервно копие в Google Drive.");
        return null;
      }
      return copies;
    } catch (err) {
      if (!(auto && err.network)) showDriveError(err);
      return null;
    } finally {
      if (!beforeUpload) setDownloadLoading(false);
    }
  }, [requireToken, showDriveError]);

  const downloadBackup = useCallback(async (fileId) => {
    if (!requireToken()) return null;
    setDownloadLoading(true);
    setMessage("");
    try {
      const data = await downloadBackupFileFromDrive(fileId);
      showMessage("✅ Резервно копие изтеглено успешно.");
      return data;
    } catch (err) {
      showDriveError(err);
      return null;
    } finally {
      setDownloadLoading(false);
    }
  }, [requireToken, showDriveError]);

  return {
    connected,
    needsReconnect,
    hasToken: isSignedIn,
    promptReconnect,
    autoSync,
    uploadLoading,
    downloadLoading,
    message,
    setMessage,
    connect,
    disconnect,
    toggleAutoSync,
    uploadBackup,
    listBackups,
    downloadBackup,
    shouldRunDaily,
    markDailyDone,
  };
}