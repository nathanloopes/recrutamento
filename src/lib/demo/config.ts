// Modo demonstração (portfólio). Quando ativo, o app usa um cliente Supabase
// fictício em memória (src/lib/demo) — nenhum backend é necessário.
//
// Como ativar:
//  - Variável de ambiente: VITE_DEMO_MODE=true (arquivo .env)
//  - Ou via URL: adicione ?demo=1 (persiste em localStorage). ?demo=0 desliga.

function detectDemoMode(): boolean {
  const env = (import.meta as any)?.env ?? {};
  if (env.VITE_DEMO_MODE === "true") return true;
  if (env.VITE_DEMO_MODE === "false") return false;

  // Sem backend Supabase configurado (URL ausente ou placeholder) → modo demo.
  const url = String(env.VITE_SUPABASE_URL ?? "").trim();
  const noBackend = !url || url.includes("YOUR_PROJECT");

  try {
    if (typeof window === "undefined") return noBackend;
    const search = new URL(window.location.href);
    const param = search.searchParams.get("demo");
    if (param === "1") window.localStorage.setItem("demo_mode", "true");
    if (param === "0") window.localStorage.removeItem("demo_mode");
    if (window.localStorage.getItem("demo_mode") === "true") return true;
    return noBackend;
  } catch {
    return noBackend;
  }
}

export const DEMO_MODE: boolean = detectDemoMode();

export type DemoRole = "candidate" | "admin";

const DEMO_ROLE_KEY = "demo.role";

export function getDemoRole(): DemoRole {
  try {
    return window.localStorage.getItem(DEMO_ROLE_KEY) === "admin" ? "admin" : "candidate";
  } catch {
    return "candidate";
  }
}

export function setDemoRole(role: DemoRole): void {
  try {
    window.localStorage.setItem(DEMO_ROLE_KEY, role);
  } catch {
    /* ignore */
  }
}
