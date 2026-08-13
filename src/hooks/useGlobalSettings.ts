import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { SETTINGS_MESSAGES, humanizeError } from "@/lib/userMessages";

export interface GlobalSetting {
  id: string;
  category: string;
  key: string;
  value: any;
  updated_by: string | null;
  updated_at: string;
}

export interface ConfigAuditLog {
  id: string;
  setting_id: string | null;
  category: string | null;
  key: string | null;
  old_value: any;
  new_value: any;
  changed_by: string | null;
  changed_at: string;
  reason: string | null;
}

export function useGlobalSettings(category?: string) {
  return useQuery({
    queryKey: ["global_settings", category],
    queryFn: async () => {
      let query = supabase.from("global_settings").select("*");
      if (category) query = query.eq("category", category);
      const { data, error } = await query.order("category", { ascending: true }).order("key", { ascending: true });
      if (error) throw error;
      return data as GlobalSetting[];
    },
  });
}

export function useUpdateSetting() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      category,
      key,
      value,
      reason,
    }: {
      category: string;
      key: string;
      value: any;
      reason?: string;
    }) => {
      const { data: auditSettings } = await supabase
        .from("global_settings")
        .select("value")
        .eq("category", "audit")
        .eq("key", "require_justification")
        .maybeSingle();

      let normalizedReason = reason?.trim();

      if (auditSettings?.value === true && !normalizedReason) {
        if (typeof window !== "undefined") {
          const promptedReason = window.prompt("Justificativa obrigatória está ativa. Informe o motivo da alteração:", "");
          normalizedReason = promptedReason?.trim();
        }

        if (!normalizedReason) {
          throw new Error("Justificativa obrigatória está ativa. Informe o motivo da alteração.");
        }
      }

      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;

      const { data: upsertedSetting, error } = await supabase
        .from("global_settings")
        .upsert(
          {
            category,
            key,
            value,
            updated_by: userId,
            updated_at: new Date().toISOString(),
            _audit_reason: normalizedReason || null,
          } as any,
          { onConflict: "category,key" }
        )
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!upsertedSetting) throw new Error("Falha ao salvar configuração.");
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["global_settings", variables.category] });
      queryClient.invalidateQueries({ queryKey: ["global_settings"] });
      queryClient.invalidateQueries({ queryKey: ["config_audit_logs"] });
      toast({ ...SETTINGS_MESSAGES.saveSuccess });

      // Audit log
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (!user) return;
        supabase.from("activity_logs").insert({
          user_id: user.id,
          action: "config_alterada",
          module: "configuracao",
          details: { category: variables.category, key: variables.key },
        } as any).then(({ error }) => {
          if (error) console.error("[AuditLog] config change log failed:", error.message);
        });
      });
    },
    onError: (error: any) => {
      toast({
        title: SETTINGS_MESSAGES.saveError.title,
        description: humanizeError(error, "useUpdateSetting"),
        variant: "destructive",
      });
    },
  });
}

export function useConfigAuditLogs() {
  return useQuery({
    queryKey: ["config_audit_logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("config_audit_logs")
        .select("*")
        .order("changed_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as ConfigAuditLog[];
    },
  });
}
