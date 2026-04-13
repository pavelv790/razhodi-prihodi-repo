export const formatAmount = (amount) =>
  new Intl.NumberFormat("bg-BG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);

export const formatDate = (dateStr) => {
  if (!dateStr) return "";
  const [day, month, year] = dateStr.split("/");
  if (!day || !month || !year) return dateStr;
  return `${day.padStart(2, "0")}/${month.padStart(2, "0")}/${year}`;
};

export const parseDate = (dateStr) => {
  if (!dateStr) return null;
  const [day, month, year] = dateStr.split("/");
  if (!day || !month || !year) return null;
  return new Date(year, month - 1, day);
};

export const autoFormatDate = (value) => {
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4, 8)}`;
};

export const isValidDate = (dateStr) => {
  if (!dateStr || dateStr.length !== 10) return false;
  const [day, month, year] = dateStr.split("/").map(Number);
  if (!day || !month || !year) return false;
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
};

export const getTodayString = () => {
  const today = new Date();
  const day = String(today.getDate()).padStart(2, "0");
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const year = today.getFullYear();
  return `${day}/${month}/${year}`;
};

export const getFirstDayOfMonth = (date = new Date()) => {
  const day = "01";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
};

export const getLastDayOfMonth = (date = new Date()) => {
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const day = String(lastDay.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
};