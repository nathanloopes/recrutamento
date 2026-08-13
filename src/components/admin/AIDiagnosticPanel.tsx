import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Brain, Loader2 } from "lucide-react";
import { useAIDiagnostic, type AIDiagnosticResult } from "@/hooks/useAIDiagnostic";
import type { UnitMetrics } from "@/hooks/useUnitMonitoring";

interface AIDiagnosticPanelProps {
  units: UnitMetrics[];
  enabled: boolean;
}

function riskBadge(level: string) {
  switch (level) {
    case "high": return <Badge variant="destructive">Alto</Badge>;
    case "medium": return <Badge className="bg-amber-500 hover:bg-amber-600 border-amber-500 text-white">Médio</Badge>;
    default: return <Badge variant="secondary">Baixo</Badge>;
  }
}

export function AIDiagnosticPanel({ units, enabled }: AIDiagnosticPanelProps) {
  const { runDiagnostic, results, loading } = useAIDiagnostic();

  if (!enabled) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <Brain className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>IA Diagnóstico está desativado.</p>
          <p className="text-xs mt-1">Ative em Configurações Globais → Monitoramento → enable_ai_diagnostics</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
        <CardTitle className="text-base flex items-center gap-2 min-w-0">
          <Brain className="h-5 w-5 text-primary shrink-0" />
          Diagnóstico IA Preventivo
        </CardTitle>
        <Button size="sm" className="shrink-0" onClick={() => runDiagnostic(units)} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Brain className="h-4 w-4 mr-1" />}
          {loading ? "Analisando..." : "Executar Diagnóstico"}
        </Button>
      </CardHeader>
      <CardContent>
        {results.length === 0 && !loading && (
          <p className="text-sm text-muted-foreground text-center py-4">
            Clique em "Executar Diagnóstico" para analisar unidades com gargalos.
          </p>
        )}
        {results.length > 0 && (
          <div className="space-y-4">
            {results.map((r: AIDiagnosticResult) => (
              <div key={r.unitId} className="border rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{r.unitName}</span>
                  {riskBadge(r.riskLevel)}
                </div>
                <p className="text-sm text-muted-foreground">{r.diagnosis}</p>
                {r.suggestions.length > 0 && (
                  <div>
                    <p className="text-xs font-medium mb-1">Sugestões:</p>
                    <ul className="list-disc list-inside text-xs text-muted-foreground space-y-0.5">
                      {r.suggestions.map((s, i) => <li key={i}>{s}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
