import { supabase } from "./supabase";

const SCOPES = "https://www.googleapis.com/auth/drive.file";
const FOLDER_NAME = "Finances_Backup";

let accessToken = null;

export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      scopes: SCOPES,
      redirectTo: window.location.origin,
    },
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function restoreSessionFromSupabase() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.provider_token) {
    accessToken = session.provider_token;
    return true;
  }
  return false;
}

export function signOutFromGoogle() {
  accessToken = null;
  supabase.auth.signOut();
}

export function isSignedIn() {
  return !!accessToken;
}

export function setAccessToken(token) {
  accessToken = token;
}

// URL за търсене на файлове; параметрите се кодират (иначе „&“, „#“, „+“ в името на профила
// чупят или изкривяват заявката)
function filesSearchUrl(params) {
  return `https://www.googleapis.com/drive/v3/files?${new URLSearchParams(params)}`;
}

async function getOrCreateFolder() {
  const searchRes = await fetch(
    filesSearchUrl({
      q: `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "files(id,name)",
    }),
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  await checkDriveResponse(searchRes);
  const searchData = await searchRes.json();
  if (searchData.files?.length > 0) return searchData.files[0].id;

  const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
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
  const res = await fetch(
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
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ trashed: true }),
  });
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

  const res = await fetch(url, {
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
// [{ fileId, fileName, updatedAt, size }]
export async function listBackupsFromDrive(profileName) {
  if (!accessToken) throw new Error("Не сте влезли в Google акаунт.");

  const folderId = await getOrCreateFolder();

  const profileSuffix = profileName ? `_${profileName}` : "";
  const matches = await listProfileBackups(`Finances_Backup${profileSuffix}`, folderId);
  if (!matches.length) throw new Error("Няма намерено резервно копие в Google Drive.");

  return matches.map((f) => ({
    fileId: f.id,
    fileName: f.name,
    updatedAt: f.modifiedTime,
    size: f.size != null ? Number(f.size) : null,
  }));
}

export async function downloadBackupFileFromDrive(fileId) {
  if (!accessToken) throw new Error("Не сте влезли в Google акаунт.");

  const fileRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!fileRes.ok) throw new Error("Грешка при изтегляне от Google Drive.");
  return await fileRes.json();
}