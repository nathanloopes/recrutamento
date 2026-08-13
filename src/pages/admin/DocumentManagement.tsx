import { useState, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, CheckCircle, XCircle, Clock, Download, Plus, UserCheck, AlertTriangle, BarChart3, FileCheck, AlertCircle, Send, Mail, TrendingUp, Trophy, FileDown, Upload, Loader2 } from "lucide-react";
import { DocumentDispatchAuditTab } from "@/components/admin/DocumentDispatchAuditTab";
import { DocumentHeatmap } from "@/components/admin/DocumentHeatmap";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line, ResponsiveContainer } from "recharts";
import { DefaultDocumentsTab } from "@/components/admin/settings/DefaultDocumentsTab";
import {
  useAdminDocumentRequests,
  useDocumentUploads,
  useValidateDocument,
  useCompleteHiring,
  useAddCustomDocument,
  useSendDocumentsExternal,
  useAdminAttachDocument,
} from "@/hooks/useDocuments";
import { useSendNotification } from "@/hooks/useNotifications";
import { useDocumentRealtime } from "@/hooks/useDocumentRealtime";
import { useHiringAuditMetrics } from "@/hooks/useHiringAudit";
import { useGlobalSettings } from "@/hooks/useGlobalSettings";
import { supabase } from "@/integrations/supabase/client";
import { getStorageClient } from "@/lib/storageDirect";
import { DEFAULT_DOCUMENT_REJECTION_REASON } from "@/lib/userMessages";
import { toDocNames } from "@/lib/docNames";
import { insertDocumentLog } from "@/hooks/useDocumentLogs";
import { useDocumentTemplates, useToggleDocumentTemplate } from "@/hooks/useDocumentTemplates";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/AuthContext";
import { PageHelp } from "@/components/ui/page-help";
import { AsoSection } from "@/components/admin/AsoSection";
import { useApplicationAso } from "@/hooks/useApplicationAso";
import { CloseProcessDialog } from "@/components/admin/CloseProcessDialog";

