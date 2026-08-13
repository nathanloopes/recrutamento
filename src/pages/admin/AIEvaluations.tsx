import { useState } from "react";
import { useAIEvaluations, type AIEvaluation } from "@/hooks/useAIEvaluations";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Loader2, Brain, CheckCircle, XCircle, RefreshCw, AlertTriangle, Mic, FileText, Shield, FlaskConical, Settings, Clock } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AIPromptsTab } from "@/components/admin/ai/AIPromptsTab";
import { AIAuditTab } from "@/components/admin/ai/AIAuditTab";
import { AISimulatorTab } from "@/components/admin/ai/AISimulatorTab";
import { AIGovernanceTab } from "@/components/admin/ai/AIGovernanceTab";
import { PageHelp } from "@/components/ui/page-help";

const decisionLabels: Record<string, { label: string; variant: "default" | "destructive" | "secondary" | "outline"; icon: React.ElementType }> = {
  approved_next_stage: { label: "Aprovado", variant: "default", icon: CheckCircle },
  repeat_stage: { label: "Repetir", variant: "secondary", icon: RefreshCw },
  rejected: { label: "Standby", variant: "secondary", icon: Clock },
  escalate_human: { label: "Escalar", variant: "outline", icon: AlertTriangle },
};

const criteriaLabels: Record<string, string> = {
  communication: "Comunicação",
  clarity: "Clareza",
  coherence: "Coerência",
  role_fit: "Aderência ao cargo",
};

