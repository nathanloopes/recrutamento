import { useGlobalSettings, useUpdateSetting } from "@/hooks/useGlobalSettings";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DoubleConfirmDialog } from "@/components/admin/DoubleConfirmDialog";
import { useState, useEffect, useMemo } from "react";
import { Loader2, Shield, RotateCcw } from "lucide-react";

const SCORE_FIELDS = [
  { key: "min_score_phase_1", label: "Score mínimo - Fase 1 (Triagem)", desc: "Nota mínima para avançar da triagem", color: "bg-blue-500" },
  { key: "min_score_ia_interview", label: "Score mínimo - Entrevista IA", desc: "Nota mínima na entrevista com IA", color: "bg-violet-500" },
  { key: "min_score_human_interview", label: "Score mínimo - Entrevista Humana", desc: "Nota mínima na entrevista presencial", color: "bg-amber-500" },
  { key: "min_score_hiring", label: "Score mínimo - Contratação", desc: "Nota final mínima para contratar", color: "bg-green-500" },
];

export function ScoringRulesTab() {
  const { data: settings, isLoading } = useGlobalSettings("scoring");
  const updateSetting = useUpdateSetting();
  const [values, setValues] = useState<Record<string, string>>({});
  const [confirmDialog, setConfirmDialog] = useState<{ key: string; label: string } | null>(null);

  useEffect(() => {
    if (settings) {
      const v: Record<string, string> = {};
      settings.forEach((s) => {
        const raw = s.value;
        v[s.key] = typeof raw === "string" ? raw : JSON.stringify(raw);
      });
      setValues(v);
    }
  }, [settings]);

  const getNumeric = (key: string, fallback: number) => {
    const v = values[key];
    if (v === undefined || v === "") return fallback;
    const n = Number(v);
    return isNaN(n) ? fallback : n;
  };

  const getBool = (key: string, fallback: boolean) => {
    const v = values[key];
    if (v === "true") return true;
    if (v === "false") return false;
    return fallback;
  };

  const getString = (key: string, fallback: string) => {
    const v = values[key];
    if (!v) return fallback;
    return v.replace(/"/g, "");
  };

  const handleSaveScore = (key: string) => {
    const field = SCORE_FIELDS.find((f) => f.key === key);
    if (field) {
      setConfirmDialog({ key, label: field.label });
    } else {
      doSave(key);
    }
  };

  const doSave = (key: string) => {
    const raw = values[key];
    if (raw === undefined) return;

    // Determine type
    if (raw === "true" || raw === "false") {
      updateSetting.mutate({ category: "scoring", key, value: raw === "true" });
    } else if (!isNaN(Number(raw))) {
      updateSetting.mutate({ category: "scoring", key, value: Number(raw) });
    } else {
      updateSetting.mutate({ category: "scoring", key, value: raw.replace(/"/g, "") });
    }
    setConfirmDialog(null);
  };

  const funnelScores = useMemo(() => {
    return SCORE_FIELDS.map((f) => ({
      ...f,
      value: getNumeric(f.key, 0),
    }));
  }, [values]);

  if (isLoading) return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-6">
      {/* Score Funnel Visualization */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Funil de Score
          </CardTitle>
          <CardDescription>Visualização dos thresholds de aprovação por fase</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative h-16 bg-muted rounded-lg overflow-hidden flex">
            {funnelScores.map((f, i) => (
              <div
                key={f.key}
                className="relative flex-1 flex items-center justify-center border-r border-background last:border-r-0"
                style={{ opacity: 0.7 + i * 0.1 }}
              >
                <div className={`absolute inset-0 ${f.color} opacity-20`} />
                <div className="relative text-center z-10">
                  <div className="text-lg font-bold">{f.value}</div>
                  <div className="text-[10px] text-muted-foreground leading-tight">
                    {f.label.replace("Score mínimo - ", "")}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-2 text-xs text-muted-foreground">
            <span className="text-warning">← Standby</span>
            <span className="text-green-600">Aprovado →</span>
          </div>
        </CardContent>
      </Card>

      {/* Score Thresholds */}
      <Card>
        <CardHeader>
          <CardTitle>Regras de Score e Progressão</CardTitle>
          <CardDescription>Defina os critérios mínimos de aprovação em cada fase do processo seletivo.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {SCORE_FIELDS.map((f) => (
            <div key={f.key} className="flex items-end gap-4">
              <div className="flex-1 space-y-1">
                <Label htmlFor={f.key}>{f.label}</Label>
                <p className="text-xs text-muted-foreground">{f.desc}</p>
                <Input
                  id={f.key}
                  type="number"
                  min={0}
                  max={100}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))}
                />
              </div>
              <Button size="sm" onClick={() => handleSaveScore(f.key)} disabled={updateSetting.isPending}>
                Salvar
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Retry Rules */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5" />
            Regras de Repetição
          </CardTitle>
          <CardDescription>Controle quantas vezes um candidato pode repetir etapas e replicar para vagas.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>Máximo de tentativas por etapa: {getNumeric("max_retry_attempts", 2)}</Label>
            <Slider
              value={[getNumeric("max_retry_attempts", 2)]}
              onValueChange={([v]) => setValues((p) => ({ ...p, max_retry_attempts: String(v) }))}
              min={0}
              max={5}
              step={1}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>0 (sem repetição)</span>
              <span>5</span>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => doSave("max_retry_attempts")}
              disabled={updateSetting.isPending}
            >
              Salvar
            </Button>
          </div>

          <div className="space-y-1">
            <Label htmlFor="allow_reapply_after_days">Cooldown para reaplicar (dias)</Label>
            <p className="text-xs text-muted-foreground">
              Após ir para standby, quantos dias o candidato deve esperar para se candidatar novamente à mesma vaga.
            </p>
            <div className="flex gap-2">
              <Input
                id="allow_reapply_after_days"
                type="number"
                min={0}
                value={values["allow_reapply_after_days"] ?? "90"}
                onChange={(e) => setValues((p) => ({ ...p, allow_reapply_after_days: e.target.value }))}
              />
              <Button size="sm" variant="outline" onClick={() => doSave("allow_reapply_after_days")} disabled={updateSetting.isPending}>
                Salvar
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Global Behavior */}
      <Card>
        <CardHeader>
          <CardTitle>Comportamento Global</CardTitle>
          <CardDescription>Configurações de enforcement e arredondamento de score.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <Label>Forçar regras globais de scoring</Label>
              <p className="text-xs text-muted-foreground">Quando ativo, as regras se aplicam a todas as vagas sem exceção.</p>
            </div>
            <Switch
              checked={getBool("enforce_global_scoring", true)}
              onCheckedChange={(v) => {
                setValues((p) => ({ ...p, enforce_global_scoring: String(v) }));
                updateSetting.mutate({ category: "scoring", key: "enforce_global_scoring", value: v });
              }}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Permitir exceções manuais</Label>
              <p className="text-xs text-muted-foreground">Permite que admins aprovem candidatos abaixo do score mínimo.</p>
            </div>
            <Switch
              checked={getBool("allow_manual_override", false)}
              onCheckedChange={(v) => {
                setValues((p) => ({ ...p, allow_manual_override: String(v) }));
                updateSetting.mutate({ category: "scoring", key: "allow_manual_override", value: v });
              }}
            />
          </div>

          <div className="space-y-1">
            <Label>Arredondamento de Score</Label>
            <p className="text-xs text-muted-foreground">Como arredondar scores fracionários na decisão final.</p>
            <Select
              value={getString("score_rounding", "floor")}
              onValueChange={(v) => {
                setValues((p) => ({ ...p, score_rounding: v }));
                updateSetting.mutate({ category: "scoring", key: "score_rounding", value: v });
              }}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="floor">Arredondar para baixo (floor)</SelectItem>
                <SelectItem value="ceil">Arredondar para cima (ceil)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Double Confirmation Dialog */}
      <DoubleConfirmDialog
        open={!!confirmDialog}
        onOpenChange={() => setConfirmDialog(null)}
        title="Confirmar Alteração de Score"
        description={`Você está alterando "${confirmDialog?.label}" para ${values[confirmDialog?.key || ""]}. Esta mudança afetará todos os processos seletivos ativos.`}
        confirmWord="CONFIRMAR"
        onConfirm={() => confirmDialog && doSave(confirmDialog.key)}
      />
    </div>
  );
}
