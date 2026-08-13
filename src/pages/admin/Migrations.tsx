import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { useMigrationLogs, useOnboardingStatuses, useMigrationMetrics, useResendMigrationInvite } from "@/hooks/useMigration";
import { ArrowRightLeft, CheckCircle2, AlertTriangle, Clock, Download, Loader2, Users, Send, Link2 } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { PageHelp } from "@/components/ui/page-help";
import { FranqueadosImportModal } from "@/components/admin/FranqueadosImportModal";

async function extractEdgeFunctionError(error: any): Promise<string> {
  try {
    if (error?.context && error.context instanceof Response) {
      const body = await error.context.clone().json();
      console.error("[EdgeFunction] Error body:", JSON.stringify(body, null, 2));
      if (body?.debug) {
        const debugStr = typeof body.debug === 'string' ? body.debug : JSON.stringify(body.debug);
        return `${body?.error || error.message} [Debug: ${debugStr}]`;
      }
      return body?.error || error.message;
    }
  } catch (e) {
    console.error("[EdgeFunction] Parse error:", e);
  }
  return error?.message || "Erro desconhecido";
}

const ONBOARDING_STEPS = ["aceitar_termos", "confirmar_dados", "definir_senha"];
const STEP_LABELS: Record<string, string> = {
  aceitar_termos: "Aceitar Termos",
  confirmar_dados: "Confirmar Dados",
  definir_senha: "Definir Senha",
};

function statusBadge(status: string) {
  switch (status) {
    case "completed": return <Badge className="bg-primary/10 text-primary">Concluído</Badge>;
    case "failed": return <Badge variant="destructive">Falhou</Badge>;
    default: return <Badge variant="secondary">Pendente</Badge>;
  }
}

