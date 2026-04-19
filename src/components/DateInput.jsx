import { useRef, useState } from "react";

const DateInput = ({ value, onChange, className, hasError }) => {
  const dayRef = useRef(null);
  const monthRef = useRef(null);
  const yearRef = useRef(null);
  const [error, setError] = useState("");

  const getParts = (val) => {
    const parts = (val || "").split("/");
    return {
      day: parts[0] || "",
      month: parts[1] || "",
      year: parts[2] || "",
    };
  };

  const { day, month, year } = getParts(value);

  const buildValue = (d, m, y) => `${d}/${m}/${y}`;

  const isLeapYear = (y) => {
    const n = Number(y);
    return (n % 4 === 0 && n % 100 !== 0) || n % 400 === 0;
  };

  const getMaxDay = (m, y) => {
    const mon = Number(m);
    const yr = Number(y);
    if (!mon) return 31;
    if ([4, 6, 9, 11].includes(mon)) return 30;
    if (mon === 2) return isLeapYear(yr) ? 29 : 28;
    return 31;
  };

  const validateAndWarn = (d, m, y) => {
    const dayNum = Number(d);
    const monNum = Number(m);
    const yearNum = Number(y);

    if (!dayNum || !monNum || y.length < 4) {
      setError("");
      return;
    }

    if (monNum > 12) {
      setError("Невалиден месец — максимум 12");
      return;
    }

    const maxDay = getMaxDay(m, y);
    if (dayNum > maxDay) {
      if (monNum === 2) {
        if (dayNum > 29) {
          setError("Февруари има максимум 29 дни");
        } else {
          setError(`${yearNum} не е високосна година — февруари има 28 дни`);
        }
      } else {
        setError(`Този месец има максимум ${maxDay} дни`);
      }
      return;
    }

    setError("");
  };

  const handleDayChange = (e) => {
    let val = e.target.value.replace(/\D/g, "").slice(0, 2);
    if (val === "") {
      setError("");
      onChange(buildValue(val, month, year));
      return;
    }
    const maxDay = getMaxDay(month, year);
    if (Number(val) > maxDay) {
      setError(`Този месец има максимум ${maxDay} дни`);
      val = String(maxDay).padStart(2, "0");
    } else {
      validateAndWarn(val, month, year);
    }
    onChange(buildValue(val, month, year));
    if (val.length === 2) monthRef.current?.focus();
  };

  const handleMonthChange = (e) => {
    let val = e.target.value.replace(/\D/g, "").slice(0, 2);
    if (val === "") {
      setError("");
      onChange(buildValue(day, val, year));
      return;
    }
    if (Number(val) > 12) {
      setError("Невалиден месец — максимум 12");
      val = "12";
    }
    const maxDay = getMaxDay(val, year);
    let newDay = day;
    if (Number(day) > maxDay) {
      newDay = String(maxDay).padStart(2, "0");
      setError(`Денят е коригиран — този месец има максимум ${maxDay} дни`);
    } else {
      validateAndWarn(day, val, year);
    }
    onChange(buildValue(newDay, val, year));
    if (val.length === 2) yearRef.current?.focus();
  };

  const handleYearChange = (e) => {
    let val = e.target.value.replace(/\D/g, "").slice(0, 4);
    const maxDay = getMaxDay(month, val);
    let newDay = day;
    if (Number(day) > maxDay) {
      newDay = String(maxDay).padStart(2, "0");
    }
    onChange(buildValue(newDay, month, val));
    if (val.length === 4) validateAndWarn(newDay, month, val);
    else setError("");
  };

  const handleDayKeyDown = (e) => {
    if (e.key === "ArrowRight") { e.preventDefault(); monthRef.current?.focus(); }
  };

  const handleMonthKeyDown = (e) => {
    if (e.key === "Backspace" && month === "") { e.preventDefault(); dayRef.current?.focus(); }
    if (e.key === "ArrowRight") { e.preventDefault(); yearRef.current?.focus(); }
    if (e.key === "ArrowLeft") { e.preventDefault(); dayRef.current?.focus(); }
  };

  const handleYearKeyDown = (e) => {
    if (e.key === "Backspace" && year === "") { e.preventDefault(); monthRef.current?.focus(); }
    if (e.key === "ArrowLeft") { e.preventDefault(); monthRef.current?.focus(); }
  };

  const baseClass = "text-center bg-transparent outline-none font-medium text-gray-700";

  return (
    <div>
      <div className={`flex items-center border rounded-xl px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-emerald-300 bg-blue-50 w-full ${error || hasError ? "border-red-400" : "border-gray-200"}`}>
        <input
          ref={dayRef}
          type="text"
          inputMode="numeric"
          placeholder="ДД"
          value={day}
          onChange={handleDayChange}
          onKeyDown={handleDayKeyDown}
          onFocus={(e) => e.target.select()}
          maxLength={2}
          className={`${baseClass} w-7`}
        />
        <span className="text-gray-400 mx-0.5">/</span>
        <input
          ref={monthRef}
          type="text"
          inputMode="numeric"
          placeholder="ММ"
          value={month}
          onChange={handleMonthChange}
          onKeyDown={handleMonthKeyDown}
          onFocus={(e) => e.target.select()}
          maxLength={2}
          className={`${baseClass} w-7`}
        />
        <span className="text-gray-400 mx-0.5">/</span>
        <input
          ref={yearRef}
          type="text"
          inputMode="numeric"
          placeholder="ГГГГ"
          value={year}
          onChange={handleYearChange}
          onKeyDown={handleYearKeyDown}
          onFocus={(e) => e.target.select()}
          maxLength={4}
          className={`${baseClass} w-12`}
        />
      </div>
      {error && (
        <p className="text-xs text-red-500 mt-1">{error}</p>
      )}
    </div>
  );
};

export default DateInput;