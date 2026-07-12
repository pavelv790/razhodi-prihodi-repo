const KEY = "cross_service_switch_expected_until";

// Извиква се преди умишлено превключване между Google Drive и Облака,
// за да не се показва излишно "разкачени сте" съобщение веднага след това.
// Пази се в localStorage (не в паметта), за да оцелее през презареждане
// на страницата при Google OAuth redirect.
export function markExpectedServiceSwitch() {
  localStorage.setItem(KEY, String(Date.now() + 15000));
}

export function isExpectedServiceSwitch() {
  const until = Number(localStorage.getItem(KEY) || 0);
  return Date.now() < until;
}