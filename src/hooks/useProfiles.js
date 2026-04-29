import { useState, useEffect } from "react";
import { openDB } from "../utils/db";

const STORE = "profiles";

const loadAll = async () => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch { return []; }
};

const saveOne = async (profile) => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(profile);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch { console.error("Грешка при запис на профил"); }
};

const deleteOne = async (id) => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch { console.error("Грешка при изтриване на профил"); }
};

const ACTIVE_PROFILE_KEY = "active_profile_id";

export const useProfiles = () => {
  const [profiles, setProfiles] = useState([]);
  const [activeProfileId, setActiveProfileId] = useState(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    loadAll().then((data) => {
      setProfiles(data);
      const saved = localStorage.getItem(ACTIVE_PROFILE_KEY);
      if (saved && data.some((p) => p.id === saved)) {
        setActiveProfileId(saved);
      } else if (data.length > 0) {
        setActiveProfileId(data[0].id);
        localStorage.setItem(ACTIVE_PROFILE_KEY, data[0].id);
      }
      setIsLoaded(true);
    });
  }, []);

  const activeProfile = profiles.find((p) => p.id === activeProfileId) || null;

  const createProfile = async (name) => {
    const trimmed = name.trim();
    if (!trimmed) return false;
    if (profiles.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) return false;
    const newProfile = {
      id: `profile_${Date.now()}`,
      name: trimmed,
      createdAt: new Date().toISOString(),
    };
    await saveOne(newProfile);
    setProfiles((prev) => [...prev, newProfile]);
    setActiveProfileId(newProfile.id);
    localStorage.setItem(ACTIVE_PROFILE_KEY, newProfile.id);
    return newProfile;
  };

  const switchProfile = (id) => {
    if (!profiles.some((p) => p.id === id)) return false;
    setActiveProfileId(id);
    localStorage.setItem(ACTIVE_PROFILE_KEY, id);
    return true;
  };

  const deleteProfile = async (id) => {
    await deleteOne(id);
    setProfiles((prev) => prev.filter((p) => p.id !== id));
    if (activeProfileId === id) {
      const remaining = profiles.filter((p) => p.id !== id);
      if (remaining.length > 0) {
        setActiveProfileId(remaining[0].id);
        localStorage.setItem(ACTIVE_PROFILE_KEY, remaining[0].id);
      } else {
        setActiveProfileId(null);
        localStorage.removeItem(ACTIVE_PROFILE_KEY);
      }
    }
  };

  const renameProfile = async (id, newName) => {
    const trimmed = newName.trim();
    if (!trimmed) return false;
    if (profiles.some((p) => p.name.toLowerCase() === trimmed.toLowerCase() && p.id !== id)) return false;
    const updated = profiles.map((p) => p.id === id ? { ...p, name: trimmed } : p);
    const profile = updated.find((p) => p.id === id);
    await saveOne(profile);
    setProfiles(updated);
    return true;
  };
  const addOrUpdateProfile = async (profile) => {
    await saveOne(profile);
    setProfiles((prev) => {
      const exists = prev.some((p) => p.id === profile.id);
      if (exists) return prev.map((p) => p.id === profile.id ? profile : p);
      return [...prev, profile];
    });
  };

  const restoreProfiles = async (newProfiles, newActiveId) => {
    try {
      const db = await openDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        store.clear();
        newProfiles.forEach((p) => store.put(p));
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      setProfiles(newProfiles);
      if (newActiveId && newProfiles.some((p) => p.id === newActiveId)) {
        setActiveProfileId(newActiveId);
        localStorage.setItem(ACTIVE_PROFILE_KEY, newActiveId);
      } else if (newProfiles.length > 0) {
        setActiveProfileId(newProfiles[0].id);
        localStorage.setItem(ACTIVE_PROFILE_KEY, newProfiles[0].id);
      }
    } catch { console.error("Грешка при restore на профили"); }
  };

  return {
    profiles,
    activeProfileId,
    activeProfile,
    isLoaded,
    createProfile,
    switchProfile,
    deleteProfile,
    renameProfile,
    restoreProfiles,
    addOrUpdateProfile,
  };
};