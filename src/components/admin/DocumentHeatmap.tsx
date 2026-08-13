import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { UnitHiringMetric } from "@/hooks/useHiringAudit";

interface DocumentHeatmapProps {
  units: UnitHiringMetric[];
}

function getHeatColor(criticalCount: number, rejectionCount: number, completionRate: number): string {
  if (criticalCount > 2 || completionRate < 30) return "bg-destructive/20 border-destructive/40 text-destructive";
  if (criticalCount > 0 || rejectionCount > 3 || completionRate < 60) return "bg-amber-500/20 border-amber-500/40 text-amber-700 dark:text-amber-400";
  return "bg-green-500/15 border-green-500/30 text-green-700 dark:text-green-400";
}

export function DocumentHeatmap({ units }: DocumentHeatmapProps) {
  const sorted = useMemo(() => {
    return [...units].sort((a, b) => b.criticalCount - a.criticalCount || b.rejectionCount - a.rejectionCount);
  }, [units]);

  if (!sorted.length) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Mapa de Calor — Risco Documental por Unidade</CardTitle>
      </CardHeader>
      <CardContent>
        <TooltipProvider>
          <div className="flex flex-wrap gap-2">
            {sorted.map((u) => (
              <Tooltip key={u.unitId}>
                <TooltipTrigger asChild>
                  <div
                    className={`relative flex flex-col items-center justify-center rounded-lg border-2 px-4 py-3 min-w-[90px] transition-all hover:scale-105 cursor-default ${getHeatColor(u.criticalCount, u.rejectionCount, u.completionRate)}`}
                  >
                    <span className="text-xs font-bold text-center leading-tight max-w-[100px] truncate">{u.unitName}</span>
                    <span className="text-lg font-bold">{u.completionRate}%</span>
                    {(u.criticalCount > 0 || u.hasAlert) && (
                      <Badge variant="destructive" className="absolute -top-2 -right-2 text-[10px] h-5 px-1.5">
                        {u.criticalCount || "!"}
                      </Badge>
                    )}
                  </div>
                </TooltipTrigger>
                <TooltipContent className="text-sm">
                  <div className="space-y-1">
                    <p className="font-semibold">{u.unitName}</p>
                    <p>Total: {u.total} | Completas: {u.completed}</p>
                    <p>Conclusão: {u.completionRate}%</p>
                    <p>Tempo médio: {u.avgCompletionDays} dias</p>
                    <p>Validação: {u.avgValidationDays} dias</p>
                    <p>Rejeições: {u.rejectionCount}</p>
                    <p>Atrasadas: {u.delayedCount} | Críticas: {u.criticalCount}</p>
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
