import { useState, useCallback, useEffect } from "react";
import {
  signInWithGoogle,
  signOutFromGoogle,
  isSignedIn,
  uploadBackupToDrive,
  downloadLatestBackupFromDrive,
  restoreSessionFromSupabase,
  setAccessToken,
} from "../utils/googleDrive";
import { supabase } from "../utils/supabase";

const STORAGE_KEY = "google_drive_settings";

export function useGoogleDrive() {
  const [connected, setConnected] = useState(false);
  const [autoSync, setAutoSync] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return "off";
    const parsed = JSON.parse(saved);
    // обратна съвместимост със стара boolean стойност
    if (parsed.autoSync === true) return "onChange";
    if (parsed.autoSync === false) return "off";
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

  useEffect(() => {
    const restore = async () => {
      const restored = await restoreSessionFromSupabase();
      if (restored) setConnected(true);
    };
    restore();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.provider_token) {
        setAccessToken(session.provider_token);
        setConnected(true);
      } else {
        setConnected(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const saveSettings = (newAutoSync) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ autoSync: newAutoSync }));
  };

  const shouldRunDaily = () => {
    const key = `drive_daily_backup_${new Date().toISOString().slice(0, 10)}`;
    return !localStorage.getItem(key);
  };

  const markDailyDone = () => {
    const key = `drive_daily_backup_${new Date().toISOString().slice(0, 10)}`;
    localStorage.setItem(key, "true");
  };

  const connect = async () => {
    setMessage("");
    try {
      await signInWithGoogle();
    } catch (err) {
      showMessage("blocked");
    }
  };

  const disconnect = () => {
    signOutFromGoogle();
    setConnected(false);
    setAutoSync("off");
    saveSettings("off");
    showMessage("🔌 Не сте свързани с Google Drive.");
  };

  const toggleAutoSync = (val) => {
    setAutoSync(val);
    saveSettings(val);
  };

  const uploadBackup = useCallback(async (backupData, profileName) => {
    if (!isSignedIn()) {
      showMessage("❌ Сесията е изтекла. Свържете се отново с Google Drive.");
      return false;
    }
    setUploadLoading(true);
    setMessage("");
    try {
      await uploadBackupToDrive(backupData, profileName);
      showMessage("✅ Backup качен в Google Drive.");
      return true;
    } catch (err) {
      showMessage("❌ " + err.message);
      return false;
    } finally {
      setUploadLoading(false);
    }
  }, []);

  const downloadBackup = useCallback(async (profileName) => {
    if (!isSignedIn()) {
      showMessage("❌ Първо се свържете с Google Drive.");
      return null;
    }
    setDownloadLoading(true);
    setMessage("");
    try {
      const data = await downloadLatestBackupFromDrive(profileName);
      showMessage("✅ Backup изтеглен успешно.");
      return data;
    } catch (err) {
      showMessage("❌ " + err.message);
      return null;
    } finally {
      setDownloadLoading(false);
    }
  }, []);

  return {
    connected,
    autoSync,
    uploadLoading,
    downloadLoading,
    message,
    setMessage,
    connect,
    disconnect,
    toggleAutoSync,
    uploadBackup,
    downloadBackup,
    shouldRunDaily,
    markDailyDone,
  };
}