import { supabase } from "./supabase";
import { isGoogleSession } from "./authSession";
import { signOutFromSupabase } from "./supabaseAuth";

const SCOPES = "https://www.googleapis.com/auth/drive.file";
const FOLDER_NAME = "Finances_Backup";

// Ключът за достъп до Drive (`provider_token`) идва само веднъж — веднага след вход през Google —
// и важи 1 час. Пази се отделно от Supabase сесията (там изчезва при опресняването ѝ), с малък резерв
// преди изтичане (одит 2026-10, 3-02). След изтичане е нужно ново свързване.
const TOKEN_KEY = "google_drive_token";
const TOKEN_LIFETIME_MS = 55 * 60 * 1000;

let accessToken = null;
let accessTokenExpiresAt = 0;

try {
  // зарежда се и изтекъл ключ: ако сесията го подаде пак, срокът му остава старият
  const saved = JSON.parse(localStorage.getItem(TOKEN_KEY) || "null");
  if (saved?.token && Number.isFinite(saved.expiresAt)) {
    accessToken = saved.token;
    accessTokenExpiresAt = saved.expiresAt;
  }
} catch {
  // повреден запис — ще е нужно ново свързване
}

// Белег „този раздел тръгна към Google“ — само тогава грешка в адреса се чете като отказ от
// свързване (същият вид адрес идва и от развален линк за смяна на парола на Облака)
const OAUTH_PENDING_KEY = "google_oauth_pending";
const OAUTH_PENDING_MAX_MS = 15 * 60 * 1000;
const OAUTH_ERROR_PARAMS = ["error", "error_code", "error_description"];

function setOAuthPending(on) {
  try {
    if (on) sessionStorage.setItem(OAUTH_PENDING_KEY, String(Date.now()));
    else sessionStorage.removeItem(OAUTH_PENDING_KEY);
  } catch {
    // без sessionStorage — отказът няма да се покаже
  }
}

export async function signInWithGoogle() {
  setOAuthPending(true);
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        scopes: SCOPES,
        redirectTo: window.location.origin,
      },
    });
    if (error) throw new Error(error.message);
    return data;
  } catch (err) {
    setOAuthPending(false);
    throw err;
  }
}

// Вход през Google е завършил — белегът вече не трябва
export function clearGoogleSignInPending() {
  setOAuthPending(false);
}

// При отказ в Google (или грешка на Supabase) потребителят се връща с `error=…` в адреса —
// в query или в hash. auth-js не чисти адреса при грешка и нищо не съобщава (одит 2026-10, 3-14).
// true, ако този раздел е започнал вход с Google и в адреса има грешка: белегът и грешката се
// махат от адреса (да не се показва пак при презареждане). Иначе адресът не се пипа.
export function takeGoogleSignInError() {
  let startedAt = 0;
  try {
    startedAt = Number(sessionStorage.getItem(OAUTH_PENDING_KEY)) || 0;
  } catch {
    return false;
  }
  if (!startedAt) return false;

  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : "");
  const hasError = OAUTH_ERROR_PARAMS.some((k) => url.searchParams.has(k) || hash.has(k));
  if (!hasError) return false;

  setOAuthPending(false);
  OAUTH_ERROR_PARAMS.forEach((k) => {
    url.searchParams.delete(k);
    hash.delete(k);
  });
  const rest = hash.toString();
  try {
    window.history.replaceState(window.history.state, "", url.pathname + url.search + (rest ? `#${rest}` : ""));
  } catch {
    // адресът остава — съобщението пак се показва веднъж
  }
  return Date.now() - startedAt < OAUTH_PENDING_MAX_MS;
}

// true, ако текущата Supabase сесия е от вход през Google (Drive е свързан) — дори ключът
// за достъп да е изтекъл (тогава isSignedIn() е false и е нужно ново свързване)
export async function restoreSessionFromSupabase() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!isGoogleSession(session)) {
    clearAccessToken();
    return false;
  }
  if (session.provider_token) setAccessToken(session.provider_token);
  return true;
}

// Хвърля при неуспешен изход (виж signOutFromSupabase) — тогава ключът и връзката остават
export async function signOutFromGoogle() {
  await signOutFromSupabase();
  clearAccessToken();
}

// Има валиден (неизтекъл) ключ за достъп до Drive
export function isSignedIn() {
  return !!accessToken && Date.now() < accessTokenExpiresAt;
}

export function setAccessToken(token) {
  // същият ключ идва пак (напр. при презареждане до 1 час след входа) — срокът му не се удължава
  if (token === accessToken && accessTokenExpiresAt) return;
  accessToken = token;
  accessTokenExpiresAt = Date.now() + TOKEN_LIFETIME_MS;
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ token, expiresAt: accessTokenExpiresAt }));
  } catch {
    // без запис — ключът важи до презареждане
  }
}

export function clearAccessToken() {
  accessToken = null;
  accessTokenExpiresAt = 0;
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // няма достъп до localStorage
  }
}

// Заявка към Drive. Без мрежа fetch хвърля TypeError („Failed to fetch“) — тя става ясна грешка
// с белег network: авто-качването я пропуска тихо, а не я показва като изтекла сесия (одит 2026-10, 3-10)
async function driveFetch(url, options) {
  try {
    return await fetch(url, options);
  } catch {
    const err = new Error("Няма връзка с интернет или Google Drive не отговаря.");
    err.network = true;
    throw err;
  }
}

