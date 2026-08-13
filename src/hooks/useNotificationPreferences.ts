import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function useNotificationPreferences() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["notification_preferences", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notification_preferences" as any)
        .select("*")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown) as { id: string; user_id: string; preferred_channel: string; event_overrides: Record<string, string> } | null;
    },
  });
}

export function useUpdateNotificationPreferences() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vals: { preferred_channel: string; event_overrides?: Record<string, string> }) => {
      // Upsert
      const { error } = await supabase
        .from("notification_preferences" as any)
        .upsert({
          user_id: user!.id,
          preferred_channel: vals.preferred_channel,
          event_overrides: vals.event_overrides || {},
        } as any, { onConflict: "user_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notification_preferences", user?.id] });
    },
  });
}

// Fetch a recipient's preferred channel (used by the notification engine)
export async function fetchRecipientPreferredChannel(recipientId: string): Promise<string | null> {
  const { data } = await supabase
    .from("notification_preferences" as any)
    .select("preferred_channel")
    .eq("user_id", recipientId)
    .maybeSingle();
  return (data as any)?.preferred_channel || null;
}
