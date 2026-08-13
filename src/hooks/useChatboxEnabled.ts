import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Reads the global flag `chatbox.chatbox_enabled` (admin-controlled).
 * Default: true (fail-safe — if the read fails we keep chatbox on).
 */
export function useChatboxEnabled() {
  const query = useQuery({
    queryKey: ["global_settings", "chatbox", "chatbox_enabled"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("global_settings")
        .select("value")
        .eq("category", "chatbox")
        .eq("key", "chatbox_enabled")
        .maybeSingle();
      if (error) throw error;
      if (data?.value === null || data?.value === undefined) return true;
      if (typeof data.value === "boolean") return data.value;
      if (typeof data.value === "string") return data.value !== "false";
      return Boolean(data.value);
    },
    staleTime: 60_000,
  });

  return {
    enabled: query.data ?? true,
    isLoading: query.isLoading,
  };
}
