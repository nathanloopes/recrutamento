import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useGlobalSettings, useUpdateSetting } from "@/hooks/useGlobalSettings";
import { useState, useEffect } from "react";
import { Save } from "lucide-react";

const DASHBOARD_KEYS = [
  { key: "max_hiring_days_alert", label: "Dias máx. para contratação (alerta)", type: "number" },
  { key: "min_conversion_rate", label: "Conversão mínima (%)", type: "number" },
  { key: "rejection_threshold", label: "Limite de standby (%)", type: "number" },
  { key: "snapshot_frequency", label: "Frequência de snapshot", type: "select", options: ["daily", "weekly"], hint: "Governa a execução da Edge Function generate-metrics-snapshot. Se 'daily', gera no máximo 1 snapshot/dia. Se 'weekly', 1 por semana." },
  { key: "ai_diagnostics_enabled", label: "IA diagnóstica ativa", type: "select", options: ["true", "false"] },
  { key: "enable_ai_insights", label: "Insights IA ativados", type: "select", options: ["true", "false"] },
  { key: "cache_ttl", label: "Cache TTL (segundos)", type: "number" },
  { key: "alert_thresholds", label: "Thresholds de alerta (JSON)", type: "text", hint: "JSON com overrides para thresholds individuais. Ex: {\"max_days\":45,\"min_conversion\":15}" },
];

export function DashboardSettingsTab() {
  const { data: settings, isLoading } = useGlobalSettings("dashboard");
  const updateSetting = useUpdateSetting();
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (settings) {
      const v: Record<string, string> = {};
      settings.forEach((s) => {
        v[s.key] = typeof s.value === "string" ? s.value : JSON.stringify(s.value).replace(/"/g, "");
      });
      setValues(v);
    }
  }, [settings]);

  const handleSave = (key: string) => {
    const raw = values[key];
    let parsed: any = raw;
    if (!isNaN(Number(raw)) && raw !== "") parsed = Number(raw);
    else if (raw === "true") parsed = true;
    else if (raw === "false") parsed = false;

    updateSetting.mutate({ category: "dashboard", key, value: parsed });
  };

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Configurações do Dashboard</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {DASHBOARD_KEYS.map((dk) => (
          <div key={dk.key} className="flex items-end gap-3">
            <div className="flex-1 space-y-1">
              <Label>{dk.label}</Label>
              {(dk as any).hint && (
                <p className="text-xs text-amber-600 dark:text-amber-400">{(dk as any).hint}</p>
              )}
              {dk.type === "select" ? (
                <Select value={values[dk.key] || ""} onValueChange={(v) => setValues((prev) => ({ ...prev, [dk.key]: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {dk.options!.map((o) => <SelectItem key={o} value={o}>{o === "true" ? "Sim" : o === "false" ? "Não" : o}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  type={dk.type === "number" ? "number" : "text"}
                  value={values[dk.key] || ""}
                  onChange={(e) => setValues((prev) => ({ ...prev, [dk.key]: e.target.value }))}
                />
              )}
            </div>
            <Button size="sm" onClick={() => handleSave(dk.key)} disabled={updateSetting.isPending}>
              <Save className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
