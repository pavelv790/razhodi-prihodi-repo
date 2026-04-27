import { useState, useEffect, useCallback } from "react";
import {
  signInWithGoogle,
  signOutFromGoogle,
  isSignedIn,
  uploadBackupToDrive,
  downloadLatestBackupFromDrive,
} from "../utils/googleDrive";

const STORAGE_KEY = "google_drive_settings";

export function useGoogleDrive() {
  const [connected, setConnected] = useState(false);
  const [autoSync, setAutoSync] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      setAutoSync(parsed.autoSync || false);
    }
  }, []);

  const saveSettings = (newAutoSync) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ autoSync: newAutoSync }));
  };

  const connect = async () => {
    setLoading(true);
    setMessage("");
    try {
      await signInWithGoogle();
      setConnected(true);
      setMessage("✅ Свързано с Google Drive.");
    } catch {
      setMessage("❌ Грешка при свързване с Google.");
    }
    setLoading(false);
  };

  const disconnect = () => {
    signOutFromGoogle();
    setConnected(false);
    setAutoSync(false);
    saveSettings(false);
    setMessage("🔌 Изключено от Google Drive.");
  };

  const toggleAutoSync = (val) => {
    setAutoSync(val);
    saveSettings(val);
  };

  const uploadBackup = useCallback(async (backupData, profileName) => {
    if (!isSignedIn()) {
      setMessage("❌ Сесията е изтекла. Свържете се отново с Google Drive.");
      return false;
    }
    setLoading(true);
    setMessage("");
    try {
      await uploadBackupToDrive(backupData, profileName);
      setMessage("✅ Backup качен в Google Drive.");
      return true;
    } catch (err) {
      setMessage("❌ " + err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const downloadBackup = useCallback(async (profileName) => {
    if (!isSignedIn()) {
      setMessage("❌ Първо се свържете с Google Drive.");
      return null;
    }
    setLoading(true);
    setMessage("");
    try {
      const data = await downloadLatestBackupFromDrive(profileName);
      setMessage("✅ Backup изтеглен успешно.");
      return data;
    } catch (err) {
      setMessage("❌ " + err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    connected,
    autoSync,
    loading,
    message,
    connect,
    disconnect,
    toggleAutoSync,
    uploadBackup,
    downloadBackup,
  };
}