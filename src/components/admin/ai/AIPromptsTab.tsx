import { useState } from "react";
import { usePromptVersions, useCreatePromptVersion, useActivatePromptVersion, type AIPromptVersion } from "@/hooks/useAIPrompts";
import { useGlobalSettings } from "@/hooks/useGlobalSettings";
import { DoubleConfirmDialog } from "@/components/admin/DoubleConfirmDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Plus, CheckCircle, FileText, GitCompare } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const SCOPE_LABELS: Record<string, string> = {
  global: "Global",
  cargo: "Cargo específico",
  etapa: "Etapa específica",
  midia: "Tipo de mídia",
};

const STATUS_LABELS: Record<string, string> = {
  rascunho: "Rascunho",
  ativo: "Ativo",
  arquivado: "Arquivado",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  ativo: "default",
  rascunho: "secondary",
  arquivado: "outline",
};

export function AIPromptsTab() {
  const { data: versions, isLoading } = usePromptVersions();
  const { data: govSettings } = useGlobalSettings("ai_governance");
  const createVersion = useCreatePromptVersion();
  const activateVersion = useActivatePromptVersion();
  const [newPrompt, setNewPrompt] = useState("");
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newScope, setNewScope] = useState("global");
  const [showCreate, setShowCreate] = useState(false);
  const [confirmActivate, setConfirmActivate] = useState<AIPromptVersion | null>(null);
  const [viewPrompt, setViewPrompt] = useState<AIPromptVersion | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [compareA, setCompareA] = useState<AIPromptVersion | null>(null);
  const [compareB, setCompareB] = useState<AIPromptVersion | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const promptLockSetting = govSettings?.find((s) => s.key === "ai_prompt_lock");
  const isPromptLocked = promptLockSetting?.value === true || promptLockSetting?.value === "true";

  const handleCreate = () => {
    if (!newPrompt.trim()) return;
    createVersion.mutate(
      { prompt_text: newPrompt, name: newName, description: newDescription, target_scope: newScope },
      {
        onSuccess: () => {
          setNewPrompt("");
          setNewName("");
          setNewDescription("");
          setNewScope("global");
          setShowCreate(false);
        },
      }
    );
  };

  const handleActivate = () => {
    if (!confirmActivate) return;
    activateVersion.mutate({ id: confirmActivate.id }, {
      onSuccess: () => setConfirmActivate(null),
    });
    setConfirmActivate(null);
  };

  const filtered = versions?.filter((v) => statusFilter === "all" || v.status === statusFilter);

  if (isLoading) return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      {isPromptLocked && (
        <Alert variant="destructive" className="border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>Edição de prompts bloqueada pelo CrossConfig. Não é possível criar ou ativar versões.</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:justify-between sm:items-center gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold">Versões de Prompt</h3>
          <p className="text-sm text-muted-foreground">Gerencie os prompts institucionais da IA. Cada alteração gera uma nova versão.</p>
        </div>
        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="rascunho">Rascunho</SelectItem>
              <SelectItem value="ativo">Ativo</SelectItem>
              <SelectItem value="arquivado">Arquivado</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => setCompareMode(true)} className="gap-1 flex-1 sm:flex-none"><GitCompare className="h-4 w-4" /> Comparar</Button>
          <Button onClick={() => setShowCreate(true)} className="gap-1 flex-1 sm:flex-none" disabled={isPromptLocked}><Plus className="h-4 w-4" /> Nova Versão</Button>
        </div>
      </div>

      {!filtered?.length ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          <FileText className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p>Nenhuma versão de prompt encontrada.</p>
        </CardContent></Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Versão</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Escopo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Prompt (início)</TableHead>
                <TableHead>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((v) => (
                <TableRow key={v.id} className={v.status === "ativo" ? "bg-primary/5 border-l-2 border-l-primary" : ""}>
                  <TableCell className="font-mono font-bold">v{v.version}</TableCell>
                  <TableCell className="max-w-[120px] truncate">{v.name || "—"}</TableCell>
                  <TableCell><Badge variant="outline">{SCOPE_LABELS[v.target_scope] || v.target_scope}</Badge></TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[v.status] || "secondary"}>
                      {STATUS_LABELS[v.status] || v.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{format(new Date(v.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}</TableCell>
                  <TableCell className="max-w-[200px] sm:max-w-[300px] truncate text-sm text-muted-foreground cursor-pointer" onClick={() => setViewPrompt(v)}>
                    {v.prompt_text.slice(0, 80)}...
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setViewPrompt(v)}>Ver</Button>
                      {v.status !== "ativo" && (
                        <Button variant="default" size="sm" className="gap-1" onClick={() => setConfirmActivate(v)} disabled={isPromptLocked}>
                          <CheckCircle className="h-3 w-3" /> Ativar
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </Card>
      )}

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Nova Versão de Prompt</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Nome do Prompt</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ex: Análise comportamental v2" />
              </div>
              <div className="space-y-1">
                <Label>Escopo</Label>
                <Select value={newScope} onValueChange={setNewScope}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="global">Global</SelectItem>
                    <SelectItem value="cargo">Cargo específico</SelectItem>
                    <SelectItem value="etapa">Etapa específica</SelectItem>
                    <SelectItem value="midia">Tipo de mídia</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Descrição institucional</Label>
              <Input value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="Descreva o propósito deste prompt" />
            </div>
            <div className="space-y-1">
              <Label>Prompt completo</Label>
              <Textarea rows={10} value={newPrompt} onChange={(e) => setNewPrompt(e.target.value)} placeholder="Cole aqui o novo prompt institucional da IA..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={!newPrompt.trim() || createVersion.isPending}>
              {createVersion.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null} Criar Versão
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm activation with double confirm */}
      <DoubleConfirmDialog
        open={!!confirmActivate}
        onOpenChange={(open) => { if (!open) setConfirmActivate(null); }}
        title={`Ativar Prompt v${confirmActivate?.version}?`}
        description="O prompt atual será arquivado e esta versão passará a ser usada em todas as avaliações da IA. Esta é uma ação crítica."
        confirmWord="CONFIRMAR"
        onConfirm={handleActivate}
      />

      {/* View prompt */}
      <Dialog open={!!viewPrompt} onOpenChange={() => setViewPrompt(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Prompt v{viewPrompt?.version} {viewPrompt?.name && `— ${viewPrompt.name}`}{" "}
              <Badge className="ml-2" variant={STATUS_VARIANT[viewPrompt?.status ?? ""] || "secondary"}>
                {STATUS_LABELS[viewPrompt?.status ?? ""] || viewPrompt?.status}
              </Badge>
            </DialogTitle>
          </DialogHeader>
          {viewPrompt?.description && (
            <p className="text-sm text-muted-foreground">{viewPrompt.description}</p>
          )}
          <div className="flex gap-2 text-xs">
            <Badge variant="outline">Escopo: {SCOPE_LABELS[viewPrompt?.target_scope ?? ""] || viewPrompt?.target_scope}</Badge>
          </div>
          <pre className="bg-muted p-4 rounded-md text-sm whitespace-pre-wrap max-h-[400px] overflow-auto">{viewPrompt?.prompt_text}</pre>
        </DialogContent>
      </Dialog>

      {/* Compare prompts diff */}
      <Dialog open={compareMode} onOpenChange={setCompareMode}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-auto">
          <DialogHeader><DialogTitle>Comparar Versões de Prompt</DialogTitle></DialogHeader>
          <div className="flex gap-2 mb-4">
            <Select value={compareA?.id || ""} onValueChange={(id) => setCompareA(versions?.find(v => v.id === id) || null)}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Versão A" /></SelectTrigger>
              <SelectContent>
                {versions?.map(v => <SelectItem key={v.id} value={v.id}>v{v.version} {v.name ? `— ${v.name}` : ""} {v.status === "ativo" ? "(Ativo)" : ""}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={compareB?.id || ""} onValueChange={(id) => setCompareB(versions?.find(v => v.id === id) || null)}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Versão B" /></SelectTrigger>
              <SelectContent>
                {versions?.map(v => <SelectItem key={v.id} value={v.id}>v{v.version} {v.name ? `— ${v.name}` : ""} {v.status === "ativo" ? "(Ativo)" : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {compareA && compareB && (
            <PromptDiffView textA={compareA.prompt_text} textB={compareB.prompt_text} labelA={`v${compareA.version}`} labelB={`v${compareB.version}`} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PromptDiffView({ textA, textB, labelA, labelB }: { textA: string; textB: string; labelA: string; labelB: string }) {
  const linesA = textA.split("\n");
  const linesB = textB.split("\n");
  const maxLen = Math.max(linesA.length, linesB.length);

  return (
    <div className="grid grid-cols-2 gap-2 text-xs font-mono">
      <div>
        <p className="font-semibold text-sm mb-2 text-foreground">{labelA}</p>
        <div className="border rounded p-2 bg-muted/30 max-h-[60vh] overflow-auto space-y-0">
          {Array.from({ length: maxLen }).map((_, i) => {
            const lineA = linesA[i] ?? "";
            const lineB = linesB[i] ?? "";
            const isDiff = lineA !== lineB;
            return (
              <div key={i} className={`px-1 py-0.5 ${isDiff ? "bg-red-100 dark:bg-red-950/30" : ""}`}>
                <span className="text-muted-foreground mr-2 select-none">{i + 1}</span>
                {lineA}
              </div>
            );
          })}
        </div>
      </div>
      <div>
        <p className="font-semibold text-sm mb-2 text-foreground">{labelB}</p>
        <div className="border rounded p-2 bg-muted/30 max-h-[60vh] overflow-auto space-y-0">
          {Array.from({ length: maxLen }).map((_, i) => {
            const lineA = linesA[i] ?? "";
            const lineB = linesB[i] ?? "";
            const isDiff = lineA !== lineB;
            return (
              <div key={i} className={`px-1 py-0.5 ${isDiff ? "bg-emerald-100 dark:bg-emerald-950/30" : ""}`}>
                <span className="text-muted-foreground mr-2 select-none">{i + 1}</span>
                {linesB[i] ?? ""}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
