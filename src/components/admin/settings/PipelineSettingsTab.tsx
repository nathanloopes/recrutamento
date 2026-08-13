import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Save } from "lucide-react";
import { useGlobalSettings, useUpdateSetting } from "@/hooks/useGlobalSettings";

export function PipelineSettingsTab() {
  const { data: settings, isLoading } = useGlobalSettings("pipelines");
  const updateSetting = useUpdateSetting();

  const getSetting = (key: string, fallback: any) => {
    const s = settings?.find((s) => s.key === key);
    return s ? s.value : fallback;
  };

  const [form, setForm] = useState({
    allow_phase_edit_after_publish: false,
    min_default_phase_score: 60,
    ai_evaluation_enabled: true,
    max_pipeline_phases: 10,
    step_weight_limit: 10,
    require_score_justification: false,
    auto_approve_test_if_not_exists: false,
  });

  useEffect(() => {
    if (settings) {
      setForm({
        allow_phase_edit_after_publish: getSetting("allow_phase_edit_after_publish", false) === true || getSetting("allow_phase_edit_after_publish", "false") === "true",
        min_default_phase_score: Number(getSetting("min_default_phase_score", 60)),
        ai_evaluation_enabled: getSetting("ai_evaluation_enabled", true) === true || getSetting("ai_evaluation_enabled", "true") === "true",
        max_pipeline_phases: Number(getSetting("max_pipeline_phases", 10)),
        step_weight_limit: Number(getSetting("step_weight_limit", 10)),
        require_score_justification: getSetting("require_score_justification", false) === true || getSetting("require_score_justification", "false") === "true",
        auto_approve_test_if_not_exists: getSetting("auto_approve_test_if_not_exists", false) === true || getSetting("auto_approve_test_if_not_exists", "false") === "true",
      });
    }
  }, [settings]);

  const save = (key: string, value: any) => {
    updateSetting.mutate({ category: "pipelines", key, value });
  };

  if (isLoading) return <div className="flex justify-center py-8"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configurações de Pipelines</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <Label>Permitir edição de fase após publicação</Label>
              <p className="text-xs text-muted-foreground">Se desativado, fases publicadas ficam imutáveis</p>
            </div>
            <Switch
              checked={form.allow_phase_edit_after_publish}
              onCheckedChange={(v) => { setForm({ ...form, allow_phase_edit_after_publish: v }); save("allow_phase_edit_after_publish", v); }}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Avaliação por IA habilitada</Label>
              <p className="text-xs text-muted-foreground">Ativa ou desativa avaliação automática por IA em etapas</p>
            </div>
            <Switch
              checked={form.ai_evaluation_enabled}
              onCheckedChange={(v) => { setForm({ ...form, ai_evaluation_enabled: v }); save("ai_evaluation_enabled", v); }}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Exigir justificativa de score</Label>
              <p className="text-xs text-muted-foreground">Obriga justificativa em avaliações manuais</p>
            </div>
            <Switch
              checked={form.require_score_justification}
              onCheckedChange={(v) => { setForm({ ...form, require_score_justification: v }); save("require_score_justification", v); }}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Aprovar automaticamente etapa Teste</Label>
              <p className="text-xs text-muted-foreground">
                Quando ligado: vagas <strong>sem teste</strong> liberam o candidato direto para a entrevista; vagas <strong>com teste</strong> aprovam automaticamente quem atingir o score mínimo da vaga, sem precisar de clique do recrutador.
              </p>
            </div>
            <Switch
              checked={form.auto_approve_test_if_not_exists}
              onCheckedChange={(v) => { setForm({ ...form, auto_approve_test_if_not_exists: v }); save("auto_approve_test_if_not_exists", v); }}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label className="text-sm">Score mínimo padrão por fase</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  value={form.min_default_phase_score}
                  onChange={(e) => setForm({ ...form, min_default_phase_score: Number(e.target.value) })}
                  className="w-24"
                />
                <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => save("min_default_phase_score", form.min_default_phase_score)}>
                  <Save className="h-3 w-3" />
                </Button>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-sm">Máximo de fases por pipeline</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  value={form.max_pipeline_phases}
                  onChange={(e) => setForm({ ...form, max_pipeline_phases: Number(e.target.value) })}
                  className="w-24"
                />
                <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => save("max_pipeline_phases", form.max_pipeline_phases)}>
                  <Save className="h-3 w-3" />
                </Button>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-sm">Peso máximo por etapa</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  value={form.step_weight_limit}
                  onChange={(e) => setForm({ ...form, step_weight_limit: Number(e.target.value) })}
                  className="w-24"
                />
                <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => save("step_weight_limit", form.step_weight_limit)}>
                  <Save className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
