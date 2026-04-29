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
    return saved ? JSON.parse(saved).autoSync || false : false;
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

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

  const connect = async () => {
    setLoading(true);
    setMessage("");
    try {
      await signInWithGoogle();
      // Supabase ще пренасочи към Google и после обратно
      // setConnected се вика от onAuthStateChange
    } catch (err) {
      setMessage("blocked");
      setLoading(false);
    }
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
    setMessage,
    connect,
    disconnect,
    toggleAutoSync,
    uploadBackup,
    downloadBackup,
  };
}