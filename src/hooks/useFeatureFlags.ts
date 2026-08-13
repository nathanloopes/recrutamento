import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { humanizeError } from "@/lib/userMessages";

export interface FeatureFlag {
  id: string;
  module_name: string;
  environment: string;
  enabled: boolean;
  rollout_strategy: string;
  rollout_config: any;
  description: string | null;
  activated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ModuleActivationLog {
  id: string;
  module_name: string;
  previous_status: boolean | null;
  new_status: boolean;
  changed_by: string | null;
  environment: string;
  metadata: any;
  changed_at: string;
}

export function useFeatureFlags(environment?: string) {
  return useQuery({
    queryKey: ["feature_flags", environment],
    queryFn: async () => {
      let query = supabase.from("feature_flags" as any).select("*");
      if (environment) query = query.eq("environment", environment);
      const { data, error } = await query.order("module_name");
      if (error) throw error;
      return (data || []) as unknown as FeatureFlag[];
    },
  });
}

export function useToggleFeatureFlag() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      id,
      module_name,
      environment,
      currentStatus,
      newStatus,
    }: {
      id: string;
      module_name: string;
      environment: string;
      currentStatus: boolean;
      newStatus: boolean;
    }) => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;

      // Update the flag
      const updatePayload: any = { enabled: newStatus, activated_by: userId };
      if (newStatus) updatePayload.activated_at = new Date().toISOString();
      const { error } = await supabase
        .from("feature_flags" as any)
        .update(updatePayload)
        .eq("id", id);
      if (error) throw error;

      // Insert activation log
      const { error: logError } = await supabase
        .from("module_activation_logs" as any)
        .insert({
          module_name,
          previous_status: currentStatus,
          new_status: newStatus,
          changed_by: userId,
          environment,
          metadata: { toggled_at: new Date().toISOString() },
        } as any);
      if (logError) console.error("Log insert error:", logError);

      // Pause/resume automation_rules linked to this module
      if (environment === "production") {
        if (!newStatus) {
          // Desativando: pausar automações vinculadas
          await supabase
            .from("automation_rules")
            .update({ is_active: false } as any)
            .ilike("event_name", `%${module_name}%`);
        } else {
          // Ativando: reativar automações vinculadas
          await supabase
            .from("automation_rules")
            .update({ is_active: true } as any)
            .ilike("event_name", `%${module_name}%`);
        }
      }

      // Unified audit in config_audit_logs
      await supabase.from("config_audit_logs" as any).insert({
        category: "feature_flags",
        key: module_name,
        old_value: currentStatus,
        new_value: newStatus,
        changed_by: userId,
        entity_type: "feature_flag",
        environment,
      } as any);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["feature_flags"] });
      toast({ title: "Módulo atualizado", description: "Status alterado com sucesso." });
    },
    onError: (error: any) => {
      toast({
        title: "Não foi possível atualizar",
        description: humanizeError(error, "useToggleFeatureFlag"),
        variant: "destructive",
      });
    },
  });
}

export function useUpdateFeatureFlag() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      id,
      rollout_strategy,
      rollout_config,
    }: {
      id: string;
      rollout_strategy: string;
      rollout_config: any;
    }) => {
      // Enforce allow_gradual_rollout CrossConfig
      if (rollout_strategy !== "total") {
        const { data: gradualSetting } = await supabase
          .from("global_settings")
          .select("value")
          .eq("category", "feature_control")
          .eq("key", "allow_gradual_rollout")
          .maybeSingle();
        
        const allowed = gradualSetting?.value === true || gradualSetting?.value === "true";
        if (!allowed) {
          throw new Error("Rollout gradual está desabilitado nas configurações globais (allow_gradual_rollout = false).");
        }
      }

      const { error } = await supabase
        .from("feature_flags" as any)
        .update({ rollout_strategy, rollout_config } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["feature_flags"] });
      toast({ title: "Rollout atualizado", description: "Estratégia de rollout salva." });
    },
    onError: (error: any) => {
      toast({
        title: "Não foi possível salvar",
        description: humanizeError(error, "useUpdateFeatureFlag"),
        variant: "destructive",
      });
    },
  });
}

export function useFeatureActivationLogs(moduleName?: string) {
  return useQuery({
    queryKey: ["module_activation_logs", moduleName],
    queryFn: async () => {
      let query = supabase
        .from("module_activation_logs" as any)
        .select("*")
        .order("changed_at", { ascending: false })
        .limit(100);
      if (moduleName) query = query.eq("module_name", moduleName);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as unknown as ModuleActivationLog[];
    },
  });
}

export function useIsFeatureEnabled(moduleName: string, environment = "production") {
  const { data: flags } = useFeatureFlags(environment);
  const flag = flags?.find((f) => f.module_name === moduleName);
  return flag?.enabled ?? false;
}

/**
 * Returns list of active module names for production,
 * or all modules if feature_control is disabled.
 */
export function useActiveModules() {
  const { data: flags } = useFeatureFlags("production");
  const { data: controlSettings } = useQuery({
    queryKey: ["global_settings", "feature_control"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("global_settings")
        .select("*")
        .eq("category", "feature_control");
      if (error) throw error;
      return data || [];
    },
  });

  const featureControlEnabled = (() => {
    const s = controlSettings?.find((s: any) => s.key === "feature_control_enabled");
    return s?.value === true || s?.value === "true";
  })();

  const activeModules: string[] = (() => {
    if (!featureControlEnabled || !flags) return [];
    return flags.filter((f) => f.enabled).map((f) => f.module_name);
  })();

  return { activeModules, featureControlEnabled };
}