export default function DocumentManagement() {
  useDocumentRealtime();
  const { data: requests, isLoading } = useAdminDocumentRequests();
  const { data: auditMetrics, isLoading: auditLoading } = useHiringAuditMetrics();
  const { data: auditSettings } = useGlobalSettings("hiring_audit");
  const { hasRole, unitIds } = useAuth();
  const isSuperAdmin = hasRole("admin");
  const hasGlobalDocumentAccess = hasRole("admin") || hasRole("rh_franqueadora");

  const alertDays = Number(auditSettings?.find((s) => s.key === "auto_alert_after_days")?.value) || 5;
  const criticalDays = Number(auditSettings?.find((s) => s.key === "critical_threshold_days")?.value) || 14;

  const [statusFilter, setStatusFilter] = useState("all");
  const [unitFilter, setUnitFilter] = useState("all");
  const [jobFilter, setJobFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedRequest, setSelectedRequest] = useState<any>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [newCustomDoc, setNewCustomDoc] = useState("");

  const validate = useValidateDocument();
  const completeHiring = useCompleteHiring();
  const addCustomDoc = useAddCustomDocument();
  const sendExternal = useSendDocumentsExternal();
  const sendNotification = useSendNotification();

  // Non-admin: pré-filtrar requisições pelas unidades vinculadas
  const scopedRequests = useMemo(() => {
    if (hasGlobalDocumentAccess || !requests) return requests || [];
    return requests.filter((r: any) => r.unit_id && unitIds.includes(r.unit_id));
  }, [requests, hasGlobalDocumentAccess, unitIds]);

  // Extract unique units and jobs for filters
  const { units, jobs } = useMemo(() => {
    const uMap = new Map<string, string>();
    const jMap = new Map<string, string>();
    for (const r of scopedRequests || []) {
      const ra = r as any;
      if (ra.units?.name) uMap.set(r.unit_id, ra.units.name);
      if (ra.jobs?.title) jMap.set(r.job_id, ra.jobs.title);
    }
    return {
      units: Array.from(uMap.entries()),
      jobs: Array.from(jMap.entries()),
    };
  }, [scopedRequests]);

  const now = Date.now();
  const dayMs = 86400000;

  const getAlertLevel = (r: any): "critical" | "delayed" | null => {
    if (r.status === "completed") return null;
    const deadline = r.deadline_date ? new Date(r.deadline_date).getTime() : null;
    if (deadline && Number.isFinite(deadline)) {
      const overdueDays = (now - deadline) / dayMs;
      if (overdueDays > criticalDays) return "critical";
      if (overdueDays > 0) return "delayed";
      return null;
    }

    const age = (now - new Date(r.created_at).getTime()) / dayMs;
    if (age > criticalDays) return "critical";
    if (age > alertDays) return "delayed";
    return null;
  };

  // Determine if a request has pending uploads awaiting admin review
  const hasPendingUploads = (r: any): boolean => {
    return r.status === "open" && r._uploadStats?.pending > 0;
  };

  const filtered = (scopedRequests || []).filter((r: any) => {
    if (statusFilter === "aguardando") {
      if (!hasPendingUploads(r)) return false;
    } else if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (unitFilter !== "all" && r.unit_id !== unitFilter) return false;
    if (jobFilter !== "all" && r.job_id !== jobFilter) return false;
    if (dateFrom && new Date(r.created_at) < new Date(dateFrom)) return false;
    if (dateTo && new Date(r.created_at) > new Date(dateTo + "T23:59:59")) return false;
    if (search) {
      const name = (r.profiles?.full_name || "").toLowerCase();
      if (!name.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  // Sort: pending uploads first, then by created_at desc
  const sorted = [...filtered].sort((a: any, b: any) => {
    const aPending = hasPendingUploads(a) ? 1 : 0;
    const bPending = hasPendingUploads(b) ? 1 : 0;
    if (bPending !== aPending) return bPending - aPending;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const metrics = {
    total: scopedRequests?.length || 0,
    open: scopedRequests?.filter((r: any) => r.status === "open").length || 0,
    completed: scopedRequests?.filter((r: any) => r.status === "completed").length || 0,
    awaiting: scopedRequests?.filter((r: any) => hasPendingUploads(r)).length || 0,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Documentação para Contratação</h1>
          <p className="text-muted-foreground">Gerencie checklists, valide documentos e audite contratações</p>
        </div>
        <PageHelp />
      </div>

      <Tabs defaultValue="checklists">
        <TabsList>
          <TabsTrigger value="checklists"><FileText className="h-4 w-4 mr-1 shrink-0" /> Checklists</TabsTrigger>
          <TabsTrigger value="templates"><FileText className="h-4 w-4 mr-1 shrink-0" /> Templates</TabsTrigger>
          <TabsTrigger value="auditoria"><BarChart3 className="h-4 w-4 mr-1 shrink-0" /> Auditoria</TabsTrigger>
          {isSuperAdmin && (
            <TabsTrigger value="checklist-padrao"><FileCheck className="h-4 w-4 mr-1 shrink-0" /> Checklist Padrão</TabsTrigger>
          )}
          <TabsTrigger value="envios"><Send className="h-4 w-4 mr-1 shrink-0" /> Envios</TabsTrigger>
        </TabsList>

        {/* ======= ABA CHECKLISTS ======= */}
        <TabsContent value="checklists" className="space-y-4">
          {/* Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <Card><CardContent className="p-4 text-center"><FileText className="h-5 w-5 mx-auto text-primary mb-1" /><p className="text-2xl font-bold">{metrics.total}</p><p className="text-xs text-muted-foreground">Total</p></CardContent></Card>
            <Card><CardContent className="p-4 text-center"><Clock className="h-5 w-5 mx-auto text-yellow-500 mb-1" /><p className="text-2xl font-bold">{metrics.open}</p><p className="text-xs text-muted-foreground">Pendentes</p></CardContent></Card>
            <Card className={metrics.awaiting > 0 ? "border-orange-400 bg-orange-50/50 dark:bg-orange-950/20" : ""}><CardContent className="p-4 text-center"><AlertCircle className={`h-5 w-5 mx-auto mb-1 ${metrics.awaiting > 0 ? "text-orange-500" : "text-muted-foreground"}`} /><p className="text-2xl font-bold">{metrics.awaiting}</p><p className="text-xs text-muted-foreground">Aguardando Aprovação</p></CardContent></Card>
            <Card><CardContent className="p-4 text-center"><CheckCircle className="h-5 w-5 mx-auto text-primary mb-1" /><p className="text-2xl font-bold">{metrics.completed}</p><p className="text-xs text-muted-foreground">Completos</p></CardContent></Card>
          </div>

          {/* Filters */}
          <div className="flex gap-3 flex-wrap">
            <Input placeholder="Buscar por nome..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent disableSearch>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="aguardando">Aguardando Aprovação</SelectItem>
                <SelectItem value="open">Pendentes</SelectItem>
                <SelectItem value="completed">Completos</SelectItem>
              </SelectContent>
            </Select>
            <Select value={unitFilter} onValueChange={setUnitFilter}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Unidade" /></SelectTrigger>
              <SelectContent disableSearch>
                <SelectItem value="all">Todas unidades</SelectItem>
                {units.map(([id, name]) => (
                  <SelectItem key={id} value={id}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={jobFilter} onValueChange={setJobFilter}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Cargo" /></SelectTrigger>
              <SelectContent disableSearch>
                <SelectItem value="all">Todos cargos</SelectItem>
                {jobs.map(([id, title]) => (
                  <SelectItem key={id} value={id}>{title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-36" placeholder="De" title="Data inicial" />
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-36" placeholder="Até" title="Data final" />
          </div>

          {/* Table */}
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <div className="border rounded-lg overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Candidato</TableHead>
                    <TableHead>Cargo</TableHead>
                    <TableHead>Unidade</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Progresso</TableHead>
                    <TableHead>Tempo</TableHead>
                    <TableHead>Criado em</TableHead>
                    <TableHead>Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-8">Nenhum checklist encontrado</TableCell>
                    </TableRow>
                  ) : (
                    sorted.map((r: any) => {
                      const alert = getAlertLevel(r);
                      const isPendingReview = hasPendingUploads(r);
                      return (
                        <TableRow key={r.id} className={isPendingReview ? "bg-orange-50/60 dark:bg-orange-950/20 border-l-4 border-l-orange-400" : ""}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              <span className="name-display">{r.profiles?.full_name || "—"}</span>
                              {isPendingReview && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 px-2 py-0.5 text-[10px] font-semibold">
                                  <AlertCircle className="h-3 w-3" />
                                  {r._uploadStats.pending} doc(s)
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>{r.jobs?.title || "—"}</TableCell>
                          <TableCell>{r.units?.name || "—"}</TableCell>
                          <TableCell>
                            <div className="flex gap-1 flex-wrap">
                              {isPendingReview ? (
                                <Badge className="bg-orange-500 text-white hover:bg-orange-600">
                                  Aguardando Aprovação
                                </Badge>
                              ) : (
                                <Badge variant={r.status === "completed" ? "default" : "outline"}>
                                  {r.status === "completed" ? "Completo" : "Pendente"}
                                </Badge>
                              )}
                              {alert === "critical" && (
                                <Badge variant="destructive">Crítica</Badge>
                              )}
                              {alert === "delayed" && (
                                <Badge className="bg-orange-500 text-white hover:bg-orange-600">Atrasada</Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {(() => {
                              const docs = [...toDocNames(r.documents_list), ...toDocNames(r.custom_documents)];
                              const approved = r._uploadStats?.approved || 0;
                              const pct = docs.length > 0 ? Math.round((approved / docs.length) * 100) : 0;
                              return (
                                <div className="flex items-center gap-2 min-w-[80px]">
                                  <Progress value={pct} className="h-2 flex-1" />
                                  <span className="text-xs text-muted-foreground">{pct}%</span>
                                </div>
                              );
                            })()}
                          </TableCell>
                          <TableCell className="text-xs whitespace-nowrap">
                            {(() => {
                              const days = Math.floor((now - new Date(r.created_at).getTime()) / dayMs);
                              return r.status === "completed" && r.completed_at
                                ? `${Math.floor((new Date(r.completed_at).getTime() - new Date(r.created_at).getTime()) / dayMs)}d`
                                : `${days}d`;
                            })()}
                          </TableCell>
                          <TableCell className="text-xs">{new Date(r.created_at).toLocaleDateString("pt-BR")}</TableCell>
                          <TableCell>
                            <Button size="sm" variant="outline" onClick={() => setSelectedRequest(r)}>
                              <FileText className="h-3 w-3 mr-1" /> Detalhes
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* ======= ABA TEMPLATES ======= */}
        <TabsContent value="templates" className="space-y-4">
          <TemplatesTab canManage={isSuperAdmin} />
        </TabsContent>

        {/* ======= ABA CHECKLIST PADRÃO ======= */}
        {isSuperAdmin && (
          <TabsContent value="checklist-padrao" className="space-y-4">
            <DefaultDocumentsTab />
          </TabsContent>
        )}

        {/* ======= ABA ENVIOS ======= */}
        <TabsContent value="envios" className="space-y-4">
          <DocumentDispatchAuditTab />
        </TabsContent>

        {/* ======= ABA AUDITORIA ======= */}
        <TabsContent value="auditoria" className="space-y-4">
          {auditLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : auditMetrics ? (
            <>
               {/* Alert summary bar */}
               {(() => {
                 const criticalUnits = auditMetrics.unitMetrics.filter(u => u.criticalCount > 0).length;
                 const attentionUnits = auditMetrics.unitMetrics.filter(u => u.hasAlert || u.delayedCount > 0).length;
                 if (criticalUnits === 0 && attentionUnits === 0) return null;
                 return (
                   <div className="flex flex-wrap gap-3 p-3 rounded-lg border bg-muted/40">
                     {criticalUnits > 0 && (
                       <div className="flex items-center gap-2 text-sm">
                         <AlertCircle className="h-4 w-4 text-destructive" />
                         <span className="font-semibold text-destructive">{criticalUnits} unidade{criticalUnits > 1 ? "s" : ""} em estado crítico</span>
                       </div>
                     )}
                     {attentionUnits > 0 && (
                       <div className="flex items-center gap-2 text-sm">
                         <AlertTriangle className="h-4 w-4 text-amber-500" />
                         <span className="font-semibold text-amber-600 dark:text-amber-400">{attentionUnits} unidade{attentionUnits > 1 ? "s" : ""} requerem atenção</span>
                       </div>
                     )}
                   </div>
                 );
               })()}

               {/* Global metric cards */}
               <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                <Card>
                  <CardContent className="p-4 text-center">
                    <FileText className="h-5 w-5 mx-auto text-primary mb-1" />
                    <p className="text-2xl font-bold">{auditMetrics.total}</p>
                    <p className="text-xs text-muted-foreground">Total Contratações</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <CheckCircle className="h-5 w-5 mx-auto text-primary mb-1" />
                    <p className="text-2xl font-bold">{auditMetrics.completionRate}%</p>
                    <p className="text-xs text-muted-foreground">Taxa de Conclusão</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <Clock className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
                    <p className="text-2xl font-bold">{auditMetrics.avgCompletionDays}</p>
                    <p className="text-xs text-muted-foreground">Tempo Médio (dias)</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <FileCheck className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
                    <p className="text-2xl font-bold">{auditMetrics.avgValidationDays}</p>
                    <p className="text-xs text-muted-foreground">Validação Média (dias)</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <XCircle className="h-5 w-5 mx-auto text-destructive mb-1" />
                    <p className="text-2xl font-bold">{auditMetrics.unitMetrics.reduce((s, u) => s + u.rejectionCount, 0)}</p>
                    <p className="text-xs text-muted-foreground">Rejeições Total</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <AlertTriangle className="h-5 w-5 mx-auto text-destructive mb-1" />
                    <p className="text-2xl font-bold">{auditMetrics.criticalCount}</p>
                    <p className="text-xs text-muted-foreground">Críticas</p>
                  </CardContent>
                </Card>
              </div>

              {/* Trend chart — completion rate by unit (bar) */}
              {auditMetrics.unitMetrics.length > 1 && (
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-lg flex items-center gap-2"><TrendingUp className="h-4 w-4" /> Taxa de Conclusão por Unidade</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ChartContainer config={{ completion: { label: "Conclusão %", color: "hsl(var(--primary))" }, avgDays: { label: "Tempo Médio", color: "hsl(var(--destructive))" } }} className="h-[220px] w-full">
                      <BarChart data={auditMetrics.unitMetrics.slice(0, 15).map(u => ({ name: u.unitName.substring(0, 18), completion: u.completionRate, avgDays: u.avgCompletionDays }))}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" fontSize={10} angle={-20} textAnchor="end" height={50} />
                        <YAxis />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Bar dataKey="completion" fill="var(--color-completion)" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="avgDays" fill="var(--color-avgDays)" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ChartContainer>
                  </CardContent>
                </Card>
              )}

              {/* Ranking Top 5 / Bottom 5 */}
              {auditMetrics.unitMetrics.length >= 3 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2 text-primary"><Trophy className="h-4 w-4" /> Top 5 — Melhor Conclusão</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {[...auditMetrics.unitMetrics].sort((a, b) => b.completionRate - a.completionRate).slice(0, 5).map((u, i) => (
                        <div key={u.unitId} className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-2"><span className="font-bold text-primary">{i + 1}º</span> {u.unitName}</span>
                          <Badge variant="default">{u.completionRate}%</Badge>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2 text-destructive"><AlertTriangle className="h-4 w-4" /> Bottom 5 — Atenção Necessária</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {[...auditMetrics.unitMetrics].sort((a, b) => a.completionRate - b.completionRate).slice(0, 5).map((u, i) => (
                        <div key={u.unitId} className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-2"><span className="font-bold text-destructive">{i + 1}º</span> {u.unitName}</span>
                          <Badge variant="destructive">{u.completionRate}%</Badge>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* Heatmap de risco documental */}
              {auditMetrics.unitMetrics.length > 0 && (
                <DocumentHeatmap units={auditMetrics.unitMetrics} />
              )}

              {/* Unit ranking table + CSV/PDF export */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
                  <CardTitle className="text-lg min-w-0">Comparativo por Unidade</CardTitle>
                  <div className="flex gap-2 shrink-0 flex-wrap">
                    <Button variant="outline" size="sm" onClick={() => {
                      if (!auditMetrics?.unitMetrics.length) return;
                      const header = "Unidade,Total,Completas,Pendentes,Conclusão %,Tempo Médio (dias),Validação Média (dias),Rejeições,Atrasadas,Críticas\n";
                      const rows = auditMetrics.unitMetrics.map(u =>
                        `"${u.unitName}",${u.total},${u.completed},${u.open},${u.completionRate},${u.avgCompletionDays},${u.avgValidationDays},${u.rejectionCount},${u.delayedCount},${u.criticalCount}`
                      ).join("\n");
                      const blob = new Blob(["\uFEFF" + header + rows], { type: "text/csv;charset=utf-8;" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url; a.download = `auditoria_documentos_${new Date().toISOString().slice(0, 10)}.csv`;
                      a.click(); URL.revokeObjectURL(url);
                    }}>
                      <Download className="h-4 w-4 mr-1" /> CSV
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => {
                      if (!auditMetrics?.unitMetrics.length) return;
                      const printContent = `
                        <html><head><title>Auditoria Documental</title>
                        <style>
                          body { font-family: Arial, sans-serif; padding: 20px; }
                          h1 { font-size: 18px; margin-bottom: 10px; }
                          h2 { font-size: 14px; color: #666; margin-bottom: 20px; }
                          table { width: 100%; border-collapse: collapse; font-size: 12px; }
                          th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: center; }
                          th { background: #f5f5f5; font-weight: bold; }
                          td:first-child { text-align: left; }
                          .summary { display: flex; gap: 20px; margin-bottom: 20px; }
                          .metric { padding: 10px; border: 1px solid #ddd; border-radius: 4px; text-align: center; }
                          .metric strong { display: block; font-size: 20px; }
                        </style></head><body>
                        <h1>Relatório de Auditoria Documental</h1>
                        <h2>Gerado em ${new Date().toLocaleDateString("pt-BR")} às ${new Date().toLocaleTimeString("pt-BR")}</h2>
                        <div class="summary">
                          <div class="metric"><strong>${auditMetrics.total}</strong>Total</div>
                          <div class="metric"><strong>${auditMetrics.completionRate}%</strong>Conclusão</div>
                          <div class="metric"><strong>${auditMetrics.avgCompletionDays}d</strong>Tempo Médio</div>
                          <div class="metric"><strong>${auditMetrics.avgValidationDays}d</strong>Validação</div>
                          <div class="metric"><strong>${auditMetrics.criticalCount}</strong>Críticas</div>
                        </div>
                        <table>
                          <thead><tr>
                            <th>Unidade</th><th>Total</th><th>Completas</th><th>Pendentes</th>
                            <th>Conclusão</th><th>Tempo Médio</th><th>Validação</th><th>Rejeições</th><th>Atrasadas</th><th>Críticas</th>
                          </tr></thead>
                          <tbody>${auditMetrics.unitMetrics.map(u => `<tr>
                            <td>${u.unitName}</td><td>${u.total}</td><td>${u.completed}</td><td>${u.open}</td>
                            <td>${u.completionRate}%</td><td>${u.avgCompletionDays}d</td><td>${u.avgValidationDays}d</td>
                            <td>${u.rejectionCount}</td><td>${u.delayedCount}</td><td>${u.criticalCount}</td>
                          </tr>`).join("")}</tbody>
                        </table>
                        </body></html>`;
                      const printWindow = window.open("", "_blank");
                      if (printWindow) {
                        printWindow.document.write(printContent);
                        printWindow.document.close();
                        printWindow.print();
                      }
                    }}>
                      <FileDown className="h-4 w-4 mr-1" /> PDF
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {auditMetrics.unitMetrics.length === 0 ? (
                    <p className="text-muted-foreground text-sm text-center py-4">Nenhum dado disponível</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Unidade</TableHead>
                          <TableHead className="text-center">Total</TableHead>
                          <TableHead className="text-center">Completas</TableHead>
                          <TableHead className="text-center">Pendentes</TableHead>
                          <TableHead className="text-center">Conclusão</TableHead>
                          <TableHead className="text-center">Tempo Médio</TableHead>
                          <TableHead className="text-center">Validação</TableHead>
                          <TableHead className="text-center">Rejeições</TableHead>
                          <TableHead className="text-center">Alerta</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {auditMetrics.unitMetrics.map((u) => (
                          <TableRow key={u.unitId}>
                            <TableCell className="font-medium">{u.unitName}</TableCell>
                            <TableCell className="text-center">{u.total}</TableCell>
                            <TableCell className="text-center">{u.completed}</TableCell>
                            <TableCell className="text-center">{u.open}</TableCell>
                            <TableCell className="text-center">
                              <span className={u.completionRate >= 80 ? "text-primary font-semibold" : u.completionRate < 50 ? "text-destructive font-semibold" : ""}>
                                {u.completionRate}%
                              </span>
                            </TableCell>
                            <TableCell className="text-center">{u.avgCompletionDays} dias</TableCell>
                            <TableCell className="text-center">{u.avgValidationDays} dias</TableCell>
                            <TableCell className="text-center">
                              {u.rejectionCount > 0 ? (
                                <Badge variant="destructive">{u.rejectionCount}</Badge>
                              ) : (
                                <span className="text-muted-foreground">0</span>
                              )}
                            </TableCell>
                            <TableCell className="text-center">
                              {u.criticalCount > 0 ? (
                                <Badge variant="destructive">{u.criticalCount} crítica(s)</Badge>
                              ) : u.delayedCount > 0 ? (
                                <Badge className="bg-orange-500 text-white hover:bg-orange-600">{u.delayedCount} atrasada(s)</Badge>
                              ) : u.hasAlert ? (
                                <Badge variant="destructive">Risco Alto</Badge>
                              ) : (
                                <Badge variant="outline">OK</Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </>
          ) : null}
        </TabsContent>
      </Tabs>

      {/* Detail Dialog */}
      {selectedRequest && (
        <RequestDetailDialog
          request={selectedRequest}
          onClose={() => { setSelectedRequest(null); setRejectId(null); setRejectReason(""); }}
          validate={validate}
          completeHiring={completeHiring}
          addCustomDoc={addCustomDoc}
          sendExternal={sendExternal}
          sendNotification={sendNotification}
          rejectId={rejectId}
          setRejectId={setRejectId}
          rejectReason={rejectReason}
          setRejectReason={setRejectReason}
          newCustomDoc={newCustomDoc}
          setNewCustomDoc={setNewCustomDoc}
        />
      )}
    </div>
  );
}

function RequestDetailDialog({
  request, onClose, validate, completeHiring, addCustomDoc, sendExternal, sendNotification,
  rejectId, setRejectId, rejectReason, setRejectReason,
  newCustomDoc, setNewCustomDoc,
}: any) {
  const { user, hasRole } = useAuth();
  const canAttach = hasRole("admin") || hasRole("franqueado") || hasRole("gestor_recrutamento");
  const attach = useAdminAttachDocument();
  const attachInputRef = useRef<HTMLInputElement>(null);
  const [attachDocType, setAttachDocType] = useState<string | null>(null);
  const [closeProcessOpen, setCloseProcessOpen] = useState(false);

  const openAttachPicker = (docType: string) => {
    setAttachDocType(docType);
    attachInputRef.current?.click();
  };
  const handleAttachChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite reanexar o mesmo arquivo
    if (!file || !attachDocType) return;
    try {
      await attach.mutateAsync({
        requestId: request.id,
        candidateId: request.candidate_id,
        documentType: attachDocType,
        file,
        applicationId: request.application_id,
      });
    } finally {
      setAttachDocType(null);
    }
  };

  const [extEmail, setExtEmail] = useState("");
  const [extEmails, setExtEmails] = useState<string[]>([]);
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const addExtEmail = () => {
    const val = extEmail.trim().toLowerCase();
    if (!emailRegex.test(val)) return;
    if (extEmails.includes(val)) { setExtEmail(""); return; }
    if (extEmails.length >= 10) return;
    setExtEmails((prev) => [...prev, val]);
    setExtEmail("");
  };

  const removeExtEmail = (email: string) =>
    setExtEmails((prev) => prev.filter((e) => e !== email));
  const { data: uploads, isLoading } = useDocumentUploads(request.id);
  const { data: aso } = useApplicationAso(request.application_id);
  const asoApproved = aso?.status === "aprovado";

  const allDocs: string[] = [
    ...toDocNames((request as any).documents_list),
    ...toDocNames((request as any).custom_documents),
  ];

  const getUploadForDoc = (docType: string) =>
    (uploads || [])
      .filter((u: any) => u.document_type === docType)
      .sort((a: any, b: any) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime())[0];

  const approvedCount = allDocs.filter((d) => {
    const u = getUploadForDoc(d);
    return u?.status === "approved";
  }).length;

  const progress = allDocs.length > 0 ? Math.round((approvedCount / allDocs.length) * 100) : 0;
  const allApproved = approvedCount === allDocs.length && allDocs.length > 0;

  const handleDownload = async (filePath: string, docType?: string) => {
    const storage = await getStorageClient();
    const { data } = await storage.storage.from("documents").createSignedUrl(filePath, 300);
    if (data?.signedUrl) {
      // Log view/download event
      insertDocumentLog({
        candidate_id: request.candidate_id,
        request_id: request.id,
        document_type: docType,
        event: "visualizado",
        actor_id: user?.id,
        metadata: { file_url: filePath, action: "download" },
      });
      const w = window.open(data.signedUrl, "_blank");
      if (!w) window.location.href = data.signedUrl;
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Documentação — <span className="name-display">{request.profiles?.full_name}</span></DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <input ref={attachInputRef} type="file" className="hidden" onChange={handleAttachChange} />
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>Cargo: {request.jobs?.title}</span>
            <span>Unidade: {request.units?.name}</span>
          </div>

          <div>
            <p className="text-sm text-muted-foreground mb-1">Progresso: {approvedCount}/{allDocs.length}</p>
            <Progress value={progress} className="h-2" />
          </div>

          {isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <div className="space-y-3">
              {allDocs.map((doc) => {
                const upload = getUploadForDoc(doc);
                return (
                  <Card key={doc} className="border">
                    <CardContent className="p-3 flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{doc}</p>
                        {upload ? (
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant={upload.status === "approved" ? "default" : upload.status === "rejected" ? "destructive" : "secondary"}>
                              {upload.status === "approved" ? "Aprovado" : upload.status === "rejected" ? "Revisão necessária" : "Pendente"}
                            </Badge>
                            {upload.rejection_reason && (
                              <span className="text-xs text-destructive">{upload.rejection_reason}</span>
                            )}
                          </div>
                        ) : (
                          <Badge variant="outline" className="mt-1">Não enviado</Badge>
                        )}
                      </div>
                      <div className="flex gap-1 shrink-0 items-center">
                        {upload && (
                          <>
                          <Button size="sm" variant="ghost" onClick={() => handleDownload(upload.file_url, upload.document_type)}>
                            <Download className="h-3 w-3" />
                          </Button>
                          {upload.status === "pending" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-primary"
                              onClick={() => {
                                validate.mutate({ uploadId: upload.id, status: "approved", requestId: request.id });
                                if (request.candidate_id) {
                                  sendNotification.mutate({
                                    eventType: "document_approved",
                                    recipientId: request.candidate_id,
                                    payload: {
                                      nome: request.profiles?.full_name || "",
                                      documento: upload.document_type || "",
                                      _title: "Documento aprovado \u2705",
                                      _body: `Seu documento ${upload.document_type || ""} foi aprovado com sucesso.`,
                                    },
                                  });
                                }
                              }}
                              disabled={validate.isPending}
                            >
                              <CheckCircle className="h-3 w-3" />
                            </Button>
                          )}
                          {(upload.status === "pending" || upload.status === "approved") && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive"
                              onClick={() => { setRejectId(upload.id); setRejectReason(DEFAULT_DOCUMENT_REJECTION_REASON); }}
                            >
                              <XCircle className="h-3 w-3" />
                            </Button>
                          )}
                          </>
                        )}
                        {canAttach && (!upload || upload.status === "rejected") && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs"
                            disabled={attach.isPending && attachDocType === doc}
                            onClick={() => openAttachPicker(doc)}
                          >
                            {attach.isPending && attachDocType === doc ? (
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            ) : (
                              <Upload className="h-3 w-3 mr-1" />
                            )}
                            Anexar
                          </Button>
                        )}
                      </div>
                    </CardContent>
                    {/* Inline reject reason input */}
                    {upload && rejectId === upload.id && (
                      <div className="flex gap-2 px-4 pb-3">
                        <Input
                          placeholder="Motivo da rejeição..."
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          autoFocus
                        />
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={!rejectReason.trim() || validate.isPending}
                          onClick={() => {
                            validate.mutate({ uploadId: rejectId, status: "rejected", rejectionReason: rejectReason, requestId: request.id });
                            if (request.candidate_id) {
                              sendNotification.mutate({
                                eventType: "document_rejected",
                                recipientId: request.candidate_id,
                                payload: {
                                  nome: request.profiles?.full_name || "",
                                  documento: upload.document_type || "",
                                  motivo: rejectReason,
                                   _title: "Documento necessita revisão ⚠️",
                                   _body: `Seu documento ${upload.document_type || ""} precisa de revisão. Motivo: ${rejectReason}`,
                                },
                              });
                            }
                            setRejectId(null);
                            setRejectReason("");
                          }}
                        >
                          Solicitar Revisão
                        </Button>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}

          {/* Add custom doc */}
          <div className="flex gap-2">
            <Input
              placeholder="Adicionar documento extra..."
              value={newCustomDoc}
              onChange={(e) => setNewCustomDoc(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!newCustomDoc.trim() || addCustomDoc.isPending}
              onClick={() => {
                addCustomDoc.mutate({
                  requestId: request.id,
                  documentName: newCustomDoc.trim(),
                  currentCustom: toDocNames((request as any).custom_documents),
                });
                setNewCustomDoc("");
              }}
            >
              <Plus className="h-3 w-3 mr-1" /> Adicionar
            </Button>
          </div>

          {/* ASO — Exame admissional */}
          {request.application_id && request.candidate_id && (
            <AsoSection
              applicationId={request.application_id}
              candidateId={request.candidate_id}
              unitId={request.unit_id}
            />
          )}

          {/* Complete hiring */}
          {allApproved && asoApproved && request.status === "open" && (
            <Button
              className="w-full"
              onClick={() => completeHiring.mutate({ applicationId: request.application_id, requestId: request.id })}
              disabled={completeHiring.isPending}
            >
              <UserCheck className="h-4 w-4 mr-2" />
              {completeHiring.isPending ? "Finalizando..." : "Finalizar Contratação"}
            </Button>
          )}

          {/* Send documents to external email */}
          {allApproved && (
            <div className="border rounded-lg p-4 space-y-3 bg-blue-50/40 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
              <div className="flex items-center gap-2 text-sm font-semibold text-blue-800 dark:text-blue-200">
                <Mail className="h-4 w-4" />
                Enviar Documentação
              </div>
              <p className="text-xs text-muted-foreground">
                Envie os documentos aprovados para emails externos (ex: contabilidade, jurídico).
                Adicione quantos destinatários precisar.
              </p>

              {/* Lista de emails adicionados */}
              {extEmails.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {extEmails.map((email) => (
                    <span
                      key={email}
                      className="inline-flex items-center gap-1 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 text-xs px-2.5 py-1 font-medium"
                    >
                      {email}
                      <button
                        type="button"
                        onClick={() => removeExtEmail(email)}
                        className="ml-0.5 hover:text-destructive transition-colors"
                        aria-label={`Remover ${email}`}
                      >
                        <XCircle className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Campo para adicionar email */}
              <div className="flex gap-2">
                <Input
                  type="email"
                  placeholder="Ex: contabilidade@empresa.com"
                  value={extEmail}
                  onChange={(e) => setExtEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addExtEmail()}
                  disabled={sendExternal.isPending || extEmails.length >= 10}
                  className="flex-1"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    !extEmail.trim() ||
                    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(extEmail.trim()) ||
                    extEmails.length >= 10 ||
                    sendExternal.isPending
                  }
                  onClick={addExtEmail}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Adicionar
                </Button>
              </div>

              {extEmails.length >= 10 && (
                <p className="text-xs text-amber-600">Máximo de 10 destinatários atingido.</p>
              )}

              {/* Botão de envio */}
              <Button
                className="w-full"
                disabled={extEmails.length === 0 || sendExternal.isPending}
                onClick={() => {
                  sendExternal.mutate(
                    { requestId: request.id, destinationEmails: extEmails },
                    { onSuccess: () => setExtEmails([]) },
                  );
                }}
              >
                <Send className="h-4 w-4 mr-2" />
                {sendExternal.isPending
                  ? "Enviando..."
                  : `Enviar para ${extEmails.length} destinatário${extEmails.length !== 1 ? "s" : ""}`}
              </Button>
            </div>
          )}

          {/* Encerrar processo do candidato — fluxo reaproveitado do painel do candidato */}
          {canAttach && request.application_id && (
            <div className="border border-destructive/30 rounded-lg p-4 space-y-2">
              <p className="text-xs text-muted-foreground">
                Não quer mais seguir com este candidato? Encerre o processo. Ele sai do board
                operacional, mas continua no Banco de Talentos e pode ser reativado.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="border-destructive/40 text-destructive hover:bg-destructive/10"
                onClick={() => setCloseProcessOpen(true)}
              >
                <XCircle className="h-3.5 w-3.5 mr-1" /> Encerrar processo
              </Button>
            </div>
          )}

          <CloseProcessDialog
            applicationId={request.application_id}
            open={closeProcessOpen}
            onOpenChange={setCloseProcessOpen}
            onClosed={onClose}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TemplatesTab({ canManage = true }: { canManage?: boolean }) {
  const { data: templates, isLoading } = useDocumentTemplates();
  const toggleTemplate = useToggleDocumentTemplate();

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Templates Institucionais</CardTitle>
        </CardHeader>
        <CardContent>
          {(templates || []).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Nenhum template criado. Configure em Configurações &gt; Documentos.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Versão</TableHead>
                  <TableHead>Status</TableHead>
                  {canManage && <TableHead>Ativo</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(templates || []).map((t: any) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell><Badge variant="outline">{t.category}</Badge></TableCell>
                    <TableCell>v{t.version}</TableCell>
                    <TableCell>
                      <Badge variant={t.is_active ? "default" : "secondary"}>
                        {t.is_active ? "Ativo" : "Inativo"}
                      </Badge>
                    </TableCell>
                    {canManage && (
                      <TableCell>
                        <Switch
                          checked={t.is_active}
                          onCheckedChange={(v) => toggleTemplate.mutate({ id: t.id, is_active: v })}
                        />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
