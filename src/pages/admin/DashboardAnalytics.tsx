import { useState, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import UnitSummarySheet from "@/components/admin/UnitSummarySheet";
import type { UnitComparisonRow } from "@/hooks/useDashboardMetrics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MaskedDateInput } from "@/components/ui/masked-date-input";
import { ymdToLocalDate, dateToLocalYMD, formatDateBR } from "@/lib/dateUtils";
import { formatModality } from "@/lib/modalityLabel";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Users, Briefcase, Building2, TrendingUp, Calendar, FileText, ArrowRight, Clock, AlertTriangle, Filter, ShieldAlert, UserCheck } from "lucide-react";
import {
  useAdminStats,
  useAdvancedFunnel,
  useRecentInterviews,
  usePendingDocuments,
  useUnitComparison,
  useGargalosAlerts,
  useMetricsSnapshots,
  useDashboardFilterOptions,
  type DashboardFilters,
} from "@/hooks/useDashboardMetrics";
import { useGlobalSettings } from "@/hooks/useGlobalSettings";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LineChart, Line, CartesianGrid, Legend } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { PageHelp } from "@/components/ui/page-help";
import { useAttendanceRate, usePendingDocsWithWaitTime } from "@/hooks/useDashboardExtras";
import { DashboardAIInsights } from "@/components/admin/DashboardAIInsights";

