import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const KEY_PREFIX = "ai_consent_v1:";

export function useAIConsent(applicationId?: string) {
  const storageKey = applicationId ? `${KEY_PREFIX}${applicationId}` : null;
  const [hasConsent, setHasConsent] = useState<boolean>(() => {
    if (!storageKey || typeof window === "undefined") return false;
    return window.localStorage.getItem(storageKey) === "1";
  });

  useEffect(() => {
    if (!storageKey || typeof window === "undefined") {
      setHasConsent(false);
      return;
    }
    setHasConsent(window.localStorage.getItem(storageKey) === "1");
  }, [storageKey]);

  const grantConsent = useCallback(async () => {
    if (!storageKey || !applicationId) return;
    try {
      window.localStorage.setItem(storageKey, "1");
    } catch (e) {
      console.warn("[useAIConsent] localStorage error:", e);
    }
    setHasConsent(true);
    // best-effort audit
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("audit_trail").insert({
          actor_id: user.id,
          action: "ai_consent_granted",
          target_type: "application",
          target_id: applicationId,
          context: { provider: "OpenAI" } as any,
        } as any);
      }
    } catch (e) {
      console.warn("[useAIConsent] audit insert failed:", e);
    }
  }, [storageKey, applicationId]);

  return { hasConsent, grantConsent };
}
