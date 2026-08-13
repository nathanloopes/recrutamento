import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useGlobalSettings, useUpdateSetting } from "@/hooks/useGlobalSettings";
import { useState, useEffect } from "react";
import { Save } from "lucide-react";

const FAQ_KEYS = [
  { key: "faq_ai_enabled", label: "IA do FAQ ativa", type: "select", options: ["true", "false"] },
  { key: "min_confidence_threshold", label: "Confiança mínima para resposta IA", type: "number" },
  { key: "allow_voice", label: "Permitir pergunta por voz", type: "select", options: ["true", "false"] },
  { key: "feedback_required", label: "Avaliação obrigatória", type: "select", options: ["true", "false"] },
  { key: "domains_enabled", label: "Domínios ativos (JSON array)", type: "text" },
];

export function FAQSettingsTab() {
  const { data: settings, isLoading } = useGlobalSettings("faq");
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
    updateSetting.mutate({ category: "faq", key, value: parsed });
  };

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Configurações do FAQ & IA</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {FAQ_KEYS.map((fk) => (
          <div key={fk.key} className="flex items-end gap-3">
            <div className="flex-1 space-y-1">
              <Label>{fk.label}</Label>
              {fk.type === "select" ? (
                <Select value={values[fk.key] || ""} onValueChange={(v) => setValues((prev) => ({ ...prev, [fk.key]: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {fk.options!.map((o) => <SelectItem key={o} value={o}>{o === "true" ? "Sim" : o === "false" ? "Não" : o}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  type={fk.type === "number" ? "number" : "text"}
                  value={values[fk.key] || ""}
                  onChange={(e) => setValues((prev) => ({ ...prev, [fk.key]: e.target.value }))}
                />
              )}
            </div>
            <Button size="sm" onClick={() => handleSave(fk.key)} disabled={updateSetting.isPending}>
              <Save className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
