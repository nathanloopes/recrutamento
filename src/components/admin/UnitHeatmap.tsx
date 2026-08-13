import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { UnitMetrics } from "@/hooks/useUnitMonitoring";

interface UnitHeatmapProps {
  units: UnitMetrics[];
}

interface StateData {
  state: string;
  unitCount: number;
  totalCandidates: number;
  avgConversion: number;
  avgRejection: number;
  alertCount: number;
}

function getHeatColor(alertCount: number, avgRejection: number): string {
  if (alertCount > 2 || avgRejection > 60) return "bg-destructive/20 border-destructive/40 text-destructive";
  if (alertCount > 0 || avgRejection > 40) return "bg-amber-500/20 border-amber-500/40 text-amber-700 dark:text-amber-400";
  return "bg-green-500/15 border-green-500/30 text-green-700 dark:text-green-400";
}

export function UnitHeatmap({ units }: UnitHeatmapProps) {
  const stateData = useMemo(() => {
    const byState: Record<string, UnitMetrics[]> = {};
    units.forEach((u) => {
      const s = u.state || "N/D";
      if (!byState[s]) byState[s] = [];
      byState[s].push(u);
    });

    return Object.entries(byState)
      .map(([state, stateUnits]): StateData => {
        const totalCandidates = stateUnits.reduce((s, u) => s + u.totalCandidates, 0);
        const totalHired = stateUnits.reduce((s, u) => s + u.hired, 0);
        const totalRejected = stateUnits.reduce((s, u) => s + u.rejected, 0);
        const alertCount = stateUnits.reduce((s, u) => s + u.alerts.length, 0);

        return {
          state,
          unitCount: stateUnits.length,
          totalCandidates,
          avgConversion: totalCandidates > 0 ? Math.round((totalHired / totalCandidates) * 100) : 0,
          avgRejection: totalCandidates > 0 ? Math.round((totalRejected / totalCandidates) * 100) : 0,
          alertCount,
        };
      })
      .sort((a, b) => b.alertCount - a.alertCount || b.unitCount - a.unitCount);
  }, [units]);

  if (!stateData.length) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Mapa de Calor por Estado</CardTitle>
      </CardHeader>
      <CardContent>
        <TooltipProvider>
          <div className="flex flex-wrap gap-2">
            {stateData.map((sd) => (
              <Tooltip key={sd.state}>
                <TooltipTrigger asChild>
                  <div
                    className={`relative flex flex-col items-center justify-center rounded-lg border-2 px-4 py-3 min-w-[80px] transition-all hover:scale-105 cursor-default ${getHeatColor(sd.alertCount, sd.avgRejection)}`}
                  >
                    <span className="text-lg font-bold">{sd.state}</span>
                    <span className="text-xs font-medium">{sd.unitCount} unid.</span>
                    {sd.alertCount > 0 && (
                      <Badge variant="destructive" className="absolute -top-2 -right-2 text-[10px] h-5 px-1.5">
                        {sd.alertCount}
                      </Badge>
                    )}
                  </div>
                </TooltipTrigger>
                <TooltipContent className="text-sm">
                  <div className="space-y-1">
                    <p className="font-semibold">{sd.state}</p>
                    <p>Unidades: {sd.unitCount}</p>
                    <p>Candidatos: {sd.totalCandidates}</p>
                    <p>Conversão: {sd.avgConversion}%</p>
                    <p>Standby: {sd.avgRejection}%</p>
                    <p>Alertas: {sd.alertCount}</p>
                  </div>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </TooltipProvider>
        <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <div className="h-3 w-3 rounded bg-green-500/30 border border-green-500/50" />
            <span>Saudável</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="h-3 w-3 rounded bg-amber-500/30 border border-amber-500/50" />
            <span>Atenção</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="h-3 w-3 rounded bg-destructive/30 border border-destructive/50" />
            <span>Crítico</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