function EvaluationsTab() {
  const [decisionFilter, setDecisionFilter] = useState<string>("all");
  const [selectedEval, setSelectedEval] = useState<AIEvaluation | null>(null);

  const { data: evaluations, isLoading } = useAIEvaluations(
    decisionFilter !== "all" ? { decision: decisionFilter } : undefined
  );

  const stats = evaluations
    ? {
        total: evaluations.length,
        approved: evaluations.filter((e) => e.decision === "approved_next_stage").length,
        rejected: evaluations.filter((e) => e.decision === "rejected").length,
        avgScore: evaluations.length > 0
          ? Math.round(evaluations.reduce((s, e) => s + e.final_score, 0) / evaluations.length)
          : 0,
      }
    : null;

  return (
    <div className="space-y-6">
      {stats && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card><CardHeader className="pb-2"><CardDescription>Total</CardDescription></CardHeader><CardContent><div className="text-2xl font-bold">{stats.total}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardDescription>Aprovados</CardDescription></CardHeader><CardContent><div className="text-2xl font-bold text-green-600">{stats.approved}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardDescription>Standby</CardDescription></CardHeader><CardContent><div className="text-2xl font-bold text-warning">{stats.rejected}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardDescription>Score Médio</CardDescription></CardHeader><CardContent><div className="text-2xl font-bold">{stats.avgScore}</div></CardContent></Card>
        </div>
      )}

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
        <Select value={decisionFilter} onValueChange={setDecisionFilter}>
          <SelectTrigger className="w-full sm:w-[200px]"><SelectValue placeholder="Filtrar por decisão" /></SelectTrigger>
          <SelectContent disableSearch>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="approved_next_stage">Aprovado</SelectItem>
            <SelectItem value="repeat_stage">Repetir</SelectItem>
            <SelectItem value="rejected">Standby</SelectItem>
            <SelectItem value="escalate_human">Escalar</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : !evaluations?.length ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          <Brain className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p>Nenhuma avaliação encontrada.</p>
        </CardContent></Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Data</TableHead><TableHead>Score</TableHead><TableHead>Decisão</TableHead><TableHead>Provedor</TableHead><TableHead>Tempo</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {evaluations.map((ev) => {
                const dec = decisionLabels[ev.decision] || { label: ev.decision, variant: "secondary" as const, icon: Brain };
                const Icon = dec.icon;
                return (
                  <TableRow key={ev.id} className="cursor-pointer" onClick={() => setSelectedEval(ev)}>
                    <TableCell>{format(new Date(ev.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}</TableCell>
                    <TableCell className="font-mono font-bold">{ev.final_score}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Badge variant={dec.variant} className="gap-1"><Icon className="h-3 w-3" />{dec.label}</Badge>
                        {ev.model_provider === "mock-voice" && <Badge variant="outline" className="gap-1 text-[10px]"><Mic className="h-2.5 w-2.5" />Voz</Badge>}
                      </div>
                    </TableCell>
                    <TableCell><Badge variant="outline">{ev.model_provider}</Badge></TableCell>
                    <TableCell>{ev.processing_time_ms ? `${ev.processing_time_ms}ms` : "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </div>
        </Card>
      )}

      <Dialog open={!!selectedEval} onOpenChange={() => setSelectedEval(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Brain className="h-5 w-5" /> Detalhes da Avaliação</DialogTitle></DialogHeader>
          {selectedEval && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-2xl sm:text-3xl font-bold font-mono">{selectedEval.final_score}</span>
                {(() => {
                  const dec = decisionLabels[selectedEval.decision];
                  const Icon = dec?.icon || Brain;
                  return <Badge variant={dec?.variant || "secondary"} className="gap-1 text-sm"><Icon className="h-4 w-4" />{dec?.label || selectedEval.decision}</Badge>;
                })()}
              </div>
              <div className="space-y-2">
                <h4 className="text-sm font-medium">Critérios</h4>
                {Object.entries(selectedEval.criteria_scores).map(([key, score]) => (
                  <div key={key} className="space-y-1">
                    <div className="flex justify-between text-sm"><span>{criteriaLabels[key] || key}</span><span className="font-mono">{score}</span></div>
                    <Progress value={score} className="h-2" />
                  </div>
                ))}
              </div>
              {selectedEval.strengths.length > 0 && (
                <div><h4 className="text-sm font-medium mb-1">Pontos fortes</h4>
                  <ul className="text-sm space-y-1">{selectedEval.strengths.map((s, i) => <li key={i} className="flex items-center gap-1"><CheckCircle className="h-3 w-3 text-green-600" />{s}</li>)}</ul>
                </div>
              )}
              {selectedEval.risks.length > 0 && (
                <div><h4 className="text-sm font-medium mb-1">Riscos</h4>
                  <ul className="text-sm space-y-1">{selectedEval.risks.map((r, i) => <li key={i} className="flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-amber-500" />{r}</li>)}</ul>
                </div>
              )}
              <div className="bg-muted p-3 rounded-md"><h4 className="text-sm font-medium mb-1">Justificativa</h4><p className="text-sm">{selectedEval.explanation}</p></div>
              {/* Gap 12: Show governance overrides if decision was escalated */}
              {selectedEval.decision === "escalate_human" && (
                <div className="flex items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
                  <Shield className="h-4 w-4 text-amber-600 shrink-0" />
                  <p className="text-sm text-amber-700">Governance override aplicado — decisão escalada para revisão humana conforme regras de governança IA.</p>
                </div>
              )}
              <div className="text-xs text-muted-foreground space-y-1">
                <p>Provedor: {selectedEval.model_provider} / {selectedEval.model_version}</p>
                <p>Tempo: {selectedEval.processing_time_ms}ms</p>
                <p>ID: {selectedEval.id}</p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function AIEvaluations() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Brain className="h-6 w-6" /> Governança da IA
          </h1>
          <p className="text-muted-foreground">Painel unificado de avaliações, prompts, auditoria e simulação da IA.</p>
        </div>
        <PageHelp />
      </div>

      <Tabs defaultValue="avaliacoes" className="space-y-4">
        <TabsList>
          <TabsTrigger value="avaliacoes" className="gap-1"><Brain className="h-3.5 w-3.5 shrink-0" /> Avaliações</TabsTrigger>
          <TabsTrigger value="prompts" className="gap-1"><FileText className="h-3.5 w-3.5 shrink-0" /> Prompts</TabsTrigger>
          <TabsTrigger value="auditoria" className="gap-1"><Shield className="h-3.5 w-3.5 shrink-0" /> Auditoria</TabsTrigger>
          <TabsTrigger value="simulador" className="gap-1"><FlaskConical className="h-3.5 w-3.5 shrink-0" /> Simulador</TabsTrigger>
          <TabsTrigger value="governanca" className="gap-1"><Settings className="h-3.5 w-3.5 shrink-0" /> Governança</TabsTrigger>
        </TabsList>

        <TabsContent value="avaliacoes"><EvaluationsTab /></TabsContent>
        <TabsContent value="prompts"><AIPromptsTab /></TabsContent>
        <TabsContent value="auditoria"><AIAuditTab /></TabsContent>
        <TabsContent value="simulador"><AISimulatorTab /></TabsContent>
        <TabsContent value="governanca"><AIGovernanceTab /></TabsContent>
      </Tabs>
    </div>
  );
}