export default function Migrations() {
  const [logFilter, setLogFilter] = useState("all");
  const [onbFilter, setOnbFilter] = useState("all");
  const [onbUnitFilter, setOnbUnitFilter] = useState("all");
  const [onbJobFilter, setOnbJobFilter] = useState("all");
  const [importing, setImporting] = useState(false);
  const [franqueadosModalOpen, setFranqueadosModalOpen] = useState(false);
  const [syncingUnits, setSyncingUnits] = useState(false);
  const [syncingLinks, setSyncingLinks] = useState(false);
  const { data: metrics, isLoading: mLoading } = useMigrationMetrics();
  const { data: logs, isLoading: lLoading } = useMigrationLogs(logFilter);
  const { data: onboardings, isLoading: oLoading } = useOnboardingStatuses(onbFilter);
  const resendInvite = useResendMigrationInvite();

  // Extract unique units and jobs from onboardings for filters
  const onbUnits = Array.from(new Set(
    (onboardings || [])
      .map((o: any) => o.migration_logs?.units?.name)
      .filter(Boolean)
  ));
  const onbJobs = Array.from(new Set(
    (onboardings || [])
      .map((o: any) => o.migration_logs?.jobs?.title)
      .filter(Boolean)
  ));

  // Apply client-side unit/job filters
  const filteredOnboardings = (onboardings || []).filter((onb: any) => {
    if (onbUnitFilter !== "all" && onb.migration_logs?.units?.name !== onbUnitFilter) return false;
    if (onbJobFilter !== "all" && onb.migration_logs?.jobs?.title !== onbJobFilter) return false;
    return true;
  });

  const handleImportAdmins = async () => {
    setImporting(true);
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        toast({ title: "Sessão expirada", description: "Faça login novamente para continuar.", variant: "destructive" });
        setImporting(false);
        return;
      }
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({ title: "Sessão expirada", description: "Faça login novamente para continuar.", variant: "destructive" });
        setImporting(false);
        return;
      }
      const { data, error } = await supabase.functions.invoke("import-erp-admins", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: {},
      });
      if (error) {
        const msg = await extractEdgeFunctionError(error);
        throw new Error(msg);
      }
      const result = data as { imported: number; skipped: number; errors_count?: number; errors?: string[] };
      toast({
        title: "Importação concluída",
        description: `${result.imported} importado(s), ${result.skipped} já existente(s)${(result.errors_count || result.errors?.length) ? `, ${result.errors_count ?? result.errors?.length} erro(s)` : ""}`,
      });
    } catch (err: any) {
      console.error("[Migration] import-admins error:", err);
      toast({
        title: "Erro na importação",
        description: err.message || "Não foi possível importar admins do ERP.",
        variant: "destructive",
      });
    } finally {
      setImporting(false);
    }
  };

  const handleSyncUnits = async () => {
    setSyncingUnits(true);
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        toast({ title: "Sessão expirada", description: "Faça login novamente para continuar.", variant: "destructive" });
        setSyncingUnits(false);
        return;
      }
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({ title: "Sessão expirada", description: "Faça login novamente para continuar.", variant: "destructive" });
        setSyncingUnits(false);
        return;
      }
      const { data, error } = await supabase.functions.invoke("sync-erp-units", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: {},
      });
      if (error) {
        const msg = await extractEdgeFunctionError(error);
        throw new Error(msg);
      }
      const result = data as { created: number; updated: number; errors_count?: number; errors?: string[] };
      toast({
        title: "Sincronização de unidades concluída",
        description: `${result.created} criada(s), ${result.updated} atualizada(s)${(result.errors_count || result.errors?.length) ? `, ${result.errors_count ?? result.errors?.length} erro(s)` : ""}`,
      });
    } catch (err: any) {
      console.error("[Migration] sync-units error:", err);
      toast({
        title: "Erro na sincronização",
        description: err.message || "Não foi possível sincronizar unidades do ERP.",
        variant: "destructive",
      });
    } finally {
      setSyncingUnits(false);
    }
  };

  const handleSyncFranchiseeLinks = async () => {
    setSyncingLinks(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({ title: "Sessão expirada", description: "Faça login novamente.", variant: "destructive" });
        setSyncingLinks(false);
        return;
      }
      const { data, error } = await supabase.functions.invoke("sync-erp-franchisee-units", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: {},
      });
      if (error) {
        const msg = await extractEdgeFunctionError(error);
        throw new Error(msg);
      }
      const result = data as { linked: number; skipped: number; errors: number };
      toast({
        title: "Sincronização de vínculos concluída",
        description: `${result.linked} vinculado(s), ${result.skipped} já ok, ${result.errors} erro(s)`,
      });
    } catch (err: any) {
      console.error("[Migration] sync-franchisee-links error:", err);
      toast({
        title: "Erro na sincronização",
        description: err.message || "Não foi possível sincronizar vínculos.",
        variant: "destructive",
      });
    } finally {
      setSyncingLinks(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Migrações ERP</h1>
          <p className="text-muted-foreground text-sm">Monitoramento de migrações pós-contratação e onboarding.</p>
        </div>
        <PageHelp />
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" onClick={handleSyncUnits} disabled={syncingUnits} variant="outline">
            {syncingUnits ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
            Sincronizar Unidades
          </Button>
          <Button size="sm" onClick={handleImportAdmins} disabled={importing}>
            {importing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
            Importar Admins
          </Button>
          <Button size="sm" onClick={() => setFranqueadosModalOpen(true)} variant="outline">
            <Users className="mr-1.5 h-3.5 w-3.5" />
            Importar Franqueados
          </Button>
          <Button size="sm" onClick={handleSyncFranchiseeLinks} disabled={syncingLinks} variant="outline">
            {syncingLinks ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Link2 className="mr-1.5 h-3.5 w-3.5" />}
            Sincronizar Vínculos
          </Button>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {mLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))
        ) : (
          <>
            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <ArrowRightLeft className="h-8 w-8 text-primary" />
                <div>
                  <p className="text-2xl font-bold">{metrics?.total || 0}</p>
                  <p className="text-xs text-muted-foreground">Total Migrações</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <Clock className="h-8 w-8 text-muted-foreground" />
                <div>
                  <p className="text-2xl font-bold">{metrics?.pending || 0}</p>
                  <p className="text-xs text-muted-foreground">Pendentes</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <CheckCircle2 className="h-8 w-8 text-primary" />
                <div>
                  <p className="text-2xl font-bold">{metrics?.onboardingCompleted || 0}</p>
                  <p className="text-xs text-muted-foreground">Onboardings Concluídos</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <AlertTriangle className="h-8 w-8 text-destructive" />
                <div>
                  <p className="text-2xl font-bold">{metrics?.onboardingStalled || 0}</p>
                  <p className="text-xs text-muted-foreground">Onboardings Atrasados</p>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <Tabs defaultValue="logs" className="space-y-4">
        <TabsList>
          <TabsTrigger value="logs">Migrações</TabsTrigger>
          <TabsTrigger value="onboarding">Onboarding</TabsTrigger>
        </TabsList>

        {/* Migration Logs */}
        <TabsContent value="logs" className="space-y-4">
          <div className="flex justify-end">
            <Select value={logFilter} onValueChange={setLogFilter}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="pending">Pendentes</SelectItem>
                <SelectItem value="completed">Concluídos</SelectItem>
                <SelectItem value="failed">Falharam</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card>
            <CardContent className="p-0">
              {lLoading ? (
                <div className="p-6"><Skeleton className="h-40 w-full" /></div>
              ) : !logs?.length ? (
                <p className="p-6 text-center text-muted-foreground">Nenhuma migração registrada.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Candidato</TableHead>
                      <TableHead>CPF</TableHead>
                      <TableHead>Cargo</TableHead>
                      <TableHead>Unidade</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Data</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log: any) => (
                      <TableRow key={log.id}>
                        <TableCell className="font-medium">{log.profiles?.full_name || "—"}</TableCell>
                        <TableCell className="font-mono text-xs">{log.candidates?.cpf || "—"}</TableCell>
                        <TableCell>{log.jobs?.title || "—"}</TableCell>
                        <TableCell>{log.units?.name || "—"}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            {statusBadge(log.status)}
                            {log.status === "pending" && log.invite_expires_at && new Date(log.invite_expires_at) < new Date() && (
                              <Badge variant="destructive" className="text-[10px]">Expirado</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {format(new Date(log.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Onboarding */}
        <TabsContent value="onboarding" className="space-y-4">
          <div className="flex flex-wrap gap-2 justify-end">
            <Select value={onbFilter} onValueChange={setOnbFilter}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="pending">Em andamento</SelectItem>
                <SelectItem value="completed">Concluídos</SelectItem>
              </SelectContent>
            </Select>
            {onbUnits.length > 0 && (
              <Select value={onbUnitFilter} onValueChange={setOnbUnitFilter}>
                <SelectTrigger className="w-44"><SelectValue placeholder="Unidade" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas unidades</SelectItem>
                  {onbUnits.map((u) => (
                    <SelectItem key={u} value={u}>{u}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {onbJobs.length > 0 && (
              <Select value={onbJobFilter} onValueChange={setOnbJobFilter}>
                <SelectTrigger className="w-44"><SelectValue placeholder="Cargo" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos cargos</SelectItem>
                  {onbJobs.map((j) => (
                    <SelectItem key={j} value={j}>{j}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <Card>
            <CardContent className="p-0">
              {oLoading ? (
                <div className="p-6"><Skeleton className="h-40 w-full" /></div>
              ) : !filteredOnboardings.length ? (
                <p className="p-6 text-center text-muted-foreground">Nenhum onboarding registrado.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Candidato</TableHead>
                      <TableHead>Unidade</TableHead>
                      <TableHead>Cargo</TableHead>
                      <TableHead>Etapa Atual</TableHead>
                      <TableHead>Progresso</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Criado em</TableHead>
                      <TableHead>Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOnboardings.map((onb: any) => {
                      const completed = (onb.steps_completed as string[]) || [];
                      const pct = Math.round((completed.length / ONBOARDING_STEPS.length) * 100);
                      return (
                        <TableRow key={onb.id}>
                          <TableCell className="font-medium">{onb.profiles?.full_name || "—"}</TableCell>
                          <TableCell className="text-sm">{onb.migration_logs?.units?.name || "—"}</TableCell>
                          <TableCell className="text-sm">{onb.migration_logs?.jobs?.title || "—"}</TableCell>
                          <TableCell>{STEP_LABELS[onb.current_step] || onb.current_step}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Progress value={pct} className="h-2 w-24" />
                              <span className="text-xs text-muted-foreground">{pct}%</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            {onb.is_completed
                              ? <Badge className="bg-primary/10 text-primary">Concluído</Badge>
                              : <Badge variant="secondary">Em andamento</Badge>}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {format(new Date(onb.created_at), "dd/MM/yyyy", { locale: ptBR })}
                          </TableCell>
                          <TableCell>
                            {!onb.is_completed && (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={resendInvite.isPending}
                                onClick={() => resendInvite.mutate({
                                  candidateId: onb.candidate_id,
                                  candidateName: onb.profiles?.full_name,
                                  phone: undefined,
                                  email: onb.profiles?.email,
                                })}
                                title="Reenviar convite"
                              >
                                <Send className="h-4 w-4" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <FranqueadosImportModal open={franqueadosModalOpen} onOpenChange={setFranqueadosModalOpen} />
    </div>
  );
}
