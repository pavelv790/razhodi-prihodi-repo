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

async function getOrCreateFolder() {
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const searchData = await searchRes.json();
  if (searchData.files?.length > 0) return searchData.files[0].id;

  const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
  });
  const folder = await createRes.json();
  return folder.id;
}

async function findExistingFile(fileName, folderId) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name='${fileName}' and '${folderId}' in parents and trashed=false&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = await res.json();
  return data.files?.[0]?.id || null;
}
async function findExistingFileByProfile(prefix, folderId) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name contains '${prefix}' and '${folderId}' in parents and trashed=false&orderBy=modifiedTime desc&fields=files(id,name)&pageSize=1`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = await res.json();
  return data.files?.[0]?.id || null;
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
  const existingFileId = await findExistingFileByProfile(`Finances_Backup${profileSuffix}`, folderId);

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
  return await res.json();
}

export async function downloadLatestBackupFromDrive(profileName) {
  if (!accessToken) throw new Error("Не сте влезли в Google акаунт.");

  const folderId = await getOrCreateFolder();

  const profileSuffix = profileName ? `_${profileName}` : "";
  const prefix = `Finances_Backup${profileSuffix}`;

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name contains '${prefix}' and '${folderId}' in parents and trashed=false&orderBy=modifiedTime desc&fields=files(id,name,modifiedTime)&pageSize=1`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = await res.json();
  if (!data.files?.length) throw new Error("Няма намерен backup файл в Google Drive.");

  const fileId = data.files[0].id;
  const fileRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!fileRes.ok) throw new Error("Грешка при изтегляне от Google Drive.");
  return await fileRes.json();
}