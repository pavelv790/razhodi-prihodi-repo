import { supabase } from "./supabase";

const BUCKET_NAME = "finances-backup";

// Връща текущия потребител или null
async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// Изгражда името на файла по същия модел като Google Drive
function buildFileName(profileName) {
  const today = new Date();
  const day = String(today.getDate()).padStart(2, "0");
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const year = today.getFullYear();
  const profileSuffix = profileName ? `_${profileName}` : "";
  return `Finances_Backup${profileSuffix}_${day}.${month}.${year}.json`;
}

// Връща prefix за търсене без датата (напр. "Finances_Backup_Павел")
function buildFilePrefix(profileName) {
  const profileSuffix = profileName ? `_${profileName}` : "";
  return `Finances_Backup${profileSuffix}`;
}

export async function uploadBackupToSupabase(backupData, profileName) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Не сте влезли в акаунт.");

  const userId = user.id;
  const newFileName = buildFileName(profileName);
  const prefix = buildFilePrefix(profileName);

  // Намери и изтрий стария файл (ако съществува) — търсим по prefix без дата
  const { data: existingFiles } = await supabase.storage
    .from(BUCKET_NAME)
    .list(userId, { search: prefix });

  if (existingFiles?.length > 0) {
    const oldPaths = existingFiles
      .filter((f) => f.name.startsWith(prefix))
      .map((f) => `${userId}/${f.name}`);
    if (oldPaths.length > 0) {
      await supabase.storage.from(BUCKET_NAME).remove(oldPaths);
    }
  }

  // Качи новия файл
  const blob = new Blob([JSON.stringify(backupData, null, 2)], {
    type: "application/json",
  });

  const { error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(`${userId}/${newFileName}`, blob, {
      upsert: true,
      contentType: "application/json",
    });

  if (error) throw new Error("Грешка при качване в Supabase: " + error.message);
  return newFileName;
}

export async function downloadBackupFromSupabase(profileName) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Не сте влезли в акаунт.");

  const userId = user.id;
  const prefix = buildFilePrefix(profileName);

  // Намери файла по prefix
  const { data: files, error: listError } = await supabase.storage
    .from(BUCKET_NAME)
    .list(userId, { search: prefix });

  if (listError) throw new Error("Грешка при търсене на backup файл.");

  const matching = (files || []).filter((f) => f.name.startsWith(prefix));
  if (matching.length === 0) throw new Error("Няма намерен backup файл в Supabase.");

  // Вземи най-новия ако има повече от един (не би трябвало, но за сигурност)
  const latest = matching.sort((a, b) =>
    new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at)
  )[0];

  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .download(`${userId}/${latest.name}`);

  if (error) throw new Error("Грешка при изтегляне от Supabase.");

  const text = await data.text();
  return JSON.parse(text);
}

export async function isSupabaseStorageAvailable() {
  const user = await getCurrentUser();
  return !!user;
}