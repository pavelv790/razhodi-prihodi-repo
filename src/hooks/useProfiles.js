import { useState, useEffect } from "react";
import { runTx, reportDBError } from "../utils/db";

const STORE = "profiles";

// При грешка отхвърля: провалено четене не е „няма профили“ (иначе приложението иска нов профил)
const loadAll = async () =>
  (await runTx(STORE, "readonly", (store) => store.getAll())) || [];

const saveOne = async (profile) => {
  try {
    await runTx(STORE, "readwrite", (store) => store.put(profile));
  } catch (err) { reportDBError(); console.error("Грешка при запис на профил", err); }
};

// При грешка отхвърля: профилът остава в списъка, щом не е изтрит от базата
const deleteOne = async (id) => {
  try {
    await runTx(STORE, "readwrite", (store) => store.delete(id));
  } catch (err) {
    reportDBError();
    console.error("Грешка при изтриване на профил", err);
    throw err;
  }
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
    }).catch((err) => {
      // isLoaded остава false: приложението не предлага нов профил и нищо не се записва (одит 2026-10, 1А-04)
      reportDBError();
      console.error("Грешка при зареждане на профилите от IndexedDB", err);
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
    const remaining = profiles.filter((p) => p.id !== id);
    setProfiles(remaining);
    if (activeProfileId === id) {
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

  
  return {
    profiles,
    activeProfileId,
    activeProfile,
    isLoaded,
    createProfile,
    switchProfile,
    deleteProfile,
    renameProfile,
    addOrUpdateProfile,
  };
};