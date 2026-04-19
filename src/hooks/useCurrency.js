import { useState, useEffect } from "react";
import { openDB } from "../utils/db";

const STORE = "currency";


const load = async () => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get("current");
      req.onsuccess = () => resolve(req.result || { id: "current", currency: "EUR", rate: 1 });
      req.onerror = () => reject(req.error);
    });
  } catch { return { id: "current", currency: "EUR", rate: 1 }; }
};

const save = async (data) => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(data);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch { console.error("Грешка при запис на валута"); }
};

export const useCurrency = () => {
  const [currency, setCurrency] = useState("EUR");
  const [rate, setRate] = useState(1);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    load().then((data) => {
      setCurrency(data.currency);
      setRate(data.rate);
      setIsLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (isLoaded) {
      save({ id: "current", currency, rate });
    }
  }, [currency, rate, isLoaded]);

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