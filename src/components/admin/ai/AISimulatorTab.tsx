import { useState } from "react";
import { usePromptVersions } from "@/hooks/useAIPrompts";
import { useGlobalSettings } from "@/hooks/useGlobalSettings";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Play, FlaskConical, CheckCircle, XCircle, AlertTriangle, RefreshCw, Clock } from "lucide-react";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const CRITERIA = [
  { key: "communication", label: "Comunicação" },
  { key: "clarity", label: "Clareza" },
  { key: "coherence", label: "Coerência" },
  { key: "role_fit", label: "Aderência ao cargo" },
];

const decisionLabels: Record<string, { label: string; icon: React.ElementType }> = {
  approved_next_stage: { label: "Aprovado", icon: CheckCircle },
  repeat_stage: { label: "Repetir", icon: RefreshCw },
  rejected: { label: "Standby", icon: Clock },
  escalate_human: { label: "Escalar", icon: AlertTriangle },
};

interface SimulationResult {
  final_score: number;
  decision: string;
  criteria_scores: Record<string, number>;
  strengths: string[];
  risks: string[];
  explanation: string;
  processing_time_ms: number;
  tokens_used: number;
}

export function AISimulatorTab() {
  const { data: versions } = usePromptVersions();
  const { data: govSettings } = useGlobalSettings("ai_governance");
  const aiEnabledSetting = govSettings?.find((s) => s.key === "ai_enabled");
  const isAiDisabled = aiEnabledSetting?.value === false || aiEnabledSetting?.value === "false";
  const { toast } = useToast();
  const [selectedVersion, setSelectedVersion] = useState<string>("active");
  const [candidateResponse, setCandidateResponse] = useState("");
  const [weights, setWeights] = useState<Record<string, number>>({
    communication: 25, clarity: 25, coherence: 25, role_fit: 25,
  });
  const [isSimulating, setIsSimulating] = useState(false);
  const [result, setResult] = useState<SimulationResult | null>(null);

  const activeVersion = versions?.find((v) => v.is_active);

  const getPromptText = () => {
    if (selectedVersion === "active") return activeVersion?.prompt_text || "";
    const v = versions?.find((v) => v.id === selectedVersion);
    return v?.prompt_text || "";
  };

  const handleSimulate = async () => {
    const promptText = getPromptText();
    if (!promptText || !candidateResponse.trim()) {
      toast({ title: "Preencha os campos", description: "Selecione um prompt e insira a resposta simulada.", variant: "destructive" });
      return;
    }

    setIsSimulating(true);
    setResult(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/simulate-evaluation`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
            apikey: SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            prompt_text: promptText,
            candidate_response: candidateResponse,
            weights,
          }),
        }
      );

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Simulation failed");
      }

      const data = await res.json();
      setResult(data);
    } catch (err: any) {
      toast({ title: "Erro na simulação", description: err.message, variant: "destructive" });
    } finally {
      setIsSimulating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold flex items-center gap-2"><FlaskConical className="h-5 w-5" /> Simulador Sandbox</h3>
        <p className="text-sm text-muted-foreground">Teste prompts com dados fictícios sem impacto real no sistema.</p>
        {isAiDisabled && (
          <Alert variant="destructive" className="mt-2 border-destructive/50 bg-destructive/10">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>IA desativada globalmente. O simulador está indisponível.</AlertDescription>
          </Alert>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Input */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Prompt</CardTitle></CardHeader>
            <CardContent>
              <Select value={selectedVersion} onValueChange={setSelectedVersion}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {activeVersion && <SelectItem value="active">Prompt Ativo (v{activeVersion.version})</SelectItem>}
                  {versions?.filter(v => !v.is_active).map((v) => (
                    <SelectItem key={v.id} value={v.id}>v{v.version} (inativo)</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Resposta Simulada do Candidato</CardTitle></CardHeader>
            <CardContent>
              <Textarea rows={6} value={candidateResponse} onChange={(e) => setCandidateResponse(e.target.value)}
                placeholder="Insira aqui a resposta fictícia do candidato para testar a avaliação da IA..." />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Pesos dos Critérios</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {CRITERIA.map((c) => (
                <div key={c.key} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <Label>{c.label}</Label>
                    <span className="font-mono">{weights[c.key]}%</span>
                  </div>
                  <Slider value={[weights[c.key]]} min={0} max={100} step={5}
                    onValueChange={([v]) => setWeights((p) => ({ ...p, [c.key]: v }))} />
                </div>
              ))}
            </CardContent>
          </Card>

          <Button className="w-full gap-2" onClick={handleSimulate} disabled={isSimulating || !candidateResponse.trim() || isAiDisabled}>
            {isSimulating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Simular Avaliação
          </Button>
        </div>

        {/* Result */}
        <div className="space-y-4">
          {result ? (
            <>
              <Card className="border-dashed border-2 border-amber-500/50">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Resultado</CardTitle>
                    <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30">SIMULAÇÃO</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-3xl font-bold font-mono">{result.final_score}</span>
                    {(() => {
                      const dec = decisionLabels[result.decision] || { label: result.decision, icon: AlertTriangle };
                      const Icon = dec.icon;
                      return <Badge className="gap-1"><Icon className="h-3 w-3" />{dec.label}</Badge>;
                    })()}
                  </div>

                  <div className="space-y-2">
                    {Object.entries(result.criteria_scores).map(([key, score]) => (
                      <div key={key} className="space-y-1">
                        <div className="flex justify-between text-sm">
                          <span>{CRITERIA.find(c => c.key === key)?.label || key}</span>
                          <span className="font-mono">{score}</span>
                        </div>
                        <Progress value={score} className="h-2" />
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {result.strengths.length > 0 && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-base">Pontos Fortes</CardTitle></CardHeader>
                  <CardContent>
                    <ul className="text-sm space-y-1">
                      {result.strengths.map((s, i) => <li key={i} className="flex items-center gap-1"><CheckCircle className="h-3 w-3 text-green-600" />{s}</li>)}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {result.risks.length > 0 && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-base">Riscos</CardTitle></CardHeader>
                  <CardContent>
                    <ul className="text-sm space-y-1">
                      {result.risks.map((r, i) => <li key={i} className="flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-amber-500" />{r}</li>)}
                    </ul>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Justificativa</CardTitle></CardHeader>
                <CardContent>
                  <p className="text-sm">{result.explanation}</p>
                  <p className="text-xs text-muted-foreground mt-2">Tempo: {result.processing_time_ms}ms | Tokens: {result.tokens_used}</p>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card className="h-full min-h-[300px] flex items-center justify-center">
              <CardContent className="text-center text-muted-foreground">
                <FlaskConical className="h-12 w-12 mx-auto mb-4 opacity-30" />
                <p>Execute uma simulação para ver os resultados aqui.</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
