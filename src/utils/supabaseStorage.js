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

// Име на профила за пътя в Облака: транслитерация + само безопасни знаци.
// Supabase Storage приема в ключа само ASCII, а „/“ създава подпапка.
function safeProfileName(profileName) {
  return profileName ? transliterate(profileName).replace(/[^A-Za-z0-9 _\-.()]/g, "_") : "";
}

// Името, както се строеше преди (само транслитерация) — за намиране и чистене на старите копия
function legacyProfileName(profileName) {
  return profileName ? transliterate(profileName) : "";
}

function buildFileName(profileName, profileId) {
  const today = new Date();
  const day = String(today.getDate()).padStart(2, "0");
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const year = today.getFullYear();
  return `${buildFilePrefix(profileName, profileId)}_${day}.${month}.${year}.json`;
}

// Връща prefix за търсене без датата (напр. "Finances_Backup_Pavel_7890")
function buildFilePrefix(profileName, profileId, nameFn = safeProfileName) {
  const safeName = nameFn(profileName);
  const idSuffix = profileId ? `_${profileId.slice(-4)}` : "";
  const profileSuffix = safeName ? `_${safeName}${idSuffix}` : "";
  return `Finances_Backup${profileSuffix}`;
}

// Текущият prefix и, ако е различен, старият (стари копия с „/“ са в подпапка и не се търсят)
function buildFilePrefixes(profileName, profileId) {
  const prefixes = [buildFilePrefix(profileName, profileId)];
  const legacy = buildFilePrefix(profileName, profileId, legacyProfileName);
  if (legacy !== prefixes[0] && !legacy.includes("/")) prefixes.push(legacy);
  return prefixes;
}

// Файловете на потребителя, намерени по някой от префиксите (без повторения)
async function listByPrefixes(userId, prefixes) {
  const byName = new Map();
  for (const prefix of prefixes) {
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .list(userId, { search: prefix, limit: 1000 });
    if (error) return { files: [], error };
    (data || []).forEach((f) => byName.set(f.name, f));
  }
  return { files: [...byName.values()], error: null };
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isExactBackupFileName(fileName, prefix) {
  const pattern = new RegExp(`^${escapeRegex(prefix)}_\\d{2}\\.\\d{2}\\.\\d{4}\\.json$`);
  return pattern.test(fileName);
}

// Копие на профил с това име при какъвто и да е profileId (или без опашка от id).
// На ново устройство или при пресъздаден профил id-то е друго и точното име не съвпада.
function isBackupFileForProfileName(fileName, profileName) {
  return [safeProfileName(profileName), legacyProfileName(profileName)].some((name) => {
    const namePart = name ? `_${escapeRegex(name)}(_[A-Za-z0-9]{4})?` : "";
    const pattern = new RegExp(`^Finances_Backup${namePart}_\\d{2}\\.\\d{2}\\.\\d{4}\\.json$`, "i");
    return pattern.test(fileName);
  });
}

// Колко датирани копия на профил се пазят в Облака (по едно на ден, вкл. днешното)
const BACKUPS_TO_KEEP = 14;

const newestFirst = (a, b) =>
  new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at);

export async function uploadBackupToSupabase(backupData, profileName, profileId) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Не сте влезли в акаунт.");

  const userId = user.id;
  const newFileName = buildFileName(profileName, profileId);
  const prefixes = buildFilePrefixes(profileName, profileId);

  // Качи новия файл ПЪРВО (upsert: true презаписва безопасно при съвпадащо име)
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

  // Едва след успешно качване — изтрий копията на профила, по-стари от последните
  // BACKUPS_TO_KEEP (по prefix без дата, вкл. тези със старото име на профила)
  const { files: existingFiles } = await listByPrefixes(userId, prefixes);

  if (existingFiles.length > 0) {
    const oldPaths = existingFiles
      .filter((f) => prefixes.some((p) => isExactBackupFileName(f.name, p)) && f.name !== newFileName)
      .sort(newestFirst)
      .slice(BACKUPS_TO_KEEP - 1)
      .map((f) => `${userId}/${f.name}`);
    if (oldPaths.length > 0) {
      const { error: removeError } = await supabase.storage.from(BUCKET_NAME).remove(oldPaths);
      if (removeError) {
        console.warn("Предупреждение: не успя да изтрие старото резервно копие:", removeError.message);
      }
    }
  }

  return newFileName;
}

// Връща копията на профила (по име, при всеки profileId), най-новото първо, без да ги изтегля:
// [{ fileName, updatedAt, size, isSameProfile }] (празен, ако няма). isSameProfile — копието е от профила с този id.
export async function listBackupsFromSupabase(profileName, profileId) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Не сте влезли в акаунт.");

  const userId = user.id;
  const namePrefixes = buildFilePrefixes(profileName, null);
  const exactPrefixes = buildFilePrefixes(profileName, profileId);

  // Намери файловете по prefix без id (текущото и старото име на профила)
  const { files, error: listError } = await listByPrefixes(userId, namePrefixes);

  if (listError) throw new Error("Грешка при търсене на резервното копие.");

  const matching = files
    .filter((f) => isBackupFileForProfileName(f.name, profileName))
    .sort(newestFirst);

  return matching.map((f) => ({
    fileName: f.name,
    updatedAt: f.updated_at || f.created_at,
    size: f.metadata?.size ?? null,
    isSameProfile: exactPrefixes.some((p) => isExactBackupFileName(f.name, p)),
  }));
}

export async function downloadBackupFileFromSupabase(fileName) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Не сте влезли в акаунт.");

  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .download(`${user.id}/${fileName}`);

  if (error) throw new Error("Грешка при изтегляне от Supabase.");

  const text = await data.text();
  return JSON.parse(text);
}
