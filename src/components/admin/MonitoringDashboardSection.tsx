import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Activity, Building2, Briefcase, Users, TrendingUp, PauseCircle, UserMinus,
  Loader2, Trophy, AlertTriangle, CheckCircle2,
} from "lucide-react";
import { useUnitMonitoringData, type UnitMetrics } from "@/hooks/useUnitMonitoring";
import { UnitTrendCharts } from "@/components/admin/UnitTrendCharts";

/**
 * Visão única de monitoramento consolidada — reúne o que já existe hoje espalhado
 * em telas distintas (UnitsMonitor, tendências, ranking, alertas de gargalo),
 * sem alterar as rotas/telas originais. Somente leitura; escopo de dados vem do
 * hook useUnitMonitoringData (admin = rede inteira). As métricas de "utilização/
 * adesão da plataforma" ainda não existem e serão adicionadas depois.
 */

function StatCard({ icon: Icon, label, value, suffix }: { icon: React.ElementType; label: string; value: number | string; suffix?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground mb-1">
          <Icon className="h-4 w-4" />
          <span className="text-xs">{label}</span>
        </div>
        <p className="text-2xl font-bold text-foreground">
          {value}{suffix}
        </p>
      </CardContent>
    </Card>
  );
}

export function MonitoringDashboardSection() {
  const { data, isLoading } = useUnitMonitoringData();
  const units = useMemo<UnitMetrics[]>(() => data?.units ?? [], [data]);

  // KPIs agregados da rede (mesma lógica da Visão Geral do UnitsMonitor)
  const kpis = useMemo(() => {
    const totalActive = units.length;
    const totalOpenJobs = units.reduce((s, u) => s + u.openJobs, 0);
    const totalCandidates = units.reduce((s, u) => s + u.totalCandidates, 0);
    const totalHired = units.reduce((s, u) => s + u.hired, 0);
    const totalRejected = units.reduce((s, u) => s + u.rejected, 0);
    const totalWithdrawn = units.reduce((s, u) => s + u.withdrawn, 0);
    return {
      totalActive,
      totalOpenJobs,
      totalCandidates,
      avgConversion: totalCandidates > 0 ? Math.round((totalHired / totalCandidates) * 100) : 0,
      avgRejection: totalCandidates > 0 ? Math.round((totalRejected / totalCandidates) * 100) : 0,
      avgWithdrawal: totalCandidates > 0 ? Math.round((totalWithdrawn / totalCandidates) * 100) : 0,
    };
  }, [units]);

  const withCandidates = useMemo(() => units.filter((u) => u.totalCandidates > 0), [units]);

  const topConversion = useMemo(
    () => [...withCandidates].sort((a, b) => b.conversionRate - a.conversionRate).slice(0, 5),
    [withCandidates],
  );
  const topWithdrawal = useMemo(
    () => [...withCandidates].sort((a, b) => b.withdrawalRate - a.withdrawalRate).slice(0, 5),
    [withCandidates],
  );

  // Unidades em atenção (gargalos) — análogo a "baixa aderência" (baseado no funil)
  const flagged = useMemo(
    () => units.filter((u) => u.alerts.length > 0).sort((a, b) => b.alerts.length - a.alerts.length),
    [units],
  );

  // "Unidades em atenção": mostra 10 e vai somando +10 conforme o scroll até o fim.
  const [visibleFlagged, setVisibleFlagged] = useState(10);
  const flaggedScrollRef = useRef<HTMLDivElement>(null);
  const flaggedSentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVisibleFlagged(10);
  }, [flagged.length]);

  useEffect(() => {
    const sentinel = flaggedSentinelRef.current;
    if (!sentinel) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleFlagged((v) => Math.min(v + 10, flagged.length));
        }
      },
      { root: flaggedScrollRef.current, rootMargin: "0px 0px 120px 0px" },
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [flagged.length, visibleFlagged]);

  // Tabela por unidade — só unidades com algum indicador preenchido (não-zerado),
  // mais relevantes primeiro. Paginação de 10 em 10 via botão "Carregar mais".
  const tableUnits = useMemo(
    () =>
      units
        .filter(
          (u) =>
            u.openJobs > 0 ||
            u.totalCandidates > 0 ||
            u.hired > 0 ||
            u.conversionRate > 0 ||
            u.rejectionRate > 0 ||
            u.withdrawalRate > 0 ||
            u.alerts.length > 0,
        )
        .sort((a, b) => b.totalCandidates - a.totalCandidates),
    [units],
  );

  const [tableVisible, setTableVisible] = useState(10);
  useEffect(() => {
    setTableVisible(10);
  }, [tableUnits.length]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          Dashboard de Monitoramento
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Visão consolidada dos indicadores de recrutamento por unidade (rede inteira). Reúne o que hoje está distribuído em telas distintas — sem alterá-las.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : units.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-8">Nenhuma unidade com dados de monitoramento.</p>
      ) : (
        <>
          {/* KPIs gerais */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard icon={Building2} label="Unidades ativas" value={kpis.totalActive} />
            <StatCard icon={Briefcase} label="Vagas abertas" value={kpis.totalOpenJobs} />
            <StatCard icon={Users} label="Candidatos" value={kpis.totalCandidates} />
            <StatCard icon={TrendingUp} label="Conversão média" value={kpis.avgConversion} suffix="%" />
            <StatCard icon={PauseCircle} label="Standby médio" value={kpis.avgRejection} suffix="%" />
            <StatCard icon={UserMinus} label="Desistência média" value={kpis.avgWithdrawal} suffix="%" />
          </div>

          {/* Evolução (tendências 6 meses) — componente reutilizado */}
          <UnitTrendCharts />

          {/* Ranking */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-emerald-600" /> Ranking por Conversão
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {topConversion.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem dados suficientes.</p>
                ) : (
                  topConversion.map((u, i) => (
                    <div key={u.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="text-muted-foreground w-5 shrink-0">{i + 1}º</span>
                        <span className="truncate">{u.name}</span>
                      </span>
                      <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 border-emerald-300 shrink-0">
                        {u.conversionRate}%
                      </Badge>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <UserMinus className="h-4 w-4 text-amber-600" /> Ranking por Desistência
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {topWithdrawal.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem dados suficientes.</p>
                ) : (
                  topWithdrawal.map((u, i) => (
                    <div key={u.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="text-muted-foreground w-5 shrink-0">{i + 1}º</span>
                        <span className="truncate">{u.name}</span>
                      </span>
                      <Badge variant="secondary" className="bg-amber-100 text-amber-800 border-amber-300 shrink-0">
                        {u.withdrawalRate}%
                      </Badge>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          {/* Unidades em atenção (gargalos) — destaque de baixa conversão/aderência */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" /> Unidades em atenção
              </CardTitle>
            </CardHeader>
            <CardContent>
              {flagged.length === 0 ? (
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Nenhuma unidade com alertas no momento.
                </p>
              ) : (
                <>
                  <div ref={flaggedScrollRef} className="max-h-[440px] overflow-y-auto space-y-2 pr-1">
                    {flagged.slice(0, visibleFlagged).map((u) => (
                      <div key={u.id} className="flex items-start justify-between gap-3 flex-wrap rounded-md border border-border p-2.5">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{u.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {[u.city, u.state].filter(Boolean).join(" – ") || "—"}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {u.alerts.map((a) => (
                            <Badge key={a} variant="secondary" className="bg-amber-100 text-amber-800 border-amber-300">
                              {a}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ))}
                    {visibleFlagged < flagged.length && (
                      <div ref={flaggedSentinelRef} className="flex items-center justify-center py-3 text-xs text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carregando mais…
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Mostrando {Math.min(visibleFlagged, flagged.length)} de {flagged.length} unidades em atenção
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          {/* Indicadores por unidade (tabela) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Indicadores por unidade</CardTitle>
            </CardHeader>
            <CardContent>
              {tableUnits.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Nenhuma unidade com indicadores preenchidos.</p>
              ) : (
              <>
              <div className="overflow-x-auto -mx-6 px-6 sm:mx-0 sm:px-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Unidade</TableHead>
                      <TableHead>Cidade/UF</TableHead>
                      <TableHead className="text-right">Vagas</TableHead>
                      <TableHead className="text-right">Candidatos</TableHead>
                      <TableHead className="text-right">Contratados</TableHead>
                      <TableHead className="text-right">Conversão</TableHead>
                      <TableHead className="text-right">Standby</TableHead>
                      <TableHead className="text-right">Desistência</TableHead>
                      <TableHead>Alertas</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tableUnits.slice(0, tableVisible).map((u) => (
                      <TableRow key={u.id}>
                        <TableCell className="font-medium">{u.name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {[u.city, u.state].filter(Boolean).join(" – ") || "—"}
                        </TableCell>
                        <TableCell className="text-right">{u.openJobs}</TableCell>
                        <TableCell className="text-right">{u.totalCandidates}</TableCell>
                        <TableCell className="text-right">{u.hired}</TableCell>
                        <TableCell className="text-right">{u.conversionRate}%</TableCell>
                        <TableCell className="text-right">{u.rejectionRate}%</TableCell>
                        <TableCell className="text-right">{u.withdrawalRate}%</TableCell>
                        <TableCell>
                          {u.alerts.length === 0 ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            <span className="text-xs text-amber-700 font-medium">{u.alerts.length}</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {tableUnits.length > tableVisible && (
                <div className="flex justify-center pt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setTableVisible((v) => Math.min(v + 10, tableUnits.length))}
                  >
                    Carregar mais ({tableUnits.length - tableVisible} restantes)
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-2 text-center">
                Mostrando {Math.min(tableVisible, tableUnits.length)} de {tableUnits.length} unidades
              </p>
              </>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
