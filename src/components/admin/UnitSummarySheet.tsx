import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, UserCheck, TrendingUp, Clock, Briefcase, MapPin, Loader2 } from "lucide-react";
import { useUnitJobDetail } from "@/hooks/useUnitMonitoring";
import { useUnitCandidateSummary } from "@/hooks/useUnitMonitoring";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { UnitComparisonRow } from "@/hooks/useDashboardMetrics";

const STATUS_LABEL: Record<string, string> = {
  em_andamento: "Em andamento",
  aprovado: "Aprovado",
  reprovado: "Lista de Oportunidade",
  contratado: "Contratado",
  desligado: "Desligado",
  desistente: "Desistente",
  standby: "Standby",
  pausado: "Pausado",
};

const STATUS_COLOR: Record<string, string> = {
  em_andamento: "bg-yellow-100 text-yellow-700 border-yellow-300",
  aprovado: "bg-emerald-100 text-emerald-700 border-emerald-300",
  reprovado: "bg-red-100 text-red-700 border-red-300",
  contratado: "bg-blue-100 text-blue-700 border-blue-300",
  desligado: "bg-rose-100 text-rose-700 border-rose-300",
  desistente: "bg-gray-100 text-gray-600 border-gray-300",
  standby: "bg-purple-100 text-purple-700 border-purple-300",
  pausado: "bg-orange-100 text-orange-700 border-orange-300",
};

const JOB_STATUS_COLOR: Record<string, string> = {
  aberta: "bg-emerald-100 text-emerald-700",
  pausada: "bg-yellow-100 text-yellow-700",
  encerrada: "bg-gray-100 text-gray-600",
  preenchida: "bg-blue-100 text-blue-700",
};

const JOB_STATUS_LABEL: Record<string, string> = {
  aberta: "Aberta",
  pausada: "Pausada",
  encerrada: "Encerrada",
  preenchida: "Preenchida",
};

interface UnitSummarySheetProps {
  unit: UnitComparisonRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function UnitSummarySheet({ unit, open, onOpenChange }: UnitSummarySheetProps) {
  const { data: jobs, isLoading: jobsLoading } = useUnitJobDetail(unit?.unitId ?? null);
  const { data: candidates, isLoading: candidatesLoading } = useUnitCandidateSummary(unit?.unitId ?? null);

  const location = unit ? [unit.city, unit.state].filter(Boolean).join(" / ") || "—" : "—";

  // Group candidates by job
  const candidatesByJob: Record<string, number> = {};
  (candidates || []).forEach((c) => {
    candidatesByJob[c.unitJobId] = (candidatesByJob[c.unitJobId] || 0) + 1;
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        {unit ? (
        <>
        <SheetHeader className="pb-4 border-b">
          <SheetTitle className="text-xl">{unit.unitName}</SheetTitle>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" />
            {location}
          </div>
        </SheetHeader>

        <div className="space-y-6 pt-5">
          {/* Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MetricCard
              icon={<Users className="h-4 w-4 text-primary" />}
              label="Candidatos"
              value={unit.totalCandidates}
            />
            <MetricCard
              icon={<UserCheck className="h-4 w-4 text-emerald-600" />}
              label="Contratados"
              value={unit.hired}
            />
            <MetricCard
              icon={<TrendingUp className="h-4 w-4 text-violet-600" />}
              label="Conversão"
              value={`${unit.conversionRate}%`}
              highlight={unit.conversionRate >= 10 ? "emerald" : unit.conversionRate > 0 ? "amber" : undefined}
            />
            <MetricCard
              icon={<Clock className="h-4 w-4 text-blue-600" />}
              label="Tempo Médio"
              value={unit.avgDays > 0 ? `${unit.avgDays}d` : "—"}
            />
          </div>

          {/* Jobs */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-muted-foreground" />
              Vagas da unidade
            </h3>
            {jobsLoading ? (
              <Skeleton className="h-28 w-full" />
            ) : !jobs?.length ? (
              <p className="text-sm text-muted-foreground py-3">Nenhuma vaga encontrada.</p>
            ) : (
              <div className="rounded-md border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead className="text-xs">Cargo</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-xs text-right">Candidatos</TableHead>
                      <TableHead className="text-xs text-right">Contratados</TableHead>
                      <TableHead className="text-xs text-right">Em andamento</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobs.map((j) => (
                      <TableRow key={j.id}>
                        <TableCell className="text-sm font-medium">{j.jobTitle}</TableCell>
                        <TableCell>
                          <Badge className={`text-xs border ${JOB_STATUS_COLOR[j.status] || ""}`} variant="outline">
                            {JOB_STATUS_LABEL[j.status] || j.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-right">{j.candidates}</TableCell>
                        <TableCell className="text-sm text-right">{j.byStatus?.contratado || 0}</TableCell>
                        <TableCell className="text-sm text-right">{j.byStatus?.em_andamento || 0}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          {/* Candidates */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              Candidatos
              {candidates && (
                <span className="text-xs font-normal text-muted-foreground">({candidates.length} candidatura{candidates.length !== 1 ? "s" : ""})</span>
              )}
            </h3>
            {candidatesLoading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-9 w-full" />)}
              </div>
            ) : !candidates?.length ? (
              <p className="text-sm text-muted-foreground py-3">Nenhum candidato encontrado.</p>
            ) : (
              <div className="rounded-md border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead className="text-xs">Candidato</TableHead>
                      <TableHead className="text-xs">Vaga</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-xs text-right">Data</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {candidates.map((c) => (
                      <TableRow key={c.applicationId}>
                        <TableCell className="text-sm">
                          <p className="font-medium leading-tight">{c.candidateName}</p>
                          {(c.candidateCity || c.candidateState) && (
                            <p className="text-xs text-muted-foreground">
                              {[c.candidateCity, c.candidateState].filter(Boolean).join(" / ")}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{c.jobTitle}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`text-xs border ${STATUS_COLOR[c.status] || "bg-gray-100 text-gray-600"}`}
                          >
                            {STATUS_LABEL[c.status] || c.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground text-right whitespace-nowrap">
                          {format(new Date(c.appliedAt), "dd/MM/yy", { locale: ptBR })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>
        </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function MetricCard({
  icon,
  label,
  value,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  highlight?: "emerald" | "amber";
}) {
  const valueColor =
    highlight === "emerald"
      ? "text-emerald-600"
      : highlight === "amber"
      ? "text-amber-600"
      : "text-foreground";

  return (
    <div className="rounded-lg border bg-card p-3 flex items-center gap-2.5">
      <div className="shrink-0">{icon}</div>
      <div>
        <p className={`text-lg font-bold leading-tight ${valueColor}`}>{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}
