import { useState, useEffect, useRef } from "react";
import { runTx, reportDBError } from "../utils/db";

const STORE = "currency";


// При грешка отхвърля: EUR по подразбиране не бива да се запише върху реалната валута (одит 2026-10, 1А-04)
const load = async (profileId) =>
  (await runTx(STORE, "readonly", (store) => store.get(profileId))) || { id: profileId, currency: "EUR", rate: 1 };

const save = async (profileId, data) => {
  try {
    await runTx(STORE, "readwrite", (store) => store.put({ id: profileId, ...data }));
  } catch (err) { reportDBError(); console.error("Грешка при запис на валута", err); }
};

// При грешка отхвърля, за да спре изтриването на профила
export const deleteProfileCurrency = async (profileId) => {
  try {
    await runTx(STORE, "readwrite", (store) => store.delete(profileId));
  } catch (err) {
    reportDBError();
    console.error("Грешка при изтриване на валута на профил", err);
    throw err;
  }
};

export const useCurrency = (profileId) => {
  const [currency, setCurrency] = useState("EUR");
  const [rate, setRate] = useState(1);
  const [isLoaded, setIsLoaded] = useState(false);
  const loadedForProfileRef = useRef(null);

  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    setIsLoaded(false);
    setCurrency("EUR");
    setRate(1);
    loadedForProfileRef.current = null;
    load(profileId).then((data) => {
      if (cancelled) return;
      setCurrency(data.currency);
      setRate(data.rate);
      loadedForProfileRef.current = profileId;
      setIsLoaded(true);
    }).catch((err) => {
      if (cancelled) return;
      // isLoaded остава false: нищо не се записва
      reportDBError();
      console.error("Грешка при зареждане на валута от IndexedDB", err);
    });
    return () => { cancelled = true; };
  }, [profileId]);

  useEffect(() => {
    if (isLoaded && profileId && loadedForProfileRef.current === profileId) {
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