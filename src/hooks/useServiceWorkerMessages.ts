import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { isNativeApp } from "@/lib/isNativeApp";

/**
 * Listens to messages from the Service Worker (e.g. when a Web Push arrives
 * or the user clicks a system notification). On `PUSH_RECEIVED`, invalidates
 * notification caches. On `NOTIFICATION_CLICK`, marks that notification as
 * read so the badge clears immediately.
 */
export function useServiceWorkerMessages() {
  const qc = useQueryClient();
  const { user } = useAuth();

  useEffect(() => {
    if (isNativeApp()) return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (!user?.id) return;

    const invalidate = () => {
      qc.invalidateQueries({ queryKey: ["my_notifications", user.id] });
      qc.invalidateQueries({ queryKey: ["unread_count", user.id] });
      qc.invalidateQueries({ queryKey: ["module_badges", user.id] });
    };

    const handler = async (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;

      if (data.type === "PUSH_RECEIVED") {
        invalidate();
        return;
      }

      if (data.type === "NOTIFICATION_CLICK") {
        const notificationId = data.notification_id;
        if (notificationId) {
          try {
            await supabase
              .from("notifications" as any)
              .update({ read_at: new Date().toISOString(), status: "read" } as any)
              .eq("id", notificationId)
              .eq("recipient_id", user.id)
              .is("read_at", null);
          } catch {
            // ignore
          }
        }
        invalidate();
      }
    };

    navigator.serviceWorker.addEventListener("message", handler);
    return () => {
      navigator.serviceWorker.removeEventListener("message", handler);
    };
  }, [qc, user?.id]);
}
