import { useState } from "react";
import { useAIDecisionLogs, type AIDecisionLog } from "@/hooks/useAIAudit";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MaskedDateInput } from "@/components/ui/masked-date-input";
import { ymdToLocalDate, dateToLocalYMD } from "@/lib/dateUtils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Shield, Download, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

function maskCpf(cpf: string) {
  if (!cpf || cpf.length < 6) return cpf;
  return cpf.slice(0, 3) + ".***.***-" + cpf.slice(-2);
}

function exportCSV(logs: AIDecisionLog[]) {
  const headers = ["Data", "CPF", "Módulo", "Tipo", "Modelo", "Versão", "Tempo (ms)", "ID"];
  const rows = logs.map((l) => [
    format(new Date(l.created_at), "dd/MM/yyyy HH:mm:ss"),
    maskCpf(l.cpf),
    l.module,
    l.decision_type,
    l.model_provider || "",
    l.model_version || "",
    l.processing_time_ms?.toString() || "",
    l.id,
  ]);

  const csv = [headers, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `auditoria-ia-${format(new Date(), "yyyy-MM-dd")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function AIAuditTab() {
  const [decisionType, setDecisionType] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedLog, setSelectedLog] = useState<AIDecisionLog | null>(null);
  const [reevaluating, setReevaluating] = useState<string | null>(null);

  const filters = {
    ...(decisionType !== "all" ? { decision_type: decisionType } : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
  };

  const { data: logs, isLoading, refetch } = useAIDecisionLogs(Object.keys(filters).length > 0 ? filters : undefined);

  const handleReevaluate = async (log: AIDecisionLog) => {
    try {
      setReevaluating(log.id);

      // Extract application_id and step_response_id from the log
      const applicationId = log.application_id;
      const input = log.input as any;

      if (!applicationId) {
        toast.error("ID da aplicação não encontrado no log.");
        return;
      }

      // Find the evaluation linked to this log to get step_response_id
      const evalId = log.evaluation_id;
      if (!evalId) {
        toast.error("ID da avaliação não encontrado no log.");
        return;
      }

      const { data: evalData } = await supabase
        .from("ai_evaluations")
        .select("step_response_id")
        .eq("id", evalId)
        .single();

      if (!evalData?.step_response_id) {
        toast.error("step_response_id não encontrado na avaliação original.");
        return;
      }

      // Get active prompt version
      const { data: activePrompt } = await supabase
        .from("ai_prompt_versions")
        .select("id, version")
        .eq("is_active", true)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data, error } = await supabase.functions.invoke("evaluate-candidate", {
        body: {
          step_response_id: evalData.step_response_id,
          application_id: applicationId,
          prompt_version_id: activePrompt?.id || undefined,
        },
      });

      if (error) throw error;

      toast.success(
        `Reavaliação concluída! Novo score: ${data.final_score} (prompt ${activePrompt ? `v${activePrompt.version}` : "default"})`
      );
      refetch();
      setSelectedLog(null);
    } catch (err: any) {
      console.error("Reevaluate error:", err);
      toast.error("Erro ao reavaliar: " + (err.message || "Tente novamente."));
    } finally {
      setReevaluating(null);
    }
  };

  if (isLoading) return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-start">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2"><Shield className="h-5 w-5" /> Auditoria de Decisões da IA</h3>
          <p className="text-sm text-muted-foreground">Registro imutável de todas as decisões tomadas pela IA.</p>
        </div>
        {logs && logs.length > 0 && (
          <Button variant="outline" size="sm" className="gap-1" onClick={() => exportCSV(logs)}>
            <Download className="h-4 w-4" /> Exportar CSV
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={decisionType} onValueChange={setDecisionType}>
          <SelectTrigger className="w-full sm:w-[180px]"><SelectValue placeholder="Tipo de decisão" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="analise">Análise</SelectItem>
            <SelectItem value="bloqueio">Bloqueio</SelectItem>
            <SelectItem value="recomendacao">Recomendação</SelectItem>
          </SelectContent>
        </Select>
        <MaskedDateInput value={ymdToLocalDate(dateFrom)} onChange={(d) => setDateFrom(dateToLocalYMD(d))} format="dd/MM/yyyy" placeholder="Data início" className="sm:w-[160px]" />
        <MaskedDateInput value={ymdToLocalDate(dateTo)} onChange={(d) => setDateTo(dateToLocalYMD(d))} format="dd/MM/yyyy" placeholder="Data fim" className="sm:w-[160px]" />
      </div>

      {!logs?.length ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          <Shield className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p>Nenhum log de decisão encontrado.</p>
        </CardContent></Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>CPF</TableHead>
                <TableHead>Módulo</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Modelo</TableHead>
                <TableHead>Tempo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => (
                <TableRow key={log.id} className="cursor-pointer" onClick={() => setSelectedLog(log)}>
                  <TableCell>{format(new Date(log.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}</TableCell>
                  <TableCell className="font-mono text-sm">{maskCpf(log.cpf)}</TableCell>
                  <TableCell>{log.module}</TableCell>
                  <TableCell>
                    <Badge variant={log.decision_type === "bloqueio" ? "destructive" : log.decision_type === "recomendacao" ? "default" : "secondary"}>
                      {log.decision_type}
                    </Badge>
                  </TableCell>
                  <TableCell><Badge variant="outline">{log.model_provider || "—"}</Badge></TableCell>
                  <TableCell>{log.processing_time_ms ? `${log.processing_time_ms}ms` : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </Card>
      )}

      {/* Detail dialog */}
      <Dialog open={!!selectedLog} onOpenChange={() => setSelectedLog(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
          <DialogHeader><DialogTitle>Detalhes do Log de Decisão</DialogTitle></DialogHeader>
          {selectedLog && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div><strong>CPF:</strong> {maskCpf(selectedLog.cpf)}</div>
                <div><strong>Módulo:</strong> {selectedLog.module}</div>
                <div><strong>Tipo:</strong> <Badge variant="secondary">{selectedLog.decision_type}</Badge></div>
                <div><strong>Modelo:</strong> {selectedLog.model_provider} / {selectedLog.model_version}</div>
                <div><strong>Tempo:</strong> {selectedLog.processing_time_ms}ms</div>
                <div><strong>Data:</strong> {format(new Date(selectedLog.created_at), "dd/MM/yyyy HH:mm:ss", { locale: ptBR })}</div>
              </div>

              <div>
                <h4 className="text-sm font-medium mb-1">Input</h4>
                <pre className="bg-muted p-3 rounded-md text-xs whitespace-pre-wrap max-h-[200px] overflow-auto">
                  {JSON.stringify(selectedLog.input, null, 2)}
                </pre>
              </div>

              <div>
                <h4 className="text-sm font-medium mb-1">Output</h4>
                <pre className="bg-muted p-3 rounded-md text-xs whitespace-pre-wrap max-h-[200px] overflow-auto">
                  {JSON.stringify(selectedLog.output, null, 2)}
                </pre>
              </div>

              {/* FIX #7: Reevaluate button */}
              {selectedLog.application_id && selectedLog.evaluation_id && (
                <div className="flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                  <RefreshCw className="h-4 w-4 text-amber-600 shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Reavaliar com prompt atual</p>
                    <p className="text-xs text-muted-foreground">Reprocessa esta resposta usando a versão ativa do prompt institucional.</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={reevaluating === selectedLog.id}
                    onClick={() => handleReevaluate(selectedLog)}
                    className="gap-1"
                  >
                    {reevaluating === selectedLog.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3 w-3" />
                    )}
                    Reavaliar
                  </Button>
                </div>
              )}

              <div className="text-xs text-muted-foreground">ID: {selectedLog.id}</div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