export default function DashboardAnalytics() {
  const { hasRole, unitIds: myUnitIds } = useAuth();
  const isSuperAdmin = hasRole("admin");
  const [filters, setFilters] = useState<DashboardFilters>({});
  const [selectedUnit, setSelectedUnit] = useState<UnitComparisonRow | null>(null);
  const { data: filterOptions } = useDashboardFilterOptions();
  const { data: dashSettings } = useGlobalSettings("dashboard");
  const aiInsightsEnabled =
    dashSettings?.find(s => s.key === "enable_ai_insights")?.value !== false ||
    dashSettings?.find(s => s.key === "ai_diagnostics_enabled")?.value === true;
  const cacheTtlSeconds = Number(dashSettings?.find(s => s.key === "cache_ttl")?.value) || 300;
  const refreshRateMs = Number(dashSettings?.find(s => s.key === "dashboard_refresh_rate")?.value) || undefined;

  // Non-admin: filtrar opções de unidades e forçar escopo
  const scopedFilterOptions = useMemo(() => {
    if (!filterOptions) return filterOptions;
    if (isSuperAdmin) return filterOptions;
    return {
      ...filterOptions,
      units: filterOptions.units.filter((u: any) => myUnitIds.includes(u.id)),
    };
  }, [filterOptions, isSuperAdmin, myUnitIds]);

  // Non-admin sem filtro de unidade: forçar filtro pelas unidades vinculadas
  const effectiveFilters = useMemo(() => {
    if (isSuperAdmin) return filters;
    // Non-admin users can only query their linked units.
    if (filters.unitId) {
      if (myUnitIds.includes(filters.unitId)) return filters;
      return { ...filters, unitId: undefined, unitIds: myUnitIds };
    }
    if (myUnitIds.length > 0) return { ...filters, unitIds: myUnitIds };
    return { ...filters, unitIds: [] };
  }, [filters, isSuperAdmin, myUnitIds]);

  const staleMs = cacheTtlSeconds * 1000;
  const refetchInterval = refreshRateMs;
  const { data: stats, isLoading: statsLoading } = useAdminStats(effectiveFilters, staleMs, refetchInterval);
  const { data: funnel, isLoading: funnelLoading } = useAdvancedFunnel(effectiveFilters, staleMs, refetchInterval);
  const { data: interviews, isLoading: interviewsLoading } = useRecentInterviews();
  const { data: pendingDocs, isLoading: docsLoading } = usePendingDocuments();
  const { data: unitComparison, isLoading: compLoading } = useUnitComparison(staleMs);
  const { data: alerts, isLoading: alertsLoading } = useGargalosAlerts(staleMs, refetchInterval);
  const { data: snapshots } = useMetricsSnapshots("daily");
  const { data: attendanceRate } = useAttendanceRate();
  const { data: docsWithWait } = usePendingDocsWithWaitTime();
  const statCards = [
    { label: "Candidatos Ativos", value: stats?.activeCandidates ?? "—", icon: Users, color: "text-primary" },
    { label: "Vagas Abertas", value: stats?.openJobs ?? "—", icon: Briefcase, color: "text-emerald-600" },
    { label: "Unidades", value: stats?.activeUnits ?? "—", icon: Building2, color: "text-amber-600" },
    { label: "Taxa de Conversão", value: stats?.conversionRate ?? "—", icon: TrendingUp, color: "text-violet-600" },
    { label: "Tempo Médio (dias)", value: stats?.avgHiringDays ?? "—", icon: Clock, color: "text-blue-600" },
    { label: "Comparecimento", value: attendanceRate?.rate != null ? `${attendanceRate.rate}%` : "—", icon: UserCheck, color: "text-teal-600" },
  ];

  const updateFilter = (key: keyof DashboardFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value === "__all__" ? undefined : value }));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-foreground">Dashboard Institucional</h2>
        <PageHelp />
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2"><Filter className="h-4 w-4" /> Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Select value={filters.unitId || "__all__"} onValueChange={(v) => updateFilter("unitId", v)}>
              <SelectTrigger><SelectValue placeholder="Todas as unidades" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todas as unidades</SelectItem>
                {scopedFilterOptions?.units.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.jobId || "__all__"} onValueChange={(v) => updateFilter("jobId", v)}>
              <SelectTrigger><SelectValue placeholder="Todos os cargos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos os cargos</SelectItem>
                {filterOptions?.jobs.map((j) => <SelectItem key={j.id} value={j.id}>{j.title}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.state || "__all__"} onValueChange={(v) => updateFilter("state", v)}>
              <SelectTrigger><SelectValue placeholder="Todos os estados" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos os estados</SelectItem>
                {scopedFilterOptions?.states.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <MaskedDateInput placeholder="De" value={filters.dateFrom && filters.dateFrom !== "__all__" ? ymdToLocalDate(filters.dateFrom) : null} onChange={(d) => updateFilter("dateFrom", d ? dateToLocalYMD(d) : "__all__")} format="dd/MM/yyyy" className="flex-1" />
              <MaskedDateInput placeholder="Até" value={filters.dateTo && filters.dateTo !== "__all__" ? ymdToLocalDate(filters.dateTo) : null} onChange={(d) => updateFilter("dateTo", d ? dateToLocalYMD(d) : "__all__")} format="dd/MM/yyyy" className="flex-1" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {statCards.map((s) => (
          <Card key={s.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2 gap-2">
              <CardTitle className="text-xs font-medium text-muted-foreground min-w-0">{s.label}</CardTitle>
              <s.icon className={`h-4 w-4 ${s.color} shrink-0`} />
            </CardHeader>
            <CardContent>
              {statsLoading ? <Skeleton className="h-8 w-16" /> : <p className="text-2xl font-bold">{s.value}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Funnel */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Funil Analítico de Recrutamento</CardTitle>
        </CardHeader>
        <CardContent className="h-80">
          {funnelLoading ? (
            <Skeleton className="h-full w-full" />
          ) : !funnel || funnel.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Sem dados para os filtros selecionados</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnel} layout="vertical" margin={{ left: 10, right: 30 }}>
                <XAxis type="number" />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 12 }} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.[0]) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="bg-popover text-popover-foreground border rounded-lg p-3 shadow-md text-sm">
                        <p className="font-semibold">{d.name}</p>
                        <p>Quantidade: {d.value}</p>
                        <p>% do total: {d.percent.toFixed(1)}%</p>
                        {d.conversionFromPrev > 0 && d.name !== "Inscritos" && d.name !== "Lista de Oportunidade" && d.name !== "Standby" && d.name !== "Desistentes" && (
                          <p>Conversão da etapa anterior: {d.conversionFromPrev.toFixed(1)}%</p>
                        )}
                      </div>
                    );
                  }}
                />
                <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                  {funnel.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Alerts + Interviews + Docs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-red-500" /> Alertas de Gargalo
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-64 overflow-y-auto">
            {alertsLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : !alerts || alerts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Nenhum alerta ativo ✓</p>
            ) : (
              <div className="space-y-2">
                {alerts.map((a, i) => (
                  <div key={i} className="flex items-start gap-2 py-2 border-b border-border last:border-0">
                    <Badge variant={a.level === "critical" ? "destructive" : "secondary"} className="text-xs mt-0.5 shrink-0">
                      {a.level === "critical" ? "CRÍTICO" : "AVISO"}
                    </Badge>
                    <p className="text-sm">{a.message}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Calendar className="h-5 w-5 text-primary" /> Entrevistas Próximas
            </CardTitle>
            <Link to="/admin/agendamento" className="text-sm text-primary hover:underline flex items-center gap-1">
              Ver todas <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent className="max-h-64 overflow-y-auto">
            {interviewsLoading ? (
              <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : !interviews || interviews.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Nenhuma entrevista nos próximos 7 dias</p>
            ) : (
              <div className="space-y-2">
                {interviews.slice(0, 5).map((iv: any) => (
                  <div key={iv.id} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                    <div>
                      <p className="text-sm font-medium">{iv.profiles?.full_name || "Candidato"}</p>
                      <p className="text-xs text-muted-foreground">{iv.units?.name} · {formatModality(iv.modality)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">{formatDateBR(iv.scheduled_date).slice(0, 5)}</p>
                      <p className="text-xs text-muted-foreground">{iv.scheduled_time?.slice(0, 5)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="h-5 w-5 text-amber-600" /> Docs Pendentes
            </CardTitle>
            <Link to="/admin/documentacao" className="text-sm text-primary hover:underline flex items-center gap-1">
              Ver todos <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent>
            {docsLoading ? <Skeleton className="h-16 w-full" /> : (
              <div className="space-y-3">
                <div className="flex items-center gap-4">
                  <div className="flex items-center justify-center w-16 h-16 rounded-xl bg-amber-100 text-amber-700">
                    <span className="text-2xl font-bold">{docsWithWait?.total ?? pendingDocs}</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium">solicitações em aberto</p>
                    <p className="text-xs text-muted-foreground">Aguardando envio ou validação</p>
                  </div>
                </div>
                {docsWithWait && docsWithWait.overdue48h > 0 && (
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-destructive/10 text-destructive text-sm">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>{docsWithWait.overdue48h} candidato{docsWithWait.overdue48h > 1 ? "s" : ""} aguardando há +48h</span>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Unit Comparison */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Comparativo de Unidades</CardTitle>
        </CardHeader>
        <CardContent>
          {compLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : !unitComparison || unitComparison.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Sem dados de comparação</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Unidade</TableHead>
                    <TableHead>Cidade</TableHead>
                    <TableHead className="text-right">Candidatos</TableHead>
                    <TableHead className="text-right">Contratados</TableHead>
                    <TableHead className="text-right">Conversão %</TableHead>
                    <TableHead className="text-right">Tempo Médio</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {unitComparison.map((row) => (
                    <TableRow
                      key={row.unitId}
                      className="cursor-pointer hover:bg-muted/60 transition-colors"
                      onClick={() => setSelectedUnit(row)}
                    >
                      <TableCell className="font-medium">{row.unitName}</TableCell>
                      <TableCell className="text-muted-foreground">{row.city || "—"}{row.state ? ` / ${row.state}` : ""}</TableCell>
                      <TableCell className="text-right">{row.totalCandidates}</TableCell>
                      <TableCell className="text-right">{row.hired}</TableCell>
                      <TableCell className="text-right">
                        <span className={row.conversionRate >= 10 ? "text-emerald-600 font-semibold" : row.conversionRate > 0 ? "text-amber-600" : "text-muted-foreground"}>
                          {row.conversionRate}%
                        </span>
                      </TableCell>
                      <TableCell className="text-right">{row.avgDays > 0 ? `${row.avgDays}d` : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <UnitSummarySheet
        unit={selectedUnit}
        open={!!selectedUnit}
        onOpenChange={(open) => { if (!open) setSelectedUnit(null); }}
      />

      {/* AI Insights */}
      {aiInsightsEnabled && <DashboardAIInsights />}

      {/* Historical Trend */}
      {snapshots && snapshots.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Tendência Histórica</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={snapshots}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="created_at" tickFormatter={(v) => format(new Date(v), "dd/MM")} tick={{ fontSize: 11 }} />
                <YAxis />
                <Tooltip labelFormatter={(v) => format(new Date(v as string), "dd/MM/yyyy")} />
                <Legend />
                <Line type="monotone" dataKey="total_candidates" name="Candidatos" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="conversion_rate" name="Conversão %" stroke="hsl(142 71% 45%)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
