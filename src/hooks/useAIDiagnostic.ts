import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { UnitMetrics } from "@/hooks/useUnitMonitoring";

export interface AIDiagnosticResult {
  unitId: string;
  unitName: string;
  diagnosis: string;
  suggestions: string[];
  riskLevel: "low" | "medium" | "high";
}

export function useAIDiagnostic() {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<AIDiagnosticResult[]>([]);
  const { toast } = useToast();

  const runDiagnostic = async (units: UnitMetrics[]) => {
    setLoading(true);
    try {
      const unitsWithIssues = units.filter((u) => u.alerts.length > 0 || u.rejectionRate > 40 || u.withdrawalRate > 25 || u.stalledJobs > 0);

      if (!unitsWithIssues.length) {
        setResults([]);
        toast({ title: "IA Diagnóstico", description: "Nenhuma unidade com gargalos detectados." });
        setLoading(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke("diagnose-units", {
        body: {
          units: unitsWithIssues.map((u) => ({
            id: u.id,
            name: u.name,
            openJobs: u.openJobs,
            totalCandidates: u.totalCandidates,
            hired: u.hired,
            rejected: u.rejected,
            withdrawn: u.withdrawn,
            conversionRate: u.conversionRate,
            rejectionRate: u.rejectionRate,
            withdrawalRate: u.withdrawalRate,
            avgScore: u.avgScore,
            stalledJobs: u.stalledJobs,
            alerts: u.alerts,
          })),
        },
      });

      if (error) throw error;

      setResults(data?.diagnostics || []);

      // Audit log
      await supabase.from("activity_logs").insert({
        action: "ai_diagnostic_run",
        module: "monitoramento",
        details: { units_analyzed: unitsWithIssues.length, results_count: data?.diagnostics?.length || 0 },
      } as any);

      toast({ title: "Diagnóstico concluído", description: `${data?.diagnostics?.length || 0} unidade(s) analisada(s).` });
    } catch (err: any) {
      toast({ title: "Erro no diagnóstico", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return { runDiagnostic, results, loading };
}
