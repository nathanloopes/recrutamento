import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useGlobalSettings, useUpdateSetting } from "@/hooks/useGlobalSettings";
import { useState, useEffect } from "react";
import { Save } from "lucide-react";

const TALENT_POOL_KEYS = [
  { key: "auto_invite_enabled", label: "Convite automático ativo", type: "select", options: ["true", "false"] },
  { key: "min_score_for_invite", label: "Score mínimo para convite", type: "number" },
  { key: "invite_radius_km", label: "Raio de convite (km)", type: "number" },
  { key: "max_active_processes", label: "Máx. processos ativos simultâneos", type: "number" },
  { key: "allow_reinvite", label: "Permitir reconvite", type: "select", options: ["true", "false"] },
  { key: "opt_out_respect", label: "Respeitar opt-out do candidato", type: "select", options: ["true", "false"] },
  { key: "standby_visibility", label: "Visibilidade do standby", type: "select", options: ["unit", "regional", "global"] },
];

export function TalentPoolSettingsTab() {
  const { data: settings, isLoading } = useGlobalSettings("talent_pool");
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

    updateSetting.mutate({ category: "talent_pool", key, value: parsed });
  };

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Banco de Talentos — Configurações</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {TALENT_POOL_KEYS.map((dk) => (
          <div key={dk.key} className="flex items-end gap-3">
            <div className="flex-1 space-y-1">
              <Label>{dk.label}</Label>
              {dk.type === "select" ? (
                <Select value={values[dk.key] || ""} onValueChange={(v) => setValues((prev) => ({ ...prev, [dk.key]: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {dk.options!.map((o) => <SelectItem key={o} value={o}>{o === "true" ? "Sim" : o === "false" ? "Não" : o}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  type="number"
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
