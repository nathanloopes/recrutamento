import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, XCircle, AlertTriangle, TrendingUp, Users } from "lucide-react";

function useInterviewDecisionMetrics() {
  return useQuery({
    queryKey: ["interview_decision_metrics"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("interview_feedback" as any)
        .select(`
          id, decision, created_at, guide_id, interview_id,
          interview_guides:guide_id(job_id, jobs:job_id(title)),
          interviews:interview_id(
            unit_id,
            units:unit_id(name),
            applications:application_id(
              unit_jobs:unit_job_id(jobs:job_id(title))
            )
          )
        `)
        .order("created_at", { ascending: false })
        .limit(1000);

      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

const DECISION_COLORS: Record<string, string> = {
  presencial: "hsl(var(--primary))",
  standby: "hsl(45, 93%, 47%)",
  encerrado: "hsl(var(--destructive))",
};

const DECISION_LABELS: Record<string, string> = {
  presencial: "Aprovado",
  standby: "Standby",
  encerrado: "Encerrado",
};

export function InterviewDashboardFranqueadora() {
  const { data: feedbacks, isLoading } = useInterviewDecisionMetrics();

  const metrics = useMemo(() => {
    if (!feedbacks?.length) return null;

    const total = feedbacks.length;
    const byDecision: Record<string, number> = {};
    const byJob: Record<string, { title: string; presencial: number; standby: number; encerrado: number; total: number }> = {};
    const byUnit: Record<string, { name: string; presencial: number; standby: number; encerrado: number; total: number }> = {};

    for (const f of feedbacks) {
      const d = f.decision || "desconhecido";
      byDecision[d] = (byDecision[d] || 0) + 1;

      const jobTitle =
        f.interview_guides?.jobs?.title ||
        f.interviews?.applications?.unit_jobs?.jobs?.title ||
        "Sem cargo";
      if (!byJob[jobTitle]) byJob[jobTitle] = { title: jobTitle, presencial: 0, standby: 0, encerrado: 0, total: 0 };
      if (d === "presencial" || d === "standby" || d === "encerrado") {
        byJob[jobTitle][d] = (byJob[jobTitle][d] || 0) + 1;
      }
      byJob[jobTitle].total++;

      const unitName = f.interviews?.units?.name || "Sem unidade";
      if (!byUnit[unitName]) byUnit[unitName] = { name: unitName, presencial: 0, standby: 0, encerrado: 0, total: 0 };
      if (d === "presencial" || d === "standby" || d === "encerrado") {
        byUnit[unitName][d] = (byUnit[unitName][d] || 0) + 1;
      }
      byUnit[unitName].total++;
    }

    const pieData = Object.entries(byDecision).map(([key, value]) => ({
      name: DECISION_LABELS[key] || key,
      value,
      color: DECISION_COLORS[key] || "hsl(var(--muted))",
    }));

    const jobData = Object.values(byJob).sort((a, b) => b.total - a.total).slice(0, 15);
    const unitData = Object.values(byUnit).sort((a, b) => b.total - a.total).slice(0, 15);

    return {
      total,
      aprovados: byDecision["presencial"] || 0,
      standby: byDecision["standby"] || 0,
      encerrados: byDecision["encerrado"] || 0,
      taxaAprovacao: total > 0 ? Math.round(((byDecision["presencial"] || 0) / total) * 100) : 0,
      taxaEncerramento: total > 0 ? Math.round(((byDecision["encerrado"] || 0) / total) * 100) : 0,
      pieData,
      jobData,
      unitData,
    };
  }, [feedbacks]);

  if (isLoading) return <Skeleton className="h-96 w-full" />;
  if (!metrics) return <p className="text-center text-muted-foreground py-8">Nenhum dado de entrevista encontrado.</p>;

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Card>
          <CardContent className="p-4 text-center">
            <Users className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
            <p className="text-2xl font-bold">{metrics.total}</p>
            <p className="text-xs text-muted-foreground">Total Entrevistas</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <CheckCircle2 className="h-5 w-5 mx-auto text-primary mb-1" />
            <p className="text-2xl font-bold">{metrics.aprovados}</p>
            <p className="text-xs text-muted-foreground">Aprovados</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <AlertTriangle className="h-5 w-5 mx-auto text-yellow-500 mb-1" />
            <p className="text-2xl font-bold">{metrics.standby}</p>
            <p className="text-xs text-muted-foreground">Standby</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <XCircle className="h-5 w-5 mx-auto text-destructive mb-1" />
            <p className="text-2xl font-bold">{metrics.encerrados}</p>
            <p className="text-xs text-muted-foreground">Encerrados</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <TrendingUp className="h-5 w-5 mx-auto text-primary mb-1" />
            <p className="text-2xl font-bold">{metrics.taxaAprovacao}%</p>
            <p className="text-xs text-muted-foreground">Taxa Aprovação</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Decisões por Cargo */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Decisões por Cargo</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={{
                presencial: { label: "Aprovado", color: "hsl(var(--primary))" },
                standby: { label: "Standby", color: "hsl(45, 93%, 47%)" },
                encerrado: { label: "Encerrado", color: "hsl(var(--destructive))" },
              }}
              className="h-[260px] w-full"
            >
              <BarChart data={metrics.jobData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="title" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" height={60} />
                <YAxis />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="presencial" stackId="a" fill="hsl(var(--primary))" />
                <Bar dataKey="standby" stackId="a" fill="hsl(45, 93%, 47%)" />
                <Bar dataKey="encerrado" stackId="a" fill="hsl(var(--destructive))" />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Distribuição Geral */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Distribuição de Decisões</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-center">
            <ChartContainer config={{}} className="h-[260px] w-full">
              <PieChart>
                <Pie data={metrics.pieData} cx="50%" cy="50%" outerRadius={90} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                  {metrics.pieData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <ChartTooltip />
              </PieChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      {/* Table by Unit */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Métricas por Unidade</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Unidade</TableHead>
                <TableHead className="text-center">Total</TableHead>
                <TableHead className="text-center">Aprovados</TableHead>
                <TableHead className="text-center">Standby</TableHead>
                <TableHead className="text-center">Encerrados</TableHead>
                <TableHead className="text-center">Taxa Aprovação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {metrics.unitData.map((u) => {
                const rate = u.total > 0 ? Math.round((u.presencial / u.total) * 100) : 0;
                return (
                  <TableRow key={u.name}>
                    <TableCell className="font-medium">{u.name}</TableCell>
                    <TableCell className="text-center">{u.total}</TableCell>
                    <TableCell className="text-center">{u.presencial}</TableCell>
                    <TableCell className="text-center">{u.standby}</TableCell>
                    <TableCell className="text-center">{u.encerrado}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant={rate >= 60 ? "default" : rate >= 30 ? "outline" : "destructive"}>
                        {rate}%
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
