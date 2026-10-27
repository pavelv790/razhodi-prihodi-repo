// Google Drive и Облакът ползват една и съща Supabase сесия: вход през Google (OAuth) = Drive,
// вход с имейл и парола = Облак. Не се гледа `provider_token` — auth-js го дава само веднъж,
// веднага след OAuth, и той изчезва при първото опресняване на сесията (≈1 ч) (одит 2026-10, 3-02).
// `amr` в access token-а казва как е влязла самата сесия и се пази при опресняване.

// Методите за вход от `amr` (["oauth"], ["password"] …) или null, ако token-ът не може да се прочете
function sessionAuthMethods(session) {
  try {
    const part = session.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), "=")));
    return (payload.amr || []).map((a) => (typeof a === "string" ? a : a.method));
  } catch {
    return null;
  }
}

// Сесията е от вход през Google (връзка с Google Drive), а не с имейл (Облак)
export function isGoogleSession(session) {
  if (!session?.user) return false;
  if (session.provider_token) return true;
  const methods = sessionAuthMethods(session);
  if (methods) return methods.includes("oauth");
  return session.user.app_metadata?.provider === "google";
}
