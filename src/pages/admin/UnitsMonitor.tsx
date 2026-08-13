import { useState, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Building2, Users, Briefcase, TrendingUp, ChevronDown, ChevronRight, AlertTriangle, Search, UserX, Download, Clock, Bell, FileBarChart, LayoutList, LayoutGrid, Loader2, Plus } from "lucide-react";
import { ManualUnitDialog } from "@/components/admin/ManualUnitDialog";
import { useGlobalSettings } from "@/hooks/useGlobalSettings";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useUnitMonitoringData, useUnitJobDetail, type UnitMetrics } from "@/hooks/useUnitMonitoring";
import { safeToast } from "@/lib/safeToast";
import UnitDetailPanel from "@/components/admin/UnitDetailPanel";
import MetricDetailDialog from "@/components/admin/MetricDetailDialog";
import { UnitTrendCharts } from "@/components/admin/UnitTrendCharts";
import { UnitHeatmap } from "@/components/admin/UnitHeatmap";
import { AIDiagnosticPanel } from "@/components/admin/AIDiagnosticPanel";
import { useUnitMonitoringRealtime } from "@/hooks/useUnitMonitoringRealtime";
import { format } from "date-fns";
import { PageHelp } from "@/components/ui/page-help";
import { useUnitAlertNotifications } from "@/hooks/useUnitAlertNotifications";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

