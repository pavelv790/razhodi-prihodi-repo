export const exportBackup = (transactions, expenseCategories, incomeCategories, savedFilters, currency, rate) => {
  const backup = {
    version: "1.1",
    date: new Date().toISOString(),
    transactions,
    expenseCategories,
    incomeCategories,
    savedFilters,
    currency,
    rate,
  };

  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const today = new Date();
  const day = String(today.getDate()).padStart(2, "0");
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const year = today.getFullYear();
  a.href = url;
  a.download = `Финанси_Backup_${day}.${month}.${year}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

export const importBackup = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data.transactions || !data.expenseCategories || !data.incomeCategories) {
          reject(new Error("Невалиден backup файл."));
          return;
        }
        resolve(data);
      } catch {
        reject(new Error("Грешка при четене на файла."));
      }
    };
    reader.onerror = () => reject(new Error("Грешка при отваряне на файла."));
    reader.readAsText(file);
  });
};