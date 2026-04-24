import { useState, useEffect } from "react";
import { openDB } from "../utils/db";

const STORE = "currency";


const load = async (profileId) => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(profileId);
      req.onsuccess = () => resolve(req.result || { id: profileId, currency: "EUR", rate: 1 });
      req.onerror = () => reject(req.error);
    });
  } catch { return { id: profileId, currency: "EUR", rate: 1 }; }
};

const save = async (profileId, data) => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ id: profileId, ...data });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch { console.error("Грешка при запис на валута"); }
};

export const useCurrency = (profileId) => {
  const [currency, setCurrency] = useState("EUR");
  const [rate, setRate] = useState(1);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (!profileId) return;
    setIsLoaded(false);
    setCurrency("EUR");
    setRate(1);
    load(profileId).then((data) => {
      setCurrency(data.currency);
      setRate(data.rate);
      setIsLoaded(true);
    });
  }, [profileId]);

  useEffect(() => {
    if (isLoaded && profileId) {
      save(profileId, { currency, rate });
    }
  }, [currency, rate, isLoaded, profileId]);

  const updateCurrency = (newCurrency, newRate) => {
    setCurrency(newCurrency);
    setRate(newRate);
  };

  const resetToEur = () => {
    setCurrency("EUR");
    setRate(1);
  };

  const restoreCurrency = (newCurrency, newRate) => {
    setCurrency(newCurrency ?? "EUR");
    setRate(newRate ?? 1);
  };

  const convert = (amount) => {
    if (currency === "EUR") return parseFloat(Number(amount).toFixed(2));
    return parseFloat((Number(amount) / rate).toFixed(2));
  };

  return { currency, rate, updateCurrency, resetToEur, convert, isLoaded, restoreCurrency };
};