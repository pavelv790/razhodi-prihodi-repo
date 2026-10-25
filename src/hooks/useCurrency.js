import { useState, useEffect, useRef } from "react";
import { runTx, reportDBError } from "../utils/db";

const STORE = "currency";


// При грешка отхвърля: EUR по подразбиране не бива да се запише върху реалната валута (одит 2026-10, 1А-04)
const load = async (profileId) =>
  (await runTx(STORE, "readonly", (store) => store.get(profileId))) || { id: profileId, currency: "EUR", rate: 1 };

// Невалидна валута или курс (повреден запис/копие: липсва, 0, отрицателен, текст) → EUR с курс 1,
// вместо суми NaN/∞ при convert (одит 2026-10, 1А-11). Курс-число като низ („1.95“) се приема.
const validCurrency = (currency, rate) => {
  if (currency === "EUR") return { currency, rate: 1 };
  const r = typeof rate === "string" ? Number(rate) : rate;
  if (typeof currency === "string" && currency && Number.isFinite(r) && r > 0) return { currency, rate: r };
  return { currency: "EUR", rate: 1 };
};

const save = async (profileId, data) => {
  try {
    await runTx(STORE, "readwrite", (store) => store.put({ id: profileId, ...data }));
    return true;
  } catch (err) { reportDBError(); console.error("Грешка при запис на валута", err); return false; }
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
      const valid = validCurrency(data.currency, data.rate);
      setCurrency(valid.currency);
      setRate(valid.rate);
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

  // Записва директно и връща true/false, за да спре възстановяването при провал,
  // вместо записът да остане за ефекта (одит 2026-10, 2А-01)
  const restoreCurrency = async (newCurrency, newRate) => {
    const valid = validCurrency(newCurrency ?? "EUR", newRate ?? 1);
    const ok = await save(profileId, valid);
    if (ok) {
      setCurrency(valid.currency);
      setRate(valid.rate);
    }
    return ok;
  };

  const convert = (amount) => {
    if (currency === "EUR") return parseFloat(Number(amount).toFixed(2));
    return parseFloat((Number(amount) / rate).toFixed(2));
  };

  return { currency, rate, updateCurrency, resetToEur, convert, isLoaded, restoreCurrency };
};