function UnitJobsExpanded({ unitId }: { unitId: string }) {
  const { data: jobs, isLoading } = useUnitJobDetail(unitId);

  if (isLoading) return <div className="p-4 text-sm text-muted-foreground">Carregando vagas...</div>;
  if (!jobs?.length) return <div className="p-4 text-sm text-muted-foreground">Nenhuma vaga encontrada.</div>;

  const statusLabel: Record<string, string> = {
    aberta: "Aberta", pausada: "Pausada", encerrada: "Encerrada", preenchida: "Preenchida",
  };

  return (
    <div className="bg-muted/30 p-4 space-y-2">
      <p className="text-sm font-medium text-muted-foreground mb-2">Vagas desta unidade</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Cargo</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Abertura</TableHead>
            <TableHead className="text-right">Candidatos</TableHead>
            <TableHead>Alerta</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((j) => (
            <TableRow key={j.id}>
              <TableCell className="font-medium">{j.jobTitle}</TableCell>
              <TableCell>
                <Badge variant={j.status === "aberta" ? "default" : "secondary"}>
                  {statusLabel[j.status] || j.status}
                </Badge>
              </TableCell>
              <TableCell>{format(new Date(j.createdAt), "dd/MM/yyyy")}</TableCell>
              <TableCell className="text-right">{j.candidates}</TableCell>
              <TableCell>
                {j.isStalled && (
                  <Badge variant="destructive" className="text-xs">Parada</Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function VagaByVagaListing() {
  const [search, setSearch] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["unit_jobs_global_listing"],
    queryFn: async () => {
      const { data: jobs, error } = await supabase
        .from("unit_jobs")
        .select("id, status, created_at, job_id, unit_id, jobs(title), units(name, city, state)")
        .eq("status", "aberta")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      if (!jobs?.length) return [];
      const jobIds = jobs.map((j: any) => j.id);
      const { data: apps } = await supabase
        .from("applications")
        .select("unit_job_id, status, current_phase, pipeline_phases:current_phase(name)")
        .in("unit_job_id", jobIds);
      const appsByJob: Record<string, any[]> = {};
      (apps || []).forEach((a: any) => {
        if (!appsByJob[a.unit_job_id]) appsByJob[a.unit_job_id] = [];
        appsByJob[a.unit_job_id].push(a);
      });
      return jobs.map((j: any) => {
        const jobApps = appsByJob[j.id] || [];
        const phases: Record<string, number> = {};
        jobApps.forEach((a: any) => {
          const pName = (a.pipeline_phases as any)?.name || a.status || "—";
          phases[pName] = (phases[pName] || 0) + 1;
        });
        const topPhase = Object.entries(phases).sort((a, b) => b[1] - a[1])[0];
        return {
          id: j.id,
          unit: (j.units as any)?.name || "—",
          city: (j.units as any)?.city || "",
          state: (j.units as any)?.state || "",
          cargo: (j.jobs as any)?.title || "—",
          status: j.status,
          createdAt: j.created_at,
          candidates: jobApps.length,
          currentPhase: topPhase ? `${topPhase[0]} (${topPhase[1]})` : "—",
          daysOpen: Math.floor((Date.now() - new Date(j.created_at).getTime()) / 86400000),
        };
      });
    },
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    if (!search) return data;
    const s = search.toLowerCase();
    return data.filter((d) => d.unit.toLowerCase().includes(s) || d.cargo.toLowerCase().includes(s) || d.city.toLowerCase().includes(s));
  }, [data, search]);

  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0 flex-1">
          <CardTitle className="text-lg">Listagem Vaga por Vaga</CardTitle>
          <CardDescription>Todas as vagas abertas da rede com fase atual e candidatos</CardDescription>
        </div>
        <div className="relative w-full sm:w-auto sm:shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 w-full sm:w-[200px]" />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : (
          <div className="overflow-x-auto -mx-6 px-6 sm:mx-0 sm:px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Unidade</TableHead>
                <TableHead>Cargo</TableHead>
                <TableHead>Cidade/UF</TableHead>
                <TableHead>Abertura</TableHead>
                <TableHead className="text-right">Candidatos</TableHead>
                <TableHead>Fase Atual</TableHead>
                <TableHead>Dias Aberta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Nenhuma vaga encontrada.</TableCell></TableRow>
              ) : filtered.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-medium">{v.unit}</TableCell>
                  <TableCell>{v.cargo}</TableCell>
                  <TableCell className="text-sm">{v.city}{v.state ? `/${v.state}` : ""}</TableCell>
                  <TableCell className="text-sm">{format(new Date(v.createdAt), "dd/MM/yyyy")}</TableCell>
                  <TableCell className="text-right">{v.candidates}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{v.currentPhase}</Badge></TableCell>
                  <TableCell className={v.daysOpen > 14 ? "text-destructive font-medium" : ""}>{v.daysOpen}d</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AlertasTab() {
  const { data: alerts, isLoading } = useQuery({
    queryKey: ["unit_monitoring_alerts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .in("event_type", ["unit_job_stalled", "high_rejection_rate", "delayed_response", "candidate_auto_blocked"])
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data || [];
    },
  });

  const typeLabels: Record<string, string> = {
    unit_job_stalled: "Vaga Parada",
    high_rejection_rate: "Alta Rejeição",
    delayed_response: "Resposta Atrasada",
    candidate_auto_blocked: "Candidato Bloqueado",
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2"><Bell className="h-5 w-5" /> Alertas Disparados</CardTitle>
        <CardDescription>Alertas automáticos gerados por triggers do sistema</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : !alerts?.length ? (
          <p className="text-center text-muted-foreground py-8">Nenhum alerta registrado.</p>
        ) : (
          <div className="overflow-x-auto -mx-6 px-6 sm:mx-0 sm:px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Título</TableHead>
                <TableHead>Mensagem</TableHead>
                <TableHead>Data</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {alerts.map((a: any) => (
                <TableRow key={a.id}>
                  <TableCell><Badge variant="destructive" className="text-xs">{typeLabels[a.event_type] || a.event_type}</Badge></TableCell>
                  <TableCell className="font-medium text-sm">{a.title}</TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-[300px] truncate">{a.body}</TableCell>
                  <TableCell className="text-sm">{format(new Date(a.created_at), "dd/MM/yyyy HH:mm")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RelatoriosTab() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const triggerReport = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("weekly-monitoring-report", { body: { manual: true } });
      if (error) throw error;
      setResult(data);
      toast.success("Relatório gerado com sucesso!");
    } catch (e) {
      safeToast.error(e);
    } finally {
      setLoading(false);
    }
  };

  const { data: snapshots } = useQuery({
    queryKey: ["metrics_snapshots_history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("metrics_snapshots")
        .select("id, created_at, period, total_candidates, total_jobs_open, conversion_rate, rejection_rate, avg_hiring_time_days")
        .is("unit_id", null)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data || [];
    },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-lg flex items-center gap-2"><FileBarChart className="h-5 w-5" /> Relatórios de Monitoramento</CardTitle>
            <CardDescription>Gere relatórios sob demanda ou consulte snapshots históricos</CardDescription>
          </div>
          <Button onClick={triggerReport} disabled={loading} className="w-full sm:w-auto">
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileBarChart className="h-4 w-4 mr-2" />}
            Gerar Relatório Agora
          </Button>
        </CardHeader>
        <CardContent>
          {result && (
            <div className="rounded-lg border p-4 mb-4 bg-muted/30">
              <h4 className="font-medium mb-2">Resultado do Relatório</h4>
              <pre className="text-xs whitespace-pre-wrap max-h-[300px] overflow-auto">{JSON.stringify(result, null, 2)}</pre>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Snapshots Históricos</CardTitle>
          <CardDescription>Métricas capturadas automaticamente pelo cron diário</CardDescription>
        </CardHeader>
        <CardContent>
          {!snapshots?.length ? (
            <p className="text-center text-muted-foreground py-8">Nenhum snapshot disponível.</p>
          ) : (
            <div className="overflow-x-auto -mx-6 px-6 sm:mx-0 sm:px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Gerado em</TableHead>
                  <TableHead>Dados</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshots.map((s: any) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{format(new Date(s.created_at), "dd/MM/yyyy")}</TableCell>
                    <TableCell className="text-sm">{format(new Date(s.created_at), "HH:mm")}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[400px] truncate">
                      Candidatos: {s.total_candidates} · Vagas: {s.total_jobs_open} · Conversão: {s.conversion_rate}% · Rejeição: {s.rejection_rate}% · Tempo médio: {s.avg_hiring_time_days}d
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function UnitsMonitor() {
  const { data, isLoading } = useUnitMonitoringData();
  useUnitMonitoringRealtime();

  const [stateFilter, setStateFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [jobFilter, setJobFilter] = useState<string>("all");
  const [openDaysFilter, setOpenDaysFilter] = useState<string>("all");
  const [expandedUnit, setExpandedUnit] = useState<string | null>(null);
  const [selectedUnit, setSelectedUnit] = useState<{ id: string; metrics: UnitMetrics } | null>(null);
  const [metricDetail, setMetricDetail] = useState<"withdrawal" | "rejection" | null>(null);

  const units = data?.units || [];
  const aiDiagnosticsEnabled = data?.config?.aiDiagnosticsEnabled ?? false;
  const alertChannels = data?.config?.alertChannels;
  useUnitAlertNotifications(
    units.length > 0 ? units : undefined,
    alertChannels ? { alertChannels } : undefined
  );

  const states = useMemo(() => {
    return [...new Set(units.map((u) => u.state).filter(Boolean))].sort() as string[];
  }, [units]);

  const jobTitles = useMemo(() => {
    return [...new Set(units.flatMap((u) => u.jobTitles || []))].sort();
  }, [units]);

  const filtered = useMemo(() => {
    return units.filter((u) => {
      if (stateFilter !== "all" && u.state !== stateFilter) return false;
      if (statusFilter === "alerta" && u.alerts.length === 0) return false;
      if (statusFilter === "sem_alerta" && u.alerts.length > 0) return false;
      if (jobFilter !== "all" && !(u.jobTitles || []).includes(jobFilter)) return false;
      if (openDaysFilter !== "all") {
        const days = Number(openDaysFilter);
        if (u.oldestOpenJobDays < days) return false;
      }
      if (search) {
        const s = search.toLowerCase();
        if (!u.name.toLowerCase().includes(s)
          && !(u.city && u.city.toLowerCase().includes(s))
          && !(u.state && u.state.toLowerCase().includes(s))) return false;
      }
      return true;
    });
  }, [units, stateFilter, statusFilter, jobFilter, openDaysFilter, search]);

  const exportCSV = useCallback(() => {
    const headers = ["Unidade", "Cidade", "Estado", "Vagas Abertas", "Candidatos", "Contratados", "Standby", "Desistentes", "Conversão%", "Standby%", "Desistência%", "Score Médio", "Tempo Médio (dias)", "Vagas Paradas", "Alertas"];
    const rows = filtered.map((u) => [
      u.name, u.city || "", u.state || "", u.openJobs, u.totalCandidates, u.hired, u.rejected, u.withdrawn,
      u.conversionRate, u.rejectionRate, u.withdrawalRate, u.avgScore, u.avgDays, u.stalledJobs, u.alerts.join("; ")
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.map((v) => `"${v}"`).join(","))].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `monitoramento_unidades_${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filtered]);

  const totalActive = filtered.length;
  const totalOpenJobs = filtered.reduce((sum, u) => sum + u.openJobs, 0);
  const totalCandidates = filtered.reduce((sum, u) => sum + u.totalCandidates, 0);
  const totalHired = filtered.reduce((sum, u) => sum + u.hired, 0);
  const totalRejected = filtered.reduce((sum, u) => sum + u.rejected, 0);
  const totalWithdrawn = filtered.reduce((sum, u) => sum + u.withdrawn, 0);
  const avgConversion = totalCandidates > 0 ? Math.round((totalHired / totalCandidates) * 100) : 0;
  const avgRejection = totalCandidates > 0 ? Math.round((totalRejected / totalCandidates) * 100) : 0;
  const avgWithdrawal = totalCandidates > 0 ? Math.round((totalWithdrawn / totalCandidates) * 100) : 0;

  // Ranking for comparison tab
  const ranked = useMemo(() => {
    return [...filtered]
      .filter((u) => u.totalCandidates > 0)
      .sort((a, b) => b.conversionRate - a.conversionRate);
  }, [filtered]);

  // Ranking by rejection rate
  const rankedByRejection = useMemo(() => {
    return [...filtered]
      .filter((u) => u.totalCandidates > 0)
      .sort((a, b) => b.rejectionRate - a.rejectionRate);
  }, [filtered]);

  // Ranking by withdrawal rate
  const rankedByWithdrawal = useMemo(() => {
    return [...filtered]
      .filter((u) => u.totalCandidates > 0)
      .sort((a, b) => b.withdrawalRate - a.withdrawalRate);
  }, [filtered]);

  const { hasRole } = useAuth();
  const { data: unitSettings } = useGlobalSettings("units");
  const allowManualCreate = unitSettings?.find((s) => s.key === "allow_manual_unit_create")?.value === true
    || unitSettings?.find((s) => s.key === "allow_manual_unit_create")?.value === "true";
  const canCreateManual = hasRole("admin") && allowManualCreate;
  const [showManualDialog, setShowManualDialog] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-2xl font-bold text-foreground">Monitoramento Territorial</h2>
        <div className="flex items-center gap-2">
          {canCreateManual && (
            <Button size="sm" onClick={() => setShowManualDialog(true)}>
              <Plus className="h-4 w-4 mr-1" /> Nova Unidade Manual
            </Button>
          )}
          <PageHelp />
        </div>
      </div>
      <ManualUnitDialog open={showManualDialog} onOpenChange={setShowManualDialog} />

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Visão Geral</TabsTrigger>
          <TabsTrigger value="vagas"><LayoutList className="h-3.5 w-3.5 mr-1" />Vagas</TabsTrigger>
          <TabsTrigger value="trends">Tendências</TabsTrigger>
          <TabsTrigger value="heatmap">Heatmap</TabsTrigger>
          <TabsTrigger value="comparison">Comparativo</TabsTrigger>
          <TabsTrigger value="alertas"><Bell className="h-3.5 w-3.5 mr-1" />Alertas</TabsTrigger>
          <TabsTrigger value="relatorios"><FileBarChart className="h-3.5 w-3.5 mr-1" />Relatórios</TabsTrigger>
          <TabsTrigger value="ai">IA Diagnóstico</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {/* Metric cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Card>
              <CardContent className="pt-6 flex items-center gap-3">
                <Building2 className="h-8 w-8 text-primary" />
                <div>
                  <p className="text-2xl font-bold">{totalActive}</p>
                  <p className="text-sm text-muted-foreground">Unidades ativas</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 flex items-center gap-3">
                <Briefcase className="h-8 w-8 text-primary" />
                <div>
                  <p className="text-2xl font-bold">{totalOpenJobs}</p>
                  <p className="text-sm text-muted-foreground">Vagas abertas</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 flex items-center gap-3">
                <Users className="h-8 w-8 text-primary" />
                <div>
                  <p className="text-2xl font-bold">{totalCandidates}</p>
                  <p className="text-sm text-muted-foreground">Candidatos</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 flex items-center gap-3">
                <TrendingUp className="h-8 w-8 text-primary" />
                <div>
                  <p className="text-2xl font-bold">{avgConversion}%</p>
                  <p className="text-sm text-muted-foreground">Conversão média</p>
                </div>
              </CardContent>
            </Card>
            <Card
              className="cursor-pointer transition-shadow hover:shadow-md hover:ring-1 hover:ring-destructive/30"
              onClick={() => setMetricDetail("rejection")}
            >
              <CardContent className="pt-6 flex items-center gap-3">
                <AlertTriangle className="h-8 w-8 text-destructive" />
                <div>
                  <p className="text-2xl font-bold">{avgRejection}%</p>
                  <p className="text-sm text-muted-foreground">Standby médio</p>
                  <p className="text-xs text-muted-foreground/70">Clique para detalhes</p>
                </div>
              </CardContent>
            </Card>
            <Card
              className="cursor-pointer transition-shadow hover:shadow-md hover:ring-1 hover:ring-amber-500/30"
              onClick={() => setMetricDetail("withdrawal")}
            >
              <CardContent className="pt-6 flex items-center gap-3">
                <UserX className="h-8 w-8 text-amber-500" />
                <div>
                  <p className="text-2xl font-bold">{avgWithdrawal}%</p>
                  <p className="text-sm text-muted-foreground">Desistência média</p>
                  <p className="text-xs text-muted-foreground/70">Clique para detalhes</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome, cidade..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 w-full sm:w-[280px]"
              />
            </div>
            <Select value={stateFilter} onValueChange={setStateFilter}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Filtrar estado" /></SelectTrigger>
              <SelectContent disableSearch>
                <SelectItem value="all">Todos os estados</SelectItem>
                {states.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Filtrar status" /></SelectTrigger>
              <SelectContent disableSearch>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="alerta">Com alertas</SelectItem>
                <SelectItem value="sem_alerta">Sem alertas</SelectItem>
              </SelectContent>
            </Select>
            <Select value={jobFilter} onValueChange={setJobFilter}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Filtrar cargo" /></SelectTrigger>
              <SelectContent disableSearch>
                <SelectItem value="all">Todos os cargos</SelectItem>
                {jobTitles.map((j) => <SelectItem key={j} value={j}>{j}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={openDaysFilter} onValueChange={setOpenDaysFilter}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Tempo de abertura" /></SelectTrigger>
              <SelectContent disableSearch>
                <SelectItem value="all">Qualquer tempo</SelectItem>
                <SelectItem value="7">Abertas há +7 dias</SelectItem>
                <SelectItem value="14">Abertas há +14 dias</SelectItem>
                <SelectItem value="30">Abertas há +30 dias</SelectItem>
                <SelectItem value="60">Abertas há +60 dias</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={exportCSV} className="ml-auto">
              <Download className="h-4 w-4 mr-1" /> Exportar CSV
            </Button>
          </div>

          {/* Units table */}
          <Card>
            <CardHeader><CardTitle className="text-lg">Unidades</CardTitle></CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="text-center text-muted-foreground py-8">Carregando...</p>
              ) : (
                <div className="overflow-x-auto -mx-6 px-6 sm:mx-0 sm:px-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8"></TableHead>
                      <TableHead>Nome</TableHead>
                      <TableHead>Cidade</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="text-right">Vagas</TableHead>
                      <TableHead className="text-right">Candidatos</TableHead>
                      <TableHead className="text-right">Score</TableHead>
                      <TableHead className="text-right">Tempo Médio</TableHead>
                      <TableHead className="text-right">Conversão</TableHead>
                      <TableHead className="text-right">Standby</TableHead>
                      <TableHead className="text-right">Desistência</TableHead>
                      <TableHead>Alertas</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((u) => {
                      const isExpanded = expandedUnit === u.id;
                      return (
                        <Collapsible key={u.id} open={isExpanded} onOpenChange={(open) => setExpandedUnit(open ? u.id : null)} asChild>
                          <>
                            <CollapsibleTrigger asChild>
                              <TableRow className="cursor-pointer hover:bg-muted/50">
                                <TableCell>
                                  {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                </TableCell>
                                <TableCell
                                  className="font-medium text-primary cursor-pointer hover:underline"
                                  onClick={(e) => { e.stopPropagation(); setSelectedUnit({ id: u.id, metrics: u }); }}
                                >
                                  <div className="flex items-center gap-2">
                                    <span>{u.name}</span>
                                    {u.origem_unidade === "MANUAL" && (
                                      <Badge variant="outline" className="text-[10px] border-amber-500 text-amber-600">Manual</Badge>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell>{u.city || "—"}</TableCell>
                                <TableCell>{u.state || "—"}</TableCell>
                                <TableCell className="text-right">{u.openJobs}</TableCell>
                                <TableCell className="text-right">{u.totalCandidates}</TableCell>
                                <TableCell className="text-right">{u.avgScore || "—"}</TableCell>
                                <TableCell className="text-right">
                                  {u.avgDays > 0 ? (
                                    <span className="flex items-center justify-end gap-1">
                                      <Clock className="h-3 w-3 text-muted-foreground" />
                                      {u.avgDays}d
                                    </span>
                                  ) : "—"}
                                </TableCell>
                                <TableCell className="text-right">{u.conversionRate}%</TableCell>
                                <TableCell className={`text-right font-medium ${u.rejectionRate > 50 ? "text-destructive" : u.rejectionRate > 0 ? "text-orange-500" : ""}`}>
                                  {u.rejectionRate}%
                                </TableCell>
                                <TableCell className={`text-right font-medium ${u.withdrawalRate > 30 ? "text-destructive" : u.withdrawalRate > 0 ? "text-amber-500" : ""}`}>
                                  {u.withdrawalRate}%
                                </TableCell>
                                <TableCell>
                                  <div className="flex gap-1 flex-wrap">
                                    {u.alerts.map((alert, i) => (
                                      <Badge
                                        key={i}
                                        variant="destructive"
                                        className={alert === "Alto Standby" ? "bg-orange-500 hover:bg-orange-600 border-orange-500" : alert === "Alta Desistência" ? "bg-amber-500 hover:bg-amber-600 border-amber-500" : alert === "Conversão Baixa" ? "bg-red-700 hover:bg-red-800 border-red-700" : ""}
                                      >
                                        <AlertTriangle className="h-3 w-3 mr-1" />
                                        {alert}
                                      </Badge>
                                    ))}
                                  </div>
                                </TableCell>
                              </TableRow>
                            </CollapsibleTrigger>
                            <CollapsibleContent asChild>
                              <tr>
                                <td colSpan={12}>
                                  <UnitJobsExpanded unitId={u.id} />
                                </td>
                              </tr>
                            </CollapsibleContent>
                          </>
                        </Collapsible>
                      );
                    })}
                    {!filtered.length && (
                      <TableRow>
                        <TableCell colSpan={12} className="text-center text-muted-foreground py-8">
                          Nenhuma unidade encontrada.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trends" className="space-y-4">
          <UnitTrendCharts />
        </TabsContent>

        <TabsContent value="heatmap" className="space-y-4">
          <UnitHeatmap units={filtered} />
        </TabsContent>

        <TabsContent value="comparison" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Ranking de Unidades por Conversão</CardTitle>
            </CardHeader>
            <CardContent>
              {ranked.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  Nenhuma unidade com candidatos para comparar.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">#</TableHead>
                      <TableHead>Unidade</TableHead>
                      <TableHead className="text-right">Vagas</TableHead>
                      <TableHead className="text-right">Candidatos</TableHead>
                      <TableHead className="text-right">Conversão</TableHead>
                      <TableHead className="text-right">Score</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ranked.map((u, idx) => (
                      <TableRow key={u.id}>
                        <TableCell className="font-bold">{idx + 1}º</TableCell>
                        <TableCell className="font-medium">{u.name}</TableCell>
                        <TableCell className="text-right">{u.openJobs}</TableCell>
                        <TableCell className="text-right">{u.totalCandidates}</TableCell>
                        <TableCell className="text-right">{u.conversionRate}%</TableCell>
                        <TableCell className="text-right">{u.avgScore || "—"}</TableCell>
                        <TableCell>
                          {idx < 3 && (
                            <Badge className="bg-green-600 hover:bg-green-700 border-green-600 text-white">
                              Destaque
                            </Badge>
                          )}
                          {idx >= ranked.length - 3 && ranked.length > 3 && (
                            <Badge variant="destructive" className="bg-orange-500 hover:bg-orange-600 border-orange-500">
                              Atenção
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Ranking de Unidades por Desistência</CardTitle>
            </CardHeader>
            <CardContent>
              {rankedByWithdrawal.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  Nenhuma unidade com candidatos para comparar.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">#</TableHead>
                      <TableHead>Unidade</TableHead>
                      <TableHead className="text-right">Candidatos</TableHead>
                      <TableHead className="text-right">Desistências</TableHead>
                      <TableHead className="text-right">Taxa</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rankedByWithdrawal.map((u, idx) => (
                      <TableRow key={u.id}>
                        <TableCell className="font-bold">{idx + 1}º</TableCell>
                        <TableCell className="font-medium">{u.name}</TableCell>
                        <TableCell className="text-right">{u.totalCandidates}</TableCell>
                        <TableCell className="text-right">{u.withdrawn}</TableCell>
                        <TableCell className={`text-right font-medium ${u.withdrawalRate > 30 ? "text-destructive" : u.withdrawalRate > 0 ? "text-amber-500" : ""}`}>
                          {u.withdrawalRate}%
                        </TableCell>
                        <TableCell>
                          {idx < 3 && rankedByWithdrawal.length > 3 && u.withdrawalRate > 0 && (
                            <Badge variant="destructive">
                              Crítico
                            </Badge>
                          )}
                          {idx >= rankedByWithdrawal.length - 3 && rankedByWithdrawal.length > 3 && (
                            <Badge className="bg-green-600 hover:bg-green-700 border-green-600 text-white">
                              OK
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== VAGAS TAB (vaga-by-vaga listing) ===== */}
        <TabsContent value="vagas" className="space-y-4">
          <VagaByVagaListing />
        </TabsContent>

        {/* ===== ALERTAS TAB ===== */}
        <TabsContent value="alertas" className="space-y-4">
          <AlertasTab />
        </TabsContent>

        {/* ===== RELATÓRIOS TAB ===== */}
        <TabsContent value="relatorios" className="space-y-4">
          <RelatoriosTab />
        </TabsContent>

        <TabsContent value="ai" className="space-y-4">
          <AIDiagnosticPanel units={filtered} enabled={aiDiagnosticsEnabled} />
        </TabsContent>
      </Tabs>

      <UnitDetailPanel
        unitId={selectedUnit?.id || null}
        metrics={selectedUnit?.metrics || null}
        open={!!selectedUnit}
        onOpenChange={(open) => { if (!open) setSelectedUnit(null); }}
      />

      <MetricDetailDialog
        type={metricDetail}
        open={!!metricDetail}
        onOpenChange={(open) => { if (!open) setMetricDetail(null); }}
      />
    </div>
  );
}
