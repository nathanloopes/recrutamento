import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Send, XCircle, BarChart3, Download, Loader2, Sparkles } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { useNotificationAuditMetrics } from "@/hooks/useNotificationAudit";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { EVENT_TYPE_LABELS } from "@/lib/notificationLabels";

export function NotificationAuditEnhanced() {
  const { data: auditMetrics, isLoading } = useNotificationAuditMetrics();
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnosis, setDiagnosis] = useState<string | null>(null);

  const eventMetrics = useMemo(() => {
    if (!auditMetrics?.rawLogs) return [];
    const map: Record<string, { total: number; delivered: number }> = {};
    for (const l of auditMetrics.rawLogs) {
      const evt = l.notifications?.event_type || "unknown";
      if (!map[evt]) map[evt] = { total: 0, delivered: 0 };
      map[evt].total++;
      if (l.delivered) map[evt].delivered++;
    }
    return Object.entries(map)
      .map(([event, m]) => ({
        event,
        label: EVENT_TYPE_LABELS[event] || event,
        total: m.total,
        delivered: m.delivered,
        failed: m.total - m.delivered,
        rate: m.total > 0 ? Math.round((m.delivered / m.total) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 15);
  }, [auditMetrics]);

  const getHealthBadge = (rate: number) => {
    if (rate >= 90) return <Badge variant="default">Saudável</Badge>;
    if (rate >= 70) return <Badge variant="secondary">Atenção</Badge>;
    return <Badge variant="destructive">Crítico</Badge>;
  };

  const handleDiagnose = async () => {
    if (!auditMetrics) return;
    setDiagnosing(true);
    setDiagnosis(null);
    try {
      const channelSummary = (auditMetrics.byChannel || [])
        .map(c => `${c.channel}: ${c.total} envios, ${c.rate}% taxa entrega`)
        .join("; ");
      const eventSummary = eventMetrics.slice(0, 10)
        .map(e => `${e.label}: ${e.total} envios, ${e.rate}% taxa`)
        .join("; ");

      const { data, error } = await supabase.functions.invoke("faq-assistant", {
        body: {
          question: `Você é um analista de comunicação institucional. Analise os dados de entrega de notificações e gere um diagnóstico técnico:

Métricas gerais: ${auditMetrics.total} disparos, ${auditMetrics.rate}% taxa entrega, ${auditMetrics.failed} falhas.
Por canal: ${channelSummary}.
Por evento: ${eventSummary}.

Identifique: 1) Padrões de falhas recorrentes, 2) Canais com instabilidade, 3) Eventos com erro recorrente, 4) Recomendações de ação. Responda em português, formato markdown conciso.`,
        },
      });
      if (error) throw error;
      setDiagnosis(data?.answer || data?.response || "Sem resposta da IA");
    } catch (e: any) {
      toast.error("Erro no diagnóstico: " + e.message);
    } finally {
      setDiagnosing(false);
    }
  };

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <Send className="h-5 w-5 mx-auto text-primary mb-1" />
            <p className="text-2xl font-bold">{auditMetrics?.total || 0}</p>
            <p className="text-xs text-muted-foreground">Total Disparos</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <BarChart3 className="h-5 w-5 mx-auto text-primary mb-1" />
            <p className="text-2xl font-bold">{auditMetrics?.rate || 0}%</p>
            <p className="text-xs text-muted-foreground">Taxa de Entrega</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <XCircle className="h-5 w-5 mx-auto text-destructive mb-1" />
            <p className="text-2xl font-bold">{auditMetrics?.failed || 0}</p>
            <p className="text-xs text-muted-foreground">Total Falhas</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="canal">
        <TabsList>
          <TabsTrigger value="canal">Por Canal</TabsTrigger>
          <TabsTrigger value="evento">Por Evento</TabsTrigger>
        </TabsList>

        <TabsContent value="canal" className="space-y-4">
          {auditMetrics?.byChannel?.length ? (
            <Card>
              <CardContent className="p-4">
                <p className="text-sm font-semibold mb-3">Performance por Canal</p>
                <div className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={auditMetrics.byChannel}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="channel" tickFormatter={(v) => v === "push" ? "Push" : v === "whatsapp" ? "WhatsApp" : "E-mail"} />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="delivered" name="Entregues" fill="hsl(var(--primary))" radius={[4,4,0,0]} />
                      <Bar dataKey="failed" name="Falhas" fill="hsl(var(--destructive))" radius={[4,4,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Canal</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Entregues</TableHead>
                    <TableHead className="text-right">Falhas</TableHead>
                    <TableHead className="text-right">Taxa (%)</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!auditMetrics?.byChannel?.length ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Sem dados</TableCell></TableRow>
                  ) : auditMetrics.byChannel.map((ch) => (
                    <TableRow key={ch.channel}>
                      <TableCell className="font-medium capitalize">{ch.channel === "push" ? "Push" : ch.channel === "whatsapp" ? "WhatsApp" : "E-mail"}</TableCell>
                      <TableCell className="text-right">{ch.total}</TableCell>
                      <TableCell className="text-right">{ch.delivered}</TableCell>
                      <TableCell className="text-right">{ch.failed}</TableCell>
                      <TableCell className="text-right font-semibold">{ch.rate}%</TableCell>
                      <TableCell>{getHealthBadge(ch.rate)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="evento" className="space-y-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Evento</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Entregues</TableHead>
                    <TableHead className="text-right">Falhas</TableHead>
                    <TableHead className="text-right">Taxa (%)</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!eventMetrics.length ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Sem dados por evento</TableCell></TableRow>
                  ) : eventMetrics.map((e) => (
                    <TableRow key={e.event}>
                      <TableCell className="text-sm">{e.label}</TableCell>
                      <TableCell className="text-right">{e.total}</TableCell>
                      <TableCell className="text-right">{e.delivered}</TableCell>
                      <TableCell className="text-right">{e.failed}</TableCell>
                      <TableCell className="text-right font-semibold">{e.rate}%</TableCell>
                      <TableCell>{getHealthBadge(e.rate)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="flex justify-between">
        <Button variant="outline" size="sm" onClick={handleDiagnose} disabled={diagnosing || !auditMetrics?.total}>
          {diagnosing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}
          Diagnosticar com IA
        </Button>
        <Button variant="outline" size="sm" onClick={() => {
          if (!auditMetrics?.byChannel?.length) return;
          const rows = auditMetrics.byChannel.map(c => `${c.channel},${c.total},${c.delivered},${c.failed},${c.rate}`);
          const csv = "Canal,Total,Entregues,Falhas,Taxa%\n" + rows.join("\n");
          const blob = new Blob([csv], { type: "text/csv" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a"); a.href = url; a.download = "auditoria_notificacoes.csv"; a.click();
          URL.revokeObjectURL(url);
        }}>
          <Download className="h-4 w-4 mr-1" /> Exportar CSV
        </Button>
      </div>

      {diagnosis && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4">
            <p className="text-xs font-medium text-primary flex items-center gap-1 mb-2"><Sparkles className="h-3 w-3" /> Diagnóstico IA</p>
            <div className="prose prose-sm max-w-none text-sm whitespace-pre-wrap">{diagnosis}</div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
