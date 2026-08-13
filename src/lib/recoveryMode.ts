/**
 * Recovery Mode Flags
 *
 * Duas flags em camadas:
 *
 * 1) `auth.password_recovery_active` (sessionStorage) — vive somente na aba.
 *    Sinaliza que ESTA aba está ativamente no fluxo de redefinição de senha.
 *    Usada para evitar que outras abas (já logadas no mesmo navegador) sejam
 *    deslogadas indevidamente.
 *
 * 2) `auth.recovery_pending` (localStorage) — selo persistente de "ciclo de
 *    recuperação não finalizado". Sobrevive a reload, fechamento de aba e
 *    navegação dura. Só é limpa em DOIS eventos:
 *      a) login real bem-sucedido com CPF+senha em Login.tsx;
 *      b) o usuário clicar explicitamente em "Voltar ao login" / "Solicitar
 *         novo link" APÓS o hardPurge ter confirmado sessão nula.
 *
 * Enquanto QUALQUER uma estiver ativa:
 *  - PublicRoute NÃO redireciona para área autenticada.
 *  - AuthContext NÃO promove sessão a `user` real (sem loadProfile, sem
 *    access_log, sem register-web-session).
 *  - Eventos SIGNED_IN do Supabase são tratados como sessão temporária.
 */

const SESSION_KEY = "auth.password_recovery_active";
const PENDING_KEY = "auth.recovery_pending";

// ---------- aba (sessionStorage) ----------
export function setRecoveryMode() {
  try { sessionStorage.setItem(SESSION_KEY, "1"); } catch { /* noop */ }
}
export function clearRecoveryMode() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* noop */ }
}
export function isRecoveryMode(): boolean {
  try { return sessionStorage.getItem(SESSION_KEY) === "1"; } catch { return false; }
}

// ---------- persistente (localStorage) ----------
export function setRecoveryPending() {
  try { localStorage.setItem(PENDING_KEY, "1"); } catch { /* noop */ }
}
export function clearRecoveryPending() {
  try { localStorage.removeItem(PENDING_KEY); } catch { /* noop */ }
}
export function isRecoveryPending(): boolean {
  try { return localStorage.getItem(PENDING_KEY) === "1"; } catch { return false; }
}

/**
 * Limpa AMBAS as flags. Use somente após confirmar que a sessão Supabase
 * foi efetivamente derrubada (hardPurge) ou após login real com CPF+senha.
 */
export function clearAllRecoveryFlags() {
  clearRecoveryMode();
  clearRecoveryPending();
}
