import { useState, useCallback, useEffect } from "react";
import {
  uploadBackupToSupabase,
  downloadBackupFromSupabase,
  isSupabaseStorageAvailable,
} from "../utils/supabaseStorage";
import { supabase } from "../utils/supabase";

const STORAGE_KEY = "supabase_storage_settings";

export function useSupabaseStorage() {
  const [connected, setConnected] = useState(false);
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
      const available = await isSupabaseStorageAvailable();
      setConnected(available);
    };
    check();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setConnected(!!session?.user);
    });

    return () => subscription.unsubscribe();
  }, []);

  const saveSettings = (newAutoSync) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ autoSync: newAutoSync }));
  };

  const shouldRunDaily = () => {
    const key = `supabase_daily_backup_${new Date().toISOString().slice(0, 10)}`;
    return !localStorage.getItem(key);
  };

  const markDailyDone = () => {
    const key = `supabase_daily_backup_${new Date().toISOString().slice(0, 10)}`;
    localStorage.setItem(key, "true");
  };

  const toggleAutoSync = (val) => {
    setAutoSync(val);
    saveSettings(val);
  };

  const uploadBackup = useCallback(async (backupData, profileName) => {
    const available = await isSupabaseStorageAvailable();
    if (!available) {
      showMessage("❌ Не сте вписани. Свържете се с Google акаунт.");
      return false;
    }
    setUploadLoading(true);
    setMessage("");
    try {
      await uploadBackupToSupabase(backupData, profileName);
      localStorage.setItem("last_supabase_upload_date", new Date().toISOString());
      showMessage("✅ Backup качен в облака.");
      return true;
    } catch (err) {
      showMessage("❌ " + err.message);
      return false;
    } finally {
      setUploadLoading(false);
    }
  }, []);

  const downloadBackup = useCallback(async (profileName) => {
    const available = await isSupabaseStorageAvailable();
    if (!available) {
      showMessage("❌ Не сте вписани. Свържете се с Google акаунт.");
      return null;
    }
    setDownloadLoading(true);
    setMessage("");
    try {
      const data = await downloadBackupFromSupabase(profileName);
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
    toggleAutoSync,
    uploadBackup,
    downloadBackup,
    shouldRunDaily,
    markDailyDone,
  };
}