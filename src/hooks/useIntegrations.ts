import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface IntegrationSetting {
  id: string;
  integration_type: string;
  provider: string;
  config_json: Record<string, any>;
  is_active: boolean;
  status: string;
  last_health_check: string | null;
  updated_by: string | null;
  updated_at: string;
  created_at: string;
}

export interface IntegrationLog {
  id: string;
  integration_id: string | null;
  event: string;
  actor_id: string | null;
  success: boolean;
  context: Record<string, any>;
  created_at: string;
}

export function useIntegrationSettings() {
  return useQuery({
    queryKey: ["integration_settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("integration_settings")
        .select("*")
        .order("integration_type", { ascending: true });
      if (error) throw error;
      return (data || []).slice().sort((a: any, b: any) =>
        String(a.integration_type || "").toLowerCase().localeCompare(String(b.integration_type || "").toLowerCase(), "pt-BR")
      ) as IntegrationSetting[];
    },
  });
}

export function useIntegrationLogs(integrationId?: string) {
  return useQuery({
    queryKey: ["integration_logs", integrationId],
    queryFn: async () => {
      let query = supabase
        .from("integration_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (integrationId) {
        query = query.eq("integration_id", integrationId);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data as IntegrationLog[];
    },
  });
}

export function useUpdateIntegrationConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      config_json,
      is_active,
    }: {
      id: string;
      config_json?: Record<string, any>;
      is_active?: boolean;
    }) => {
      const updates: Record<string, any> = {};
      if (config_json !== undefined) updates.config_json = config_json;
      if (is_active !== undefined) updates.is_active = is_active;
      const { error } = await supabase
        .from("integration_settings")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integration_settings"] });
      toast.success("Configuração atualizada");
    },
    onError: (err: any) => toast.error(err.message),
  });
}

export function useTestIntegration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      provider,
      payload,
      integrationId,
    }: {
      provider: string;
      payload?: any;
      integrationId?: string;
    }) => {
      const { data, error } = await supabase.functions.invoke("test-integrations", {
        body: { provider, payload, integration_id: integrationId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data) => {
      queryClient.invalidateQueries({ queryKey: ["integration_settings"] });
      queryClient.invalidateQueries({ queryKey: ["integration_logs"] });
    },
  });
}
