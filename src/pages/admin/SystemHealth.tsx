import { useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, RefreshCw, ShieldCheck, AlertTriangle, AlertOctagon, Activity, PlayCircle } from "lucide-react";
import {
  useLatestHealthReport,
  useHealthReportHistory,
  useConfigRegistry,
  useRunHealthScan,
  useE2ERunLogs,
  useRunE2ESmoke,
} from "@/hooks/useSystemHealth";
import { logSensitiveAccess } from "@/lib/accessLogHelper";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

function StatusBadge({ status }: { status: "active" | "planned" | "deprecated" }) {
  const map = {
    active: { label: "Ativa", variant: "default" as const },
    planned: { label: "Planejada", variant: "secondary" as const },
    deprecated: { label: "Descontinuada", variant: "outline" as const },
  };
  const { label, variant } = map[status];
  return <Badge variant={variant}>{label}</Badge>;
}

export default function SystemHealth() {
  useEffect(() => { logSensitiveAccess("saude_sistema"); }, []);

  const { data: latest, isLoading: l1 } = useLatestHealthReport();
  const { data: history } = useHealthReportHistory(30);
  const { data: registry } = useConfigRegistry();
  const { data: e2eLogs } = useE2ERunLogs(20);
  const runScan = useRunHealthScan();
  const runE2E = useRunE2ESmoke();

  const overallStatus =
    !latest ? "UNKNOWN"
    : latest.critical_count > 0 ? "CRITICAL"
    : latest.warning_count > 0 ? "WARNING"
    : "OK";

  const statusColor = {
    OK: "text-emerald-600",
    WARNING: "text-amber-600",
    CRITICAL: "text-red-600",
    UNKNOWN: "text-muted-foreground",
  }[overallStatus];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Saúde do Sistema</h1>
          <p className="text-muted-foreground">
            Auditoria contínua de configurações, integrações e fluxos críticos.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => runScan.mutate()} disabled={runScan.isPending} variant="outline">
            {runScan.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Re-escanear configurações
          </Button>
          <Button onClick={() => runE2E.mutate()} disabled={runE2E.isPending}>
            {runE2E.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PlayCircle className="h-4 w-4 mr-2" />}
            Validar fluxo do candidato
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4" />Status geral</CardTitle></CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${statusColor}`}>{overallStatus}</div>
            <div className="text-xs text-muted-foreground">
              {latest ? `Última verificação: ${format(new Date(latest.scanned_at), "dd/MM HH:mm", { locale: ptBR })}` : "Nunca executado"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-600" />Saudáveis</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{latest?.healthy_count ?? 0}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-600" />Avisos</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{latest?.warning_count ?? 0}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><AlertOctagon className="h-4 w-4 text-red-600" />Críticos</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{latest?.critical_count ?? 0}</div></CardContent>
        </Card>
      </div>

      <Tabs defaultValue="findings">
        <TabsList>
          <TabsTrigger value="findings">Achados</TabsTrigger>
          <TabsTrigger value="registry">Catálogo de chaves</TabsTrigger>
          <TabsTrigger value="history">Histórico</TabsTrigger>
          <TabsTrigger value="e2e">Smoke test E2E</TabsTrigger>
        </TabsList>

        <TabsContent value="findings" className="space-y-4">
          {l1 && <div className="text-sm text-muted-foreground">Carregando…</div>}
          {!l1 && !latest && <div className="text-sm text-muted-foreground">Nenhuma verificação ainda. Clique em "Re-escanear configurações".</div>}

          {latest && (
            <>
              <Card>
                <CardHeader><CardTitle className="text-base">Configurações órfãs ({latest.orphan_keys.length})</CardTitle></CardHeader>
                <CardContent>
                  {latest.orphan_keys.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhuma configuração ativa sem valor.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {latest.orphan_keys.map((o) => (
                        <Badge key={`${o.category}:${o.key}`} variant="outline">{o.category} / {o.key}</Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">Chaves não registradas ({latest.unregistered_keys.length})</CardTitle></CardHeader>
                <CardContent>
                  {latest.unregistered_keys.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Todas as chaves estão catalogadas.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {latest.unregistered_keys.map((o) => (
                        <Badge key={`${o.category}:${o.key}`} variant="destructive">{o.category} / {o.key}</Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">Duplicidades ({latest.duplicates.length})</CardTitle></CardHeader>
                <CardContent>
                  {latest.duplicates.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhuma chave duplicada entre categorias.</p>
                  ) : (
                    <ul className="text-sm space-y-1">
                      {latest.duplicates.map((d) => (
                        <li key={d.key}><strong>{d.key}</strong> aparece em {d.count} categorias</li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="registry">
          <Card>
            <CardContent className="p-0">
              <ScrollArea className="h-[500px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Categoria</TableHead>
                      <TableHead>Chave</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Consumidor</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(registry ?? []).map((r) => (
                      <TableRow key={`${r.category}:${r.key}`}>
                        <TableCell className="font-mono text-xs">{r.category}</TableCell>
                        <TableCell className="font-mono text-xs">{r.key}</TableCell>
                        <TableCell className="text-xs">{r.expected_type}</TableCell>
                        <TableCell className="text-xs">{r.consumer_type}</TableCell>
                        <TableCell><StatusBadge status={r.status} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Origem</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right text-emerald-600">Saudáveis</TableHead>
                    <TableHead className="text-right text-amber-600">Avisos</TableHead>
                    <TableHead className="text-right text-red-600">Críticos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(history ?? []).map((h: any) => (
                    <TableRow key={h.id}>
                      <TableCell className="text-xs">{format(new Date(h.scanned_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}</TableCell>
                      <TableCell className="text-xs">{h.triggered_by}</TableCell>
                      <TableCell className="text-right">{h.total_keys}</TableCell>
                      <TableCell className="text-right">{h.healthy_count}</TableCell>
                      <TableCell className="text-right">{h.warning_count}</TableCell>
                      <TableCell className="text-right">{h.critical_count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="e2e">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Cenário</TableHead>
                    <TableHead>Resultado</TableHead>
                    <TableHead className="text-right">Duração</TableHead>
                    <TableHead>Detalhes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(e2eLogs ?? []).map((log: any) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-xs">{format(new Date(log.run_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}</TableCell>
                      <TableCell className="text-xs">{log.scenario}</TableCell>
                      <TableCell>
                        {log.success ? (
                          <Badge variant="default">Sucesso</Badge>
                        ) : (
                          <Badge variant="destructive">Falha</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs">{log.duration_ms} ms</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {log.error_message ?? `${(log.stages as any[])?.filter((s: any) => s.ok).length ?? 0}/${(log.stages as any[])?.length ?? 0} etapas`}
                      </TableCell>
                    </TableRow>
                  ))}
                  {(!e2eLogs || e2eLogs.length === 0) && (
                    <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">Nenhuma execução registrada.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
