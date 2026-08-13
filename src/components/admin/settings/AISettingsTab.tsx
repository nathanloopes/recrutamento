import { useGlobalSettings, useUpdateSetting } from "@/hooks/useGlobalSettings";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useState, useEffect } from "react";
import { Loader2, Info, Lock } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuth } from "@/contexts/AuthContext";

const WEIGHTS = [
  { key: "weight_communication", label: "Comunicação" },
  { key: "weight_clarity", label: "Clareza" },
  { key: "weight_coherence", label: "Coerência" },
  { key: "weight_role_fit", label: "Aderência ao cargo" },
];

export function AISettingsTab() {
  const { isAdmin } = useAuth();
  const { data: settings, isLoading } = useGlobalSettings("ai");
  const { data: chatboxSettings, isLoading: chatboxLoading } = useGlobalSettings("chatbox");
  const updateSetting = useUpdateSetting();
  const [prompt, setPrompt] = useState("");
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [thresholds, setThresholds] = useState({ approve: 85, reject: 40 });
  const [welcomeTest, setWelcomeTest] = useState("");
  const [welcomeInterview, setWelcomeInterview] = useState("");
  const saraEnabledRaw = settings?.find((s) => s.key === "sara_enabled")?.value;
  const saraEnabled =
    saraEnabledRaw === true ||
    saraEnabledRaw === "true" ||
    (typeof saraEnabledRaw === "string" && saraEnabledRaw !== "false" && saraEnabledRaw !== "");
  const chatboxEnabledRaw = chatboxSettings?.find((s) => s.key === "chatbox_enabled")?.value;
  const chatboxEnabled =
    chatboxEnabledRaw === undefined || chatboxEnabledRaw === null
      ? true
      : typeof chatboxEnabledRaw === "boolean"
      ? chatboxEnabledRaw
      : typeof chatboxEnabledRaw === "string"
      ? chatboxEnabledRaw !== "false"
      : Boolean(chatboxEnabledRaw);

  useEffect(() => {
    if (settings) {
      const get = (k: string) => settings.find((s) => s.key === k)?.value;
      const p = get("base_prompt");
      setPrompt(typeof p === "string" ? p : String(p ?? ""));
      const w: Record<string, number> = {};
      WEIGHTS.forEach((wt) => (w[wt.key] = Number(get(wt.key) ?? 25)));
      setWeights(w);
      setThresholds({ approve: Number(get("auto_approve_threshold") ?? 85), reject: Number(get("auto_reject_threshold") ?? 40) });
    }
  }, [settings]);

  useEffect(() => {
    if (chatboxSettings) {
      const get = (k: string) => chatboxSettings.find((s) => s.key === k)?.value;
      const wt = get("welcome_message_test");
      setWelcomeTest(typeof wt === "string" ? wt : "");
      const wi = get("welcome_message_interview");
      setWelcomeInterview(typeof wi === "string" ? wi : "");
    }
  }, [chatboxSettings]);

  const save = (key: string, value: any) => updateSetting.mutate({ category: "ai", key, value });

  if (isLoading || chatboxLoading) return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Peso da IA no score final, escalonamento humano e retenção de logs são gerenciados na aba <strong>Governança (IA)</strong> dentro de Configurações Globais.
        </AlertDescription>
      </Alert>


      <Card>
        <CardHeader>
          <CardTitle>Sara conversacional</CardTitle>
          <CardDescription>
            Quando ativa, a Sara responde automaticamente as mensagens dos candidatos no chat, com contexto da vaga, etapa, entrevista e documentos. Recrutadores humanos têm 15 segundos pra responder antes da Sara entrar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Label className="text-base font-medium">Sara responde candidatos</Label>
                {!isAdmin && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
              </div>
              <p className="text-xs text-muted-foreground">
                {isAdmin
                  ? "Ao desativar, a Sara não responde mensagens (eventos automáticos como entrevista marcada continuam ativos)."
                  : "Apenas administradores podem alterar este flag."}
              </p>
            </div>
            <Switch
              checked={saraEnabled}
              disabled={!isAdmin || updateSetting.isPending}
              onCheckedChange={(v) =>
                updateSetting.mutate({ category: "ai", key: "sara_enabled", value: v })
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Prompt Institucional da IA</CardTitle>
          <CardDescription>Prompt base usado em todas as avaliações da IA. Placeholder para Fase 2.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          <Button size="sm" onClick={() => save("base_prompt", prompt)}>Salvar prompt</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pesos dos Critérios</CardTitle>
          <CardDescription>Distribuição de peso (%) para cada critério avaliado pela IA. Total deve somar 100.</CardDescription>
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
          <Button size="sm" onClick={() => WEIGHTS.forEach((w) => save(w.key, weights[w.key]))}>
            Salvar pesos
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Thresholds de Decisão</CardTitle>
          <CardDescription>Limites para aprovação/standby automático pela IA.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-4">
            <div className="flex-1 space-y-1">
              <Label>Aprovação automática (score ≥)</Label>
              <Input type="number" value={thresholds.approve} onChange={(e) => setThresholds((p) => ({ ...p, approve: Number(e.target.value) }))} />
            </div>
            <Button size="sm" onClick={() => save("auto_approve_threshold", thresholds.approve)}>Salvar</Button>
          </div>
          <div className="flex items-end gap-4">
            <div className="flex-1 space-y-1">
              <Label>Standby automático (score ≤)</Label>
              <Input type="number" value={thresholds.reject} onChange={(e) => setThresholds((p) => ({ ...p, reject: Number(e.target.value) }))} />
            </div>
            <Button size="sm" onClick={() => save("auto_reject_threshold", thresholds.reject)}>Salvar</Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Chatbox</CardTitle>
          <CardDescription>
            Controla o modo Chatbox em testes/avaliações. Quando desativado, todos os testes são executados em modo Formulário tradicional.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Label className="text-base font-medium">Chatbox ativo no sistema</Label>
                {!isAdmin && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
              </div>
              <p className="text-xs text-muted-foreground">
                {isAdmin
                  ? "Ao desativar, candidatos só verão o modo Formulário."
                  : "Apenas administradores podem alterar este flag."}
              </p>
            </div>
            <Switch
              checked={chatboxEnabled}
              disabled={!isAdmin || updateSetting.isPending}
              onCheckedChange={(v) =>
                updateSetting.mutate({ category: "chatbox", key: "chatbox_enabled", value: v })
              }
            />
          </div>

          <div className="space-y-2 pt-2 border-t">
            <p className="text-xs text-muted-foreground">
              Mensagens de boas-vindas exibidas ao candidato. Placeholders: <code>{"{titulo}"}</code>, <code>{"{total_perguntas}"}</code>
            </p>
          </div>
          <div className="space-y-2">
            <Label>Mensagem — Teste (Chatbox)</Label>
            <Textarea rows={3} value={welcomeTest} onChange={(e) => setWelcomeTest(e.target.value)} />
            <Button size="sm" onClick={() => updateSetting.mutate({ category: "chatbox", key: "welcome_message_test", value: welcomeTest })}>Salvar</Button>
          </div>
          <div className="space-y-2">
            <Label>Mensagem — Entrevista IA</Label>
            <Textarea rows={3} value={welcomeInterview} onChange={(e) => setWelcomeInterview(e.target.value)} />
            <Button size="sm" onClick={() => updateSetting.mutate({ category: "chatbox", key: "welcome_message_interview", value: welcomeInterview })}>Salvar</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
