export const exportBackup = (transactions, expenseCategories, incomeCategories, savedFilters, currency, rate, budgets, profiles, activeProfileId, recurringItems, profileName, allProfileCategories) => {
  const profileCategories = allProfileCategories || { [activeProfileId]: { expense: expenseCategories, income: incomeCategories } };
  const backup = {
    version: "1.5",
    date: new Date().toISOString(),
    profiles,
    activeProfileId,
    transactions,
    expenseCategories,
    incomeCategories,
    profileCategories,
    savedFilters,
    currency,
    rate,
    budgets,
    recurringItems,
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
  const profileSuffix = profileName ? `_${profileName}` : "";
  a.download = `Финанси_Backup${profileSuffix}_${day}.${month}.${year}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);
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
        // Ако backup-ът е стар (без профили), създаваме един профил "По подразбиране"
        if (!data.profiles || data.profiles.length === 0) {
          const defaultProfile = {
            id: `profile_${Date.now()}`,
            name: "По подразбиране",
            createdAt: new Date().toISOString(),
          };
          data.profiles = [defaultProfile];
          data.activeProfileId = defaultProfile.id;
          data.transactions = data.transactions.map((t) => ({
            ...t,
            profileId: defaultProfile.id,
          }));
          if (data.savedFilters) {
            data.savedFilters = data.savedFilters.map((f) => ({
              ...f,
              profileId: defaultProfile.id,
            }));
          }
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