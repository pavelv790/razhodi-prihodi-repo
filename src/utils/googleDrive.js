const CLIENT_ID = "1024772587633-lp6nqomdr2ge5tsp58f182v9hk1954eu.apps.googleusercontent.com";
const SCOPES = "https://www.googleapis.com/auth/drive.file";
const FOLDER_NAME = "Finances_Backup";

let tokenClient = null;
let accessToken = null;

function loadGsiScript() {
  return new Promise((resolve) => {
    if (window.google?.accounts?.oauth2) { resolve(); return; }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.onload = resolve;
    document.head.appendChild(script);
  });
}

export async function signInWithGoogle() {
  await loadGsiScript();
  return new Promise((resolve, reject) => {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: (response) => {
        if (response.error) { reject(new Error(response.error)); return; }
        accessToken = response.access_token;
        resolve(accessToken);
      },
    });
    tokenClient.requestAccessToken({ prompt: "consent" });
  });
}

export function signOutFromGoogle() {
  if (accessToken) {
    window.google?.accounts?.oauth2?.revoke(accessToken);
    accessToken = null;
  }
}

export function isSignedIn() {
  return !!accessToken;
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

export async function uploadBackupToDrive(backupData, profileName) {
  if (!accessToken) throw new Error("Не сте влезли в Google акаунт.");

  const today = new Date();
  const day = String(today.getDate()).padStart(2, "0");
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const year = today.getFullYear();
  const profileSuffix = profileName ? `_${profileName}` : "";
  const fileName = `Finances_Backup${profileSuffix}_${day}.${month}.${year}.json`;

  const folderId = await getOrCreateFolder();
  const existingFileId = await findExistingFile(fileName, folderId);

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