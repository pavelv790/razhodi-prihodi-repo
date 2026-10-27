import { supabase } from "./supabase";

export async function signUpWithEmail(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw new Error(error.message);
  return data;
}

export async function signInWithEmail(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return data;
}

// Изход само от това устройство: по подразбиране auth-js излиза от всички устройства на акаунта
// (одит 2026-10, 3-11). При грешка (напр. няма връзка) auth-js не изтрива сесията — затова
// хвърля: потребителят остава вписан и трябва да опита отново.
export async function signOutFromSupabase() {
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) {
    console.error(error);
    throw new Error(/failed to fetch|networkerror|load failed/i.test(error.message || "")
      ? "няма връзка с интернет."
      : "сървърът не отговори както трябва.");
  }
}

export async function getCurrentSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}
export async function resetPassword(email) {
  if (!email || !email.includes("@")) throw new Error("missing email or phone");
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
  });
  if (error) throw new Error(error.message);
}