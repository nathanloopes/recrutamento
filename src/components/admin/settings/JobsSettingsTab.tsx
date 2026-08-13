import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useGlobalSettings, useUpdateSetting } from "@/hooks/useGlobalSettings";
import { useState, useEffect } from "react";
import { Save, Briefcase } from "lucide-react";

const JOBS_KEYS = [
  { key: "require_version_justification", label: "Exigir justificativa ao versionar cargo", options: ["true", "false"] },
  { key: "allow_unit_salary_edit", label: "Permitir edição de salário pela unidade", options: ["true", "false"] },
  { key: "auto_notify_units_on_change", label: "Notificar unidades ao alterar cargo", options: ["true", "false"] },
  { key: "ai_job_validation_enabled", label: "Validação IA de descrição do cargo", options: ["true", "false"] },
  { key: "job_status_default", label: "Status padrão de novos cargos", options: ["ativo", "inativo"] },
];

export function JobsSettingsTab() {
  const { data: settings, isLoading } = useGlobalSettings("jobs");
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
    if (raw === "true") parsed = true;
    else if (raw === "false") parsed = false;
    updateSetting.mutate({ category: "jobs", key, value: parsed });
  };

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Briefcase className="h-5 w-5" />
          Configurações de Cargos Institucionais
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {JOBS_KEYS.map((jk) => (
          <div key={jk.key} className="flex items-end gap-3">
            <div className="flex-1 space-y-1">
              <Label>{jk.label}</Label>
              <Select value={values[jk.key] || ""} onValueChange={(v) => setValues((prev) => ({ ...prev, [jk.key]: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {jk.options.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o === "true" ? "Sim" : o === "false" ? "Não" : o === "ativo" ? "Ativo" : "Inativo"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" onClick={() => handleSave(jk.key)} disabled={updateSetting.isPending}>
              <Save className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
