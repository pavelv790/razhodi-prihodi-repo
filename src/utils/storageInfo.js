// Памет на устройството (Б2а): постоянно хранилище и заето място.
// Всичко е по възможност — в стари браузъри navigator.storage липсва и функциите връщат null/false.

// Заето над този дял от квотата → предупреждение в панела „Данни“
export const STORAGE_WARN_RATIO = 0.8;

// Иска от браузъра данните на сайта да не се изтриват сами при недостиг на място.
// Не хвърля; връща true, ако хранилището е (или вече стана) постоянно.
export async function requestPersistentStorage() {
  try {
    if (!navigator.storage?.persist) return false;
    if (navigator.storage.persisted && (await navigator.storage.persisted())) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

// { usage, quota, ratio } в байтове или null, ако браузърът не дава оценка.
export async function getStorageUsage() {
  try {
    if (!navigator.storage?.estimate) return null;
    const { usage, quota } = await navigator.storage.estimate();
    if (!Number.isFinite(usage) || !Number.isFinite(quota) || quota <= 0) return null;
    return { usage, quota, ratio: usage / quota };
  } catch {
    return null;
  }
}

export function formatBytes(bytes) {
  const units = ["Б", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  const digits = i === 0 || value >= 100 ? 0 : 1;
  return `${value.toLocaleString("bg-BG", { maximumFractionDigits: digits })} ${units[i]}`;
}
