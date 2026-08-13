import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { humanizeError } from "@/lib/userMessages";

export interface AutomationRule {
  id: string;
  event_name: string;
  condition_json: Record<string, any>;
  action_type: string;
  action_payload: Record<string, any>;
  priority: number;
  is_active: boolean;
  description: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AutomationLog {
  id: string;
  rule_id: string | null;
  event_name: string;
  action_type: string;
  action_result: string;
  error_message: string | null;
  execution_time_ms: number | null;
  context: Record<string, any>;
  executed_at: string;
}

export function useAutomationRules() {
  return useQuery({
    queryKey: ["automation_rules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("automation_rules" as any)
        .select("*")
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as AutomationRule[];
    },
  });
}

export function useAutomationLogs(ruleId?: string) {
  return useQuery({
    queryKey: ["automation_logs", ruleId],
    queryFn: async () => {
      let query = supabase
        .from("automation_logs" as any)
        .select("*")
        .order("executed_at", { ascending: false })
        .limit(200);
      if (ruleId) query = query.eq("rule_id", ruleId);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as AutomationLog[];
    },
  });
}

export function useCreateAutomationRule() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (rule: Omit<AutomationRule, "id" | "created_at" | "updated_at" | "created_by">) => {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("automation_rules" as any)
        .insert({ ...rule, created_by: userData.user?.id } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["automation_rules"] });
      toast({ title: "Regra criada", description: "Automação adicionada com sucesso." });
    },
    onError: (e: any) => toast({ title: "Não foi possível concluir", description: humanizeError(e, "automation_rules"), variant: "destructive" }),
  });
}

export function useUpdateAutomationRule() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<AutomationRule> & { id: string }) => {
      // Get old values for audit
      const { data: oldRule } = await supabase
        .from("automation_rules" as any)
        .select("*")
        .eq("id", id)
        .maybeSingle();
      const oldData = oldRule as any;

      const { error } = await supabase
        .from("automation_rules" as any)
        .update(updates as any)
        .eq("id", id);
      if (error) throw error;

      // Unified audit in config_audit_logs
      const { data: userData } = await supabase.auth.getUser();
      await supabase.from("config_audit_logs" as any).insert({
        category: "automations",
        key: oldData?.event_name || id,
        old_value: oldData ? { is_active: oldData.is_active, action_type: oldData.action_type, priority: oldData.priority } : null,
        new_value: updates,
        changed_by: userData.user?.id,
        entity_type: "automation",
        environment: "production",
      } as any);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["automation_rules"] });
      toast({ title: "Regra atualizada" });
    },
    onError: (e: any) => toast({ title: "Não foi possível concluir", description: humanizeError(e, "automation_rules"), variant: "destructive" }),
  });
}

export function useToggleAutomationRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, is_active, event_name }: { id: string; is_active: boolean; event_name?: string }) => {
      const { error } = await supabase
        .from("automation_rules" as any)
        .update({ is_active } as any)
        .eq("id", id);
      if (error) throw error;

      // Unified audit in config_audit_logs
      const { data: userData } = await supabase.auth.getUser();
      await supabase.from("config_audit_logs" as any).insert({
        category: "automations",
        key: event_name || id,
        old_value: { is_active: !is_active },
        new_value: { is_active },
        changed_by: userData.user?.id,
        entity_type: "automation",
        environment: "production",
      } as any);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["automation_rules"] }),
  });
}

export function useDeleteAutomationRule() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("automation_rules" as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["automation_rules"] });
      toast({ title: "Regra removida" });
    },
    onError: (e: any) => toast({ title: "Não foi possível concluir", description: humanizeError(e, "automation_rules"), variant: "destructive" }),
  });
}
