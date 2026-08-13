import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Briefcase, Users, UserCheck, TrendingUp, AlertTriangle, UserX, Loader2 } from "lucide-react";
import { useUnitDetail, useUnitJobDetail, type UnitMetrics } from "@/hooks/useUnitMonitoring";
import { UnitPoliciesViewer } from "@/components/admin/UnitPoliciesViewer";
import { useUnitWithdrawalAnalysis, useUnitRejectionAnalysis } from "@/hooks/useMetricAnalysis";
import { format } from "date-fns";

interface UnitDetailPanelProps {
  unitId: string | null;
  metrics: UnitMetrics | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const statusLabel: Record<string, string> = {
  aberta: "Aberta",
  pausada: "Pausada",
  encerrada: "Encerrada",
  preenchida: "Preenchida",
};

export default function UnitDetailPanel({ unitId, metrics, open, onOpenChange }: UnitDetailPanelProps) {
  const { data: unit, isLoading: loadingUnit } = useUnitDetail(unitId);
  const { data: jobs, isLoading: loadingJobs } = useUnitJobDetail(unitId);
  const { data: withdrawalData, isLoading: loadingWithdrawal } = useUnitWithdrawalAnalysis(unitId);
  const { data: rejectionData, isLoading: loadingRejection } = useUnitRejectionAnalysis(unitId);

  const showWithdrawal = metrics && metrics.withdrawalRate > 0;
  const showRejection = metrics && metrics.rejectionRate > 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        {loadingUnit ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : unit ? (
          <div className="space-y-6">
            {/* Header */}
            <SheetHeader>
              <SheetTitle className="text-xl">{unit.name}</SheetTitle>
              <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                {unit.code && <span>Código: {unit.code}</span>}
                {(unit.city || unit.state) && (
                  <span>{[unit.city, unit.state].filter(Boolean).join(" / ")}</span>
                )}
                {unit.cep && <span>CEP: {unit.cep}</span>}
              </div>
            </SheetHeader>

            {/* Metrics grid */}
            {metrics && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <MetricCard icon={<Briefcase className="h-5 w-5 text-primary" />} label="Vagas abertas" value={metrics.openJobs} />
                <MetricCard icon={<Users className="h-5 w-5 text-primary" />} label="Candidatos" value={metrics.totalCandidates} />
                <MetricCard icon={<UserCheck className="h-5 w-5 text-primary" />} label="Contratados" value={metrics.hired} />
                <MetricCard icon={<TrendingUp className="h-5 w-5 text-primary" />} label="Conversão" value={`${metrics.conversionRate}%`} />
                <MetricCard icon={<AlertTriangle className="h-5 w-5 text-warning" />} label="Standby" value={`${metrics.rejectionRate}%`} />
                <MetricCard icon={<UserX className="h-5 w-5 text-amber-500" />} label="Desistência" value={`${metrics.withdrawalRate}%`} />
              </div>
            )}

            {/* Alerts */}
            {metrics && metrics.alerts.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Alertas ativos</p>
                <div className="flex flex-wrap gap-2">
                  {metrics.alerts.map((alert, i) => (
                    <Badge
                      key={i}
                      variant="destructive"
                      className={
                        alert === "Alto Standby"
                          ? "bg-orange-500 hover:bg-orange-600 border-orange-500"
                          : alert === "Alta Desistência"
                          ? "bg-amber-500 hover:bg-amber-600 border-amber-500"
                          : ""
                      }
                    >
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      {alert}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Analysis accordion */}
            {(showWithdrawal || showRejection) && (
              <Accordion type="multiple" className="w-full">
                {/* Withdrawal analysis */}
                {showWithdrawal && (
                  <AccordionItem value="withdrawal">
                    <AccordionTrigger className="text-sm font-medium">
                      <span className="flex items-center gap-2">
                        <UserX className="h-4 w-4 text-amber-500" />
                        Análise de Desistências ({withdrawalData?.total ?? "…"})
                      </span>
                    </AccordionTrigger>
                    <AccordionContent>
                      {loadingWithdrawal ? (
                        <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
                      ) : !withdrawalData?.total ? (
                        <p className="text-sm text-muted-foreground py-2">Nenhuma desistência registrada.</p>
                      ) : (
                        <div className="space-y-4">
                          {/* By phase */}
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1">Por etapa</p>
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="h-8 text-xs">Etapa</TableHead>
                                  <TableHead className="h-8 text-xs text-right">Qtd</TableHead>
                                  <TableHead className="h-8 text-xs text-right">%</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {withdrawalData.byPhase.map((p) => (
                                  <TableRow key={p.phase}>
                                    <TableCell className="py-1.5 text-sm">{p.phase}</TableCell>
                                    <TableCell className="py-1.5 text-sm text-right">{p.count}</TableCell>
                                    <TableCell className="py-1.5 text-sm text-right">{p.percentage}%</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                          {/* Reasons */}
                          {withdrawalData.reasons.length > 0 && (
                            <div>
                              <p className="text-xs font-medium text-muted-foreground mb-1">Motivos informados</p>
                              <div className="space-y-1">
                                {withdrawalData.reasons.map((r, i) => (
                                  <div key={i} className="flex items-center justify-between text-sm border-b last:border-0 py-1.5">
                                    <span className="text-foreground">{r.reason}</span>
                                    <Badge variant="secondary" className="text-xs">{r.count}x</Badge>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                )}

                {/* Rejection analysis */}
                {showRejection && (
                  <AccordionItem value="rejection">
                    <AccordionTrigger className="text-sm font-medium">
                      <span className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-destructive" />
                        Análise de Standby ({rejectionData?.total ?? "…"})
                      </span>
                    </AccordionTrigger>
                    <AccordionContent>
                      {loadingRejection ? (
                        <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
                      ) : !rejectionData?.total ? (
                        <p className="text-sm text-muted-foreground py-2">Nenhum registro de standby.</p>
                      ) : (
                        <div className="space-y-4">
                          {/* By phase */}
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1">Por etapa</p>
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="h-8 text-xs">Etapa</TableHead>
                                  <TableHead className="h-8 text-xs text-right">Qtd</TableHead>
                                  <TableHead className="h-8 text-xs text-right">%</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {rejectionData.byPhase.map((p) => (
                                  <TableRow key={p.phase}>
                                    <TableCell className="py-1.5 text-sm">{p.phase}</TableCell>
                                    <TableCell className="py-1.5 text-sm text-right">{p.count}</TableCell>
                                    <TableCell className="py-1.5 text-sm text-right">{p.percentage}%</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                          {/* Feedbacks */}
                          {rejectionData.feedbacks.length > 0 && (
                            <div>
                              <p className="text-xs font-medium text-muted-foreground mb-1">Justificativas do franqueado</p>
                              <div className="space-y-2 max-h-48 overflow-y-auto">
                                {rejectionData.feedbacks.map((f, i) => (
                                  <div key={i} className="rounded-md border p-2 text-sm space-y-0.5">
                                    <p className="text-foreground">{f.notes}</p>
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                      <Badge variant="outline" className="text-xs">{f.decision}</Badge>
                                      <span>{format(new Date(f.createdAt), "dd/MM/yyyy")}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                )}
              </Accordion>
            )}

            {/* Unit Policies */}
            {unitId && (
              <UnitPoliciesViewer unitId={unitId} unitName={unit.name} />
            )}

            {/* Jobs table */}
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Vagas da unidade</p>
              {loadingJobs ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : !jobs?.length ? (
                <p className="text-sm text-muted-foreground py-4">Nenhuma vaga encontrada.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cargo</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Abertura</TableHead>
                      <TableHead className="text-right">Cand.</TableHead>
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
              )}
            </div>
          </div>
        ) : (
          <p className="text-center text-muted-foreground py-8">Unidade não encontrada.</p>
        )}
      </SheetContent>
    </Sheet>
  );
}

function MetricCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-2">
        {icon}
        <div>
          <p className="text-lg font-bold leading-tight">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}
