import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useGlobalSettings, useUpdateSetting } from "@/hooks/useGlobalSettings";
import { useState, useEffect } from "react";
import { Save } from "lucide-react";

const MIGRATION_KEYS = [
  { key: "auto_migrate_enabled", label: "Migração automática ativa", type: "select", options: ["true", "false"] },
  { key: "onboarding_required", label: "Onboarding obrigatório", type: "select", options: ["true", "false"] },
  { key: "invite_expiration_hours", label: "Validade do convite (horas)", type: "number" },
  { key: "reminder_interval", label: "Intervalo de lembretes (horas)", type: "number" },
  { key: "onboarding_abandonment_days", label: "Dias para alerta de abandono", type: "number" },
  { key: "allowed_roles", label: "Papéis permitidos (JSON array)", type: "text" },
];

export function MigrationSettingsTab() {
  const { data: settings, isLoading } = useGlobalSettings("migration");
  const updateSetting = useUpdateSetting();
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (settings) {
      const v: Record<string, string> = {};
      settings.forEach((s) => {
        v[s.key] = typeof s.value === "string" ? s.value : JSON.stringify(s.value);
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
    else {
      try { parsed = JSON.parse(raw); } catch { /* keep as string */ }
    }
    updateSetting.mutate({ category: "migration", key, value: parsed });
  };

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Configurações de Migração para ERP</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {MIGRATION_KEYS.map((mk) => (
          <div key={mk.key} className="flex items-end gap-3">
            <div className="flex-1 space-y-1">
              <Label>{mk.label}</Label>
              {mk.type === "select" ? (
                <Select value={values[mk.key] || ""} onValueChange={(v) => setValues((prev) => ({ ...prev, [mk.key]: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {mk.options!.map((o) => <SelectItem key={o} value={o}>{o === "true" ? "Sim" : o === "false" ? "Não" : o}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  type={mk.type === "number" ? "number" : "text"}
                  value={values[mk.key] || ""}
                  onChange={(e) => setValues((prev) => ({ ...prev, [mk.key]: e.target.value }))}
                />
              )}
            </div>
            <Button size="sm" onClick={() => handleSave(mk.key)} disabled={updateSetting.isPending}>
              <Save className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
