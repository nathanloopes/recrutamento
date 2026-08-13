import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Brain, RefreshCw, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Insight {
  type: "gargalo" | "recomendacao" | "benchmark";
  message: string;
  severity?: "info" | "warning" | "critical";
}

export function DashboardAIInsights() {
  const [loading, setLoading] = useState(false);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [lastGenerated, setLastGenerated] = useState<string | null>(null);

  const generateInsights = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("diagnose-units", {
        body: { scope: "dashboard_insights" },
      });

      if (error) throw error;

      const parsed: Insight[] = [];
      if (data?.diagnostics && Array.isArray(data.diagnostics)) {
        data.diagnostics.forEach((d: any) => {
          if (d.diagnosis) {
            // Parse AI text into insights
            const lines = d.diagnosis.split("\n").filter((l: string) => l.trim().length > 10);
            lines.forEach((line: string) => {
              const cleanLine = line.replace(/^[-•*]\s*/, "").trim();
              if (cleanLine) {
                parsed.push({
                  type: cleanLine.toLowerCase().includes("gargalo") ? "gargalo" : 
                        cleanLine.toLowerCase().includes("compar") ? "benchmark" : "recomendacao",
                  message: cleanLine,
                  severity: cleanLine.toLowerCase().includes("crítico") || cleanLine.toLowerCase().includes("urgente") ? "critical" :
                           cleanLine.toLowerCase().includes("atenção") || cleanLine.toLowerCase().includes("alerta") ? "warning" : "info",
                });
              }
            });
          }
        });
      }

      setInsights(parsed.slice(0, 8));
      setLastGenerated(new Date().toLocaleString("pt-BR"));
      if (parsed.length === 0) {
        toast.info("Nenhum insight gerado. O sistema está operando normalmente.");
      }
    } catch (err: any) {
      toast.error("Erro ao gerar insights: " + (err.message || "Erro desconhecido"));
    } finally {
      setLoading(false);
    }
  };

  const severityColor: Record<string, string> = {
    critical: "destructive",
    warning: "secondary",
    info: "outline",
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
        <CardTitle className="text-lg flex items-center gap-2 min-w-0">
          <Sparkles className="h-5 w-5 text-violet-500 shrink-0" />
          Insights IA
        </CardTitle>
        <Button
          size="sm"
          variant="outline"
          onClick={generateInsights}
          disabled={loading}
          className="gap-1"
        >
          {loading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Brain className="h-3 w-3" />}
          {loading ? "Analisando..." : "Gerar Insights"}
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : insights.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            Clique em "Gerar Insights" para que a IA analise padrões do recrutamento
          </p>
        ) : (
          <div className="space-y-2">
            {insights.map((insight, i) => (
              <div key={i} className="flex items-start gap-2 p-3 rounded-lg bg-muted/40 border border-border/50">
                <Badge
                  variant={severityColor[insight.severity || "info"] as any}
                  className="text-[10px] mt-0.5 shrink-0"
                >
                  {insight.type === "gargalo" ? "GARGALO" : insight.type === "benchmark" ? "BENCHMARK" : "SUGESTÃO"}
                </Badge>
                <p className="text-sm">{insight.message}</p>
              </div>
            ))}
            {lastGenerated && (
              <p className="text-xs text-muted-foreground text-right mt-2">
                Gerado em {lastGenerated}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
