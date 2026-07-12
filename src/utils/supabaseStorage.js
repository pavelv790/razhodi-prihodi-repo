import { supabase } from "./supabase";

const BUCKET_NAME = "finances-backup";

// Връща текущия потребител или null
async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// Изгражда името на файла по същия модел като Google Drive
function transliterate(str) {
  const map = {
    'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ж':'zh','з':'z',
    'и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p',
    'р':'r','с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'ts','ч':'ch',
    'ш':'sh','щ':'sht','ъ':'a','ь':'','ю':'yu','я':'ya',
    'А':'A','Б':'B','В':'V','Г':'G','Д':'D','Е':'E','Ж':'Zh','З':'Z',
    'И':'I','Й':'Y','К':'K','Л':'L','М':'M','Н':'N','О':'O','П':'P',
    'Р':'R','С':'S','Т':'T','У':'U','Ф':'F','Х':'H','Ц':'Ts','Ч':'Ch',
    'Ш':'Sh','Щ':'Sht','Ъ':'A','Ь':'','Ю':'Yu','Я':'Ya',
  };
  return str.split('').map(c => map[c] ?? c).join('');
}

function buildFileName(profileName) {
  const today = new Date();
  const day = String(today.getDate()).padStart(2, "0");
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const year = today.getFullYear();
  const safeName = profileName ? transliterate(profileName) : "";
  const profileSuffix = safeName ? `_${safeName}` : "";
  return `Finances_Backup${profileSuffix}_${day}.${month}.${year}.json`;
}

// Връща prefix за търсене без датата (напр. "Finances_Backup_Павел")
function buildFilePrefix(profileName) {
  const safeName = profileName ? transliterate(profileName) : "";
  const profileSuffix = safeName ? `_${safeName}` : "";
  return `Finances_Backup${profileSuffix}`;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isExactBackupFileName(fileName, prefix) {
  const pattern = new RegExp(`^${escapeRegex(prefix)}_\\d{2}\\.\\d{2}\\.\\d{4}\\.json$`);
  return pattern.test(fileName);
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
      .filter((f) => isExactBackupFileName(f.name, prefix))
      .map((f) => `${userId}/${f.name}`);
    if (oldPaths.length > 0) {
      const { error: removeError } = await supabase.storage.from(BUCKET_NAME).remove(oldPaths);
      if (removeError) {
        console.warn("Предупреждение: не успя да изтрие старото резервно копие:", removeError.message);
      }
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

  if (listError) throw new Error("Грешка при търсене на резервното копие.");

  const matching = (files || []).filter((f) => isExactBackupFileName(f.name, prefix));
  if (matching.length === 0) throw new Error("Няма намерено резервно копие в Supabase.");

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