// URL за търсене на файлове; параметрите се кодират (иначе „&“, „#“, „+“ в името на профила
// чупят или изкривяват заявката)
function filesSearchUrl(params) {
  return `https://www.googleapis.com/drive/v3/files?${new URLSearchParams(params)}`;
}

// Ако има две папки с това име (създадени от застъпили се качвания в по-стари версии),
// винаги се взима най-старата — качването и възстановяването гледат една и съща (3-07)
async function getOrCreateFolder() {
  const searchRes = await driveFetch(
    filesSearchUrl({
      q: `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      orderBy: "createdTime",
      fields: "files(id,name)",
    }),
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  await checkDriveResponse(searchRes);
  const searchData = await searchRes.json();
  if (searchData.files?.length > 0) return searchData.files[0].id;

  const createRes = await driveFetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
  });
  await checkDriveResponse(createRes);
  const folder = await createRes.json();
  return folder.id;
}

async function checkDriveResponse(res) {
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      // 401 — Google вече не приема ключа (изтекъл/отнет): нужно е ново свързване (3-02)
      if (res.status === 401) clearAccessToken();
      throw new Error("Сесията е изтекла. Свържете се отново с Google Drive.");
    }
    throw new Error(`Грешка от Google Drive (код ${res.status}).`);
  }
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Екранира стойност за вграждане в Google Drive API заявка (q=...)
// според изискванията на синтаксиса: обратна наклонена черта и единична кавичка
function escapeDriveQuery(str) {
  return str.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function isExactBackupFileName(fileName, prefix) {
  const pattern = new RegExp(`^${escapeRegex(prefix)}_\\d{2}\\.\\d{2}\\.\\d{4}\\.json$`);
  return pattern.test(fileName);
}

// Колко датирани копия на профил се пазят в Google Drive (по едно на ден, вкл. днешното).
// По-старите отиват в кошчето на Drive, не се трият окончателно.
const BACKUPS_TO_KEEP = 14;

// Копията на профила в папката, най-новото първо
async function listProfileBackups(prefix, folderId) {
  const safePrefix = escapeDriveQuery(prefix);
  const res = await driveFetch(
    filesSearchUrl({
      q: `name contains '${safePrefix}' and '${folderId}' in parents and trashed=false`,
      orderBy: "modifiedTime desc",
      fields: "files(id,name,modifiedTime,size)",
      pageSize: "100",
    }),
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  await checkDriveResponse(res);
  const data = await res.json();
  return (data.files || []).filter((f) => isExactBackupFileName(f.name, prefix));
}

async function moveToTrash(fileId) {
  let res;
  try {
    res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ trashed: true }),
    });
  } catch (err) {
    // копието вече е качено — връзката е паднала след това; старото ще отиде в кошчето следващия път
    console.warn("Предупреждение: не успя да премести старо резервно копие в кошчето:", err.message);
    return;
  }
  if (!res.ok) {
    console.warn("Предупреждение: не успя да премести старо резервно копие в кошчето:", res.status);
  }
}

export async function uploadBackupToDrive(backupData, profileName) {
  if (!accessToken) throw new Error("Не сте влезли в Google акаунт.");

  const today = new Date();
  const day = String(today.getDate()).padStart(2, "0");
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const year = today.getFullYear();
  const profileSuffix = profileName ? `_${profileName}` : "";
  const fileName = `Finances_Backup${profileSuffix}_${day}.${month}.${year}.json`;

  const folderId = await getOrCreateFolder();
  // Днешното копие се презаписва, иначе се създава ново — по едно копие на ден
  const existingFiles = await listProfileBackups(`Finances_Backup${profileSuffix}`, folderId);
  const existingFileId = existingFiles.find((f) => f.name === fileName)?.id || null;

  const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: "application/json" });

  const metadata = { name: fileName, mimeType: "application/json" };
  if (!existingFileId) metadata.parents = [folderId];

  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("file", blob);

  const url = existingFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";

  const method = existingFileId ? "PATCH" : "POST";

  const res = await driveFetch(url, {
    method,
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });

  if (!res.ok) throw new Error("Грешка при качване в Google Drive.");
  const uploaded = await res.json();

  // Едва след успешно качване — копията, по-стари от последните BACKUPS_TO_KEEP, в кошчето
  const oldFiles = existingFiles
    .filter((f) => f.id !== existingFileId)
    .slice(BACKUPS_TO_KEEP - 1);
  for (const f of oldFiles) {
    await moveToTrash(f.id);
  }

  return uploaded;
}

// Връща копията на профила, най-новото първо, без да ги изтегля:
// [{ fileId, fileName, updatedAt, size }] (празен, ако няма)
export async function listBackupsFromDrive(profileName) {
  if (!accessToken) throw new Error("Не сте влезли в Google акаунт.");

  const folderId = await getOrCreateFolder();

  const profileSuffix = profileName ? `_${profileName}` : "";
  const matches = await listProfileBackups(`Finances_Backup${profileSuffix}`, folderId);

  return matches.map((f) => ({
    fileId: f.id,
    fileName: f.name,
    updatedAt: f.modifiedTime,
    size: f.size != null ? Number(f.size) : null,
  }));
}

export async function downloadBackupFileFromDrive(fileId) {
  if (!accessToken) throw new Error("Не сте влезли в Google акаунт.");

  const fileRes = await driveFetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!fileRes.ok) throw new Error("Грешка при изтегляне от Google Drive.");
  try {
    return await fileRes.json();
  } catch {
    throw new Error("Копието в Google Drive е повредено и не може да се прочете.");
  }
}