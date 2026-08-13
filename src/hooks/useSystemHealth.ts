import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { safeToast } from "@/lib/safeToast";

export type ConfigHealthReport = {
  id: string;
  scanned_at: string;
  total_keys: number;
  healthy_count: number;
  warning_count: number;
  critical_count: number;
  orphan_keys: Array<{ category: string; key: string }>;
  unregistered_keys: Array<{ category: string; key: string }>;
  duplicates: Array<{ key: string; count: number }>;
  details: { type_mismatches?: Array<{ category: string; key: string; expected: string; got: string }> };
  triggered_by: string;
};

export type ConfigKeyEntry = {
  category: string;
  key: string;
  description: string | null;
  consumer_type: string;
  expected_type: string;
  status: "active" | "planned" | "deprecated";
};

export function useLatestHealthReport() {
  return useQuery({
    queryKey: ["config-health", "latest"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("config_health_reports")
        .select("*")
        .order("scanned_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown) as ConfigHealthReport | null;
    },
    refetchOnWindowFocus: false,
  });
}

export function useHealthReportHistory(limit = 30) {
  return useQuery({
    queryKey: ["config-health", "history", limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("config_health_reports")
        .select("id, scanned_at, healthy_count, warning_count, critical_count, total_keys, triggered_by")
        .order("scanned_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data ?? [];
    },
    refetchOnWindowFocus: false,
  });
}

export function useConfigRegistry() {
  return useQuery({
    queryKey: ["config-key-registry"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("config_key_registry")
        .select("*")
        .order("category")
        .order("key");
      if (error) throw error;
      return (data ?? []) as ConfigKeyEntry[];
    },
    refetchOnWindowFocus: false,
  });
}

export function useRunHealthScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("config-health-scan", {
        body: { triggered_by: "manual" },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      safeToast.success("Verificação concluída", {
        description: "O painel foi atualizado com o resultado mais recente.",
      });
      qc.invalidateQueries({ queryKey: ["config-health"] });
    },
    onError: (err) => {
      safeToast.error(err);
    },
  });
}

export function useE2ERunLogs(limit = 20) {
  return useQuery({
    queryKey: ["e2e-run-logs", limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("e2e_run_logs")
        .select("*")
        .order("run_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data ?? [];
    },
    refetchOnWindowFocus: false,
  });
}

export function useRunE2ESmoke() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("e2e-candidate-smoke", {
        body: {},
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      if (data?.ok) {
        safeToast.success("Fluxo do candidato validado", {
          description: `${data.passed ?? 0} etapas executadas com sucesso.`,
        });
      } else {
        safeToast.warning("Validação concluída com falhas", {
          description: data?.error ?? "Confira o histórico para detalhes.",
        });
      }
      qc.invalidateQueries({ queryKey: ["e2e-run-logs"] });
    },
    onError: (err) => safeToast.error(err),
  });
}
