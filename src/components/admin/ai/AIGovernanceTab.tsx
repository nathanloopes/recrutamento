import { useGlobalSettings, useUpdateSetting } from "@/hooks/useGlobalSettings";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, ShieldAlert, Brain, Scale, AlertTriangle } from "lucide-react";
import { useState, useEffect } from "react";

const WEIGHTS = [
  { key: "weight_communication", label: "Comunicação" },
  { key: "weight_clarity", label: "Clareza" },
  { key: "weight_coherence", label: "Coerência" },
  { key: "weight_role_fit", label: "Aderência ao cargo" },
];

export function AIGovernanceTab() {
  const { data: govSettings, isLoading: govLoading } = useGlobalSettings("ai_governance");
  const { data: aiSettings, isLoading: aiLoading } = useGlobalSettings("ai");
  const updateSetting = useUpdateSetting();

  const [govValues, setGovValues] = useState<Record<string, any>>({});
  const [prompt, setPrompt] = useState("");
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [thresholds, setThresholds] = useState({ approve: 85, reject: 40 });

  useEffect(() => {
    if (govSettings) {
      const v: Record<string, any> = {};
      govSettings.forEach((s) => { v[s.key] = s.value; });
      setGovValues(v);
    }
  }, [govSettings]);

  useEffect(() => {
    if (aiSettings) {
      const get = (k: string) => aiSettings.find((s) => s.key === k)?.value;
      const p = get("base_prompt");
      setPrompt(typeof p === "string" ? p : String(p ?? ""));
      const w: Record<string, number> = {};
      WEIGHTS.forEach((wt) => (w[wt.key] = Number(get(wt.key) ?? 25)));
      setWeights(w);
      setThresholds({
        approve: Number(get("auto_approve_threshold") ?? 85),
        reject: Number(get("auto_reject_threshold") ?? 40),
      });
    }
  }, [aiSettings]);

  const saveGov = (key: string, value: any) => updateSetting.mutate({ category: "ai_governance", key, value });
  const saveAi = (key: string, value: any) => updateSetting.mutate({ category: "ai", key, value });

  if (govLoading || aiLoading) return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);

  const isPromptLocked = govValues.ai_prompt_lock === true || govValues.ai_prompt_lock === "true";
  const isAiDisabled = govValues.ai_enabled === false || govValues.ai_enabled === "false";

  return (
    <div className="space-y-6">
      {/* Kill Switch & Controles Globais */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5" /> Controles Globais da IA</CardTitle>
          <CardDescription>Chaves mestras que controlam o funcionamento global da IA no sistema.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <Label>IA Habilitada (Kill Switch)</Label>
              <p className="text-xs text-muted-foreground">Desativar faz com que todas as avaliações sejam escaladas para humano.</p>
            </div>
            <Switch
              checked={!(govValues.ai_enabled === false || govValues.ai_enabled === "false")}
              onCheckedChange={(v) => { setGovValues((p) => ({ ...p, ai_enabled: v })); saveGov("ai_enabled", v); }}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Forçar escalonamento humano</Label>
              <p className="text-xs text-muted-foreground">Quando ativo, todas as decisões da IA são automaticamente escaladas para revisão humana.</p>
            </div>
            <Switch
              checked={govValues.ai_force_human === true || govValues.ai_force_human === "true"}
              onCheckedChange={(v) => { setGovValues((p) => ({ ...p, ai_force_human: v })); saveGov("ai_force_human", v); }}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Bloquear edição de prompts</Label>
              <p className="text-xs text-muted-foreground">Impede criação e ativação de novas versões de prompt institucional.</p>
            </div>
            <Switch
              checked={isPromptLocked}
              onCheckedChange={(v) => { setGovValues((p) => ({ ...p, ai_prompt_lock: v })); saveGov("ai_prompt_lock", v); }}
            />
          </div>

          <div className="space-y-2">
            <Label>Retenção de logs de decisão (dias)</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={Number(govValues.ai_log_retention_days ?? 365)}
                onChange={(e) => setGovValues((p) => ({ ...p, ai_log_retention_days: Number(e.target.value) }))}
                className="w-32"
              />
              <Button size="sm" onClick={() => saveGov("ai_log_retention_days", govValues.ai_log_retention_days)}>Salvar</Button>
            </div>
            <p className="text-xs text-muted-foreground">Logs de decisão da IA são mantidos por este período.</p>
          </div>

          {isAiDisabled && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> IA desativada globalmente. Todas as avaliações serão escaladas para humano.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Governança da IA */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5" /> Governança da IA</CardTitle>
          <CardDescription>Parâmetros institucionais que controlam o comportamento da IA no recrutamento.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <div className="flex justify-between">
              <Label>Peso padrão da IA no score final (%)</Label>
              <span className="text-sm font-mono">{Number(govValues.ai_default_weight ?? 60)}%</span>
            </div>
            <Slider
              value={[Number(govValues.ai_default_weight ?? 60)]}
              min={0} max={100} step={5}
              onValueChange={([v]) => setGovValues((p) => ({ ...p, ai_default_weight: v }))}
            />
            <Button size="sm" onClick={() => saveGov("ai_default_weight", govValues.ai_default_weight)}>Salvar</Button>
            <p className="text-xs text-muted-foreground italic">Roadmap: variação de peso por cargo/tipo de vaga em versão futura.</p>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between">
              <Label>Peso máximo permitido da IA (%)</Label>
              <span className="text-sm font-mono">{Number(govValues.max_ai_weight ?? 80)}%</span>
            </div>
            <Slider
              value={[Number(govValues.max_ai_weight ?? 80)]}
              min={0} max={100} step={5}
              onValueChange={([v]) => setGovValues((p) => ({ ...p, max_ai_weight: v }))}
            />
            <Button size="sm" onClick={() => saveGov("max_ai_weight", govValues.max_ai_weight)}>Salvar</Button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>IA pode mover para standby sozinha</Label>
              <p className="text-xs text-muted-foreground">Se desativado, movimentações para standby exigem validação humana.</p>
            </div>
            <Switch
              checked={govValues.ai_elimination_allowed === true || govValues.ai_elimination_allowed === "true"}
              onCheckedChange={(v) => { setGovValues((p) => ({ ...p, ai_elimination_allowed: v })); saveGov("ai_elimination_allowed", v); }}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Exigir validação humana</Label>
              <p className="text-xs text-muted-foreground">Todas as decisões da IA requerem confirmação humana.</p>
            </div>
            <Switch
              checked={govValues.require_human_validation === true || govValues.require_human_validation === "true"}
              onCheckedChange={(v) => { setGovValues((p) => ({ ...p, require_human_validation: v })); saveGov("require_human_validation", v); }}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Modelo padrão</Label>
              <Select
                value={String(govValues.ai_model_default ?? "gpt-4o-mini").replace(/"/g, "")}
                onValueChange={(v) => { setGovValues((p) => ({ ...p, ai_model_default: v })); saveGov("ai_model_default", v); }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="gpt-4o-mini">GPT-4o Mini</SelectItem>
                  <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                  <SelectItem value="gpt-4">GPT-4</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Nível de logging</Label>
              <Select
                value={String(govValues.ai_logging_level ?? "completo").replace(/"/g, "")}
                onValueChange={(v) => { setGovValues((p) => ({ ...p, ai_logging_level: v })); saveGov("ai_logging_level", v); }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="basico">Básico</SelectItem>
                  <SelectItem value="completo">Completo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Regras de Escalonamento Humano */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5" /> Regras de Escalonamento Humano</CardTitle>
          <CardDescription>Define quando a IA deve parar e encaminhar para validação humana.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <div className="flex justify-between">
              <Label>Margem de score para escalonamento (pontos)</Label>
              <span className="text-sm font-mono">{Number(govValues.escalation_score_margin ?? 10)} pts</span>
            </div>
            <Slider
              value={[Number(govValues.escalation_score_margin ?? 10)]}
              min={0} max={30} step={1}
              onValueChange={([v]) => setGovValues((p) => ({ ...p, escalation_score_margin: v }))}
            />
            <p className="text-xs text-muted-foreground">Quando o score está a esta distância do threshold de aprovação/standby, a decisão é escalada para humano.</p>
            <Button size="sm" onClick={() => saveGov("escalation_score_margin", govValues.escalation_score_margin)}>Salvar</Button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Escalar em inconsistência de critérios</Label>
              <p className="text-xs text-muted-foreground">Escala para humano se a variação entre critérios for &gt; 30 pontos.</p>
            </div>
            <Switch
              checked={govValues.escalation_on_inconsistency === true || govValues.escalation_on_inconsistency === "true"}
              onCheckedChange={(v) => { setGovValues((p) => ({ ...p, escalation_on_inconsistency: v })); saveGov("escalation_on_inconsistency", v); }}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Escalar em detecção de risco</Label>
              <p className="text-xs text-muted-foreground">Escala para humano se a IA detectar linguagem agressiva ou incoerência extrema.</p>
            </div>
            <Switch
              checked={govValues.escalation_on_risk_keywords === true || govValues.escalation_on_risk_keywords === "true"}
              onCheckedChange={(v) => { setGovValues((p) => ({ ...p, escalation_on_risk_keywords: v })); saveGov("escalation_on_risk_keywords", v); }}
            />
          </div>

          <div className="space-y-1">
            <Label>Nível de autonomia da IA</Label>
            <Select
              value={String(govValues.ai_max_autonomy ?? "suggest").replace(/"/g, "")}
              onValueChange={(v) => { setGovValues((p) => ({ ...p, ai_max_autonomy: v })); saveGov("ai_max_autonomy", v); }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="suggest">Sugestivo (apenas recomenda)</SelectItem>
                <SelectItem value="decide_with_review">Decide com revisão humana</SelectItem>
                <SelectItem value="full_auto">Automático (decide sozinha)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Define até onde a IA pode agir sem intervenção humana.</p>
          </div>
        </CardContent>
      </Card>

      {/* Prompt Institucional */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Brain className="h-5 w-5" /> Prompt Institucional da IA</CardTitle>
          <CardDescription>Prompt base usado em todas as avaliações. Versionamento gerenciado na aba "Prompts".</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {isPromptLocked && (
            <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400 flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4" /> Edição de prompt bloqueada pelo CrossConfig.
            </div>
          )}
          <Textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} disabled={isPromptLocked} />
          <Button size="sm" onClick={() => saveAi("base_prompt", prompt)} disabled={isPromptLocked}>Salvar prompt</Button>
        </CardContent>
      </Card>

      {/* Pesos dos Critérios */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Scale className="h-5 w-5" /> Pesos dos Critérios</CardTitle>
          <CardDescription>
            Distribuição de peso (%) para cada critério avaliado pela IA. Total: <span className={totalWeight !== 100 ? "text-destructive font-bold" : "text-green-600 font-bold"}>{totalWeight}%</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {WEIGHTS.map((w) => (
            <div key={w.key} className="space-y-1">
              <div className="flex justify-between">
                <Label>{w.label}</Label>
                <span className="text-sm font-medium">{weights[w.key] ?? 25}%</span>
              </div>
              <Slider
                value={[weights[w.key] ?? 25]}
                min={0} max={100} step={5}
                onValueChange={([v]) => setWeights((p) => ({ ...p, [w.key]: v }))}
              />
            </div>
          ))}
          <Button size="sm" onClick={() => WEIGHTS.forEach((w) => saveAi(w.key, weights[w.key]))}>
            Salvar pesos
          </Button>
        </CardContent>
      </Card>

      {/* Thresholds de Decisão */}
      <Card>
        <CardHeader>
          <CardTitle>Thresholds de Decisão</CardTitle>
          <CardDescription>Limites para aprovação/standby automático pela IA.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-end gap-3 sm:gap-4">
            <div className="flex-1 w-full space-y-1">
              <Label>Aprovação automática (score ≥)</Label>
              <Input type="number" value={thresholds.approve} onChange={(e) => setThresholds((p) => ({ ...p, approve: Number(e.target.value) }))} />
            </div>
            <Button size="sm" onClick={() => saveAi("auto_approve_threshold", thresholds.approve)}>Salvar</Button>
          </div>
          <div className="flex flex-col sm:flex-row items-start sm:items-end gap-3 sm:gap-4">
            <div className="flex-1 w-full space-y-1">
              <Label>Standby automático (score ≤)</Label>
              <Input type="number" value={thresholds.reject} onChange={(e) => setThresholds((p) => ({ ...p, reject: Number(e.target.value) }))} />
            </div>
            <Button size="sm" onClick={() => saveAi("auto_reject_threshold", thresholds.reject)}>Salvar</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
