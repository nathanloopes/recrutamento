import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface AccessLogEntry {
  id: string;
  user_id: string | null;
  event_type: string;
  device_info: string | null;
  ip_address: string | null;
  module_name: string | null;
  success: boolean | null;
  created_at: string | null;
  user_name?: string;
}

export function useAccessLogs(filters?: {
  userId?: string;
  eventType?: string;
  moduleName?: string;
  dateFrom?: string;
  dateTo?: string;
}) {
  return useQuery({
    queryKey: ["access-logs", filters],
    queryFn: async () => {
      let query = supabase
        .from("access_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);

      if (filters?.userId) {
        query = query.eq("user_id", filters.userId);
      }
      if (filters?.eventType) {
        query = query.eq("event_type", filters.eventType);
      }
      if (filters?.moduleName) {
        query = query.eq("module_name", filters.moduleName);
      }
      if (filters?.dateFrom) {
        query = query.gte("created_at", filters.dateFrom);
      }
      if (filters?.dateTo) {
        query = query.lte("created_at", filters.dateTo + "T23:59:59");
      }

      const { data, error } = await query;
      if (error) throw error;

      if (!data || data.length === 0) return [];

      // Resolve user names
      const userIds = [...new Set(data.map((d) => d.user_id).filter(Boolean))] as string[];
      let profileMap = new Map<string, string>();
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", userIds);
        profileMap = new Map(profiles?.map((p) => [p.id, p.full_name]) ?? []);
      }

      return data.map((d) => ({
        ...d,
        user_name: d.user_id ? profileMap.get(d.user_id) ?? "Desconhecido" : "Sistema",
      })) as AccessLogEntry[];
    },
  });
}

// Helper to log access events from client-side
export async function logAccessEvent(params: {
  event_type: string;
  module_name?: string;
  device_info?: string;
  success?: boolean;
}) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const ipAddress: string | null = null;

    await supabase.from("access_logs").insert({
      user_id: user.id,
      event_type: params.event_type,
      module_name: params.module_name || null,
      device_info: params.device_info || navigator.userAgent?.substring(0, 200) || null,
      ip_address: ipAddress,
      success: params.success ?? true,
    });
  } catch {
    // Best-effort logging
  }
}
