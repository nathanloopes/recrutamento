import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

const ACTIVITY_EVENTS = ["mousedown", "keydown", "touchstart", "scroll"] as const;
const STORAGE_KEY = "lov.lastActivityAt";
const CHECK_INTERVAL_MS = 60_000; // verifica a cada 1 min
const DEFAULT_TIMEOUT_MIN = 60;

/**
 * Defesa em profundidade no front: força logout local após
 * `security/session_timeout_minutes` de inatividade do usuário.
 * O backend (configGuard.assertSessionFresh) é a fonte de verdade.
 */
export function useSessionTimeout() {
  const { user, signOut } = useAuth();
  const timeoutMinRef = useRef<number>(DEFAULT_TIMEOUT_MIN);

  // Registra timestamp da última interação
  useEffect(() => {
    if (!user) return;
    const touch = () => {
      try {
        localStorage.setItem(STORAGE_KEY, String(Date.now()));
      } catch {
        /* ignore */
      }
    };
    touch();
    ACTIVITY_EVENTS.forEach((ev) => window.addEventListener(ev, touch, { passive: true }));
    return () => {
      ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, touch));
    };
  }, [user]);

  // Lê timeout configurado periodicamente (cache leve via supabase)
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = async () => {
      try {
        const { data } = await supabase
          .from("global_settings")
          .select("value")
          .eq("category", "security")
          .eq("key", "session_timeout_minutes")
          .maybeSingle();
        if (cancelled) return;
        const n = Number(data?.value);
        if (Number.isFinite(n) && n > 0) timeoutMinRef.current = n;
      } catch {
        /* mantém default */
      }
    };
    void load();
    const id = window.setInterval(load, 5 * 60_000); // recarrega a cada 5 min
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [user]);

  // Verifica inatividade
  useEffect(() => {
    if (!user) return;
    const id = window.setInterval(() => {
      const lastStr = localStorage.getItem(STORAGE_KEY);
      const last = lastStr ? Number(lastStr) : Date.now();
      const idleMs = Date.now() - last;
      const limitMs = timeoutMinRef.current * 60 * 1000;
      if (idleMs > limitMs) {
        console.warn(
          `[useSessionTimeout] Sessão expirada por inatividade (${Math.round(idleMs / 60000)}min > ${timeoutMinRef.current}min).`,
        );
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          /* ignore */
        }
        void signOut();
      }
    }, CHECK_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [user, signOut]);
}
