import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Link2, Copy, BarChart3, MousePointerClick, Send, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { useRecruitmentLinksMetrics, type LinkMetricRow } from "@/hooks/useRecruitmentLinksMetrics";
import { PageHelp } from "@/components/ui/page-help";

const CHANNELS = ["whatsapp", "instagram", "facebook", "email", "qrcode", "outro"];

function formatPct(v: number | null) {
  if (v == null) return "—";
  return `${Number(v).toFixed(1).replace(".", ",")}%`;
}

function buildPublicUrl(token: string) {
  if (typeof window === "undefined") return `/v/${token}`;
  return `${window.location.origin}/v/${token}`;
}

export default function RecruitmentLinksMetrics() {
  const [channel, setChannel] = useState<string>("");
  const [campaign, setCampaign] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  const filters = useMemo(
    () => ({
      channel: channel || null,
      campaign: campaign.trim() || null,
      from: from ? new Date(from).toISOString() : null,
      to: to ? new Date(`${to}T23:59:59`).toISOString() : null,
    }),
    [channel, campaign, from, to]
  );

  const { data: rows = [], isLoading, error } = useRecruitmentLinksMetrics(filters);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        acc.clicks += r.clicks ?? 0;
        acc.apps += Number(r.applications ?? 0);
        acc.contratado += Number(r.contratado ?? 0);
        return acc;
      },
      { clicks: 0, apps: 0, contratado: 0 }
    );
  }, [rows]);

  const conv = totals.clicks > 0 ? (totals.apps / totals.clicks) * 100 : null;
  const hire = totals.apps > 0 ? (totals.contratado / totals.apps) * 100 : null;

  const groupedByChannel = useMemo(() => groupBy(rows, (r) => r.channel || "—"), [rows]);
  const groupedByCampaign = useMemo(
    () => groupBy(rows, (r) => r.campaign || "(sem campanha)"),
    [rows]
  );

  const copyUrl = async (token: string) => {
    try {
      await navigator.clipboard.writeText(buildPublicUrl(token));
      toast.success("URL copiada");
    } catch {
      toast.error("Não foi possível copiar");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            Links de recrutamento
          </h1>
          <p className="text-sm text-muted-foreground">
            Conversão por canal e campanha: cliques, candidaturas geradas e status final.
          </p>
        </div>
        <PageHelp />

      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Canal</label>
            <Select value={channel || "all"} onValueChange={(v) => setChannel(v === "all" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {CHANNELS.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Campanha</label>
            <Input
              value={campaign}
              onChange={(e) => setCampaign(e.target.value)}
              placeholder="ex: black-friday"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">De</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Até</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setChannel("");
                setCampaign("");
                setFrom("");
                setTo("");
              }}
            >
              Limpar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard icon={<MousePointerClick className="h-4 w-4" />} label="Cliques" value={totals.clicks} />
        <KpiCard icon={<Send className="h-4 w-4" />} label="Candidaturas" value={totals.apps} />
        <KpiCard label="Conversão" value={formatPct(conv)} />
        <KpiCard icon={<CheckCircle2 className="h-4 w-4" />} label="Contratados" value={totals.contratado} />
        <KpiCard label="Taxa hire" value={formatPct(hire)} />
      </div>

      {error && (
        <Card><CardContent className="p-4 text-sm text-destructive">
          Erro ao carregar métricas: {(error as any)?.message ?? "desconhecido"}
        </CardContent></Card>
      )}

      <Tabs defaultValue="canal">
        <TabsList>
          <TabsTrigger value="canal">Por canal</TabsTrigger>
          <TabsTrigger value="campanha">Por campanha</TabsTrigger>
          <TabsTrigger value="link">Por link</TabsTrigger>
        </TabsList>

        <TabsContent value="canal">
          <GroupedView title="Canal" rows={groupedByChannel} loading={isLoading} />
        </TabsContent>

        <TabsContent value="campanha">
          <GroupedView title="Campanha" rows={groupedByCampaign} loading={isLoading} />
        </TabsContent>

        <TabsContent value="link">
          <Card>
            <CardHeader><CardTitle className="text-base">Detalhe por link</CardTitle></CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              {isLoading ? (
                <div className="p-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
              ) : rows.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  Nenhum link encontrado para os filtros selecionados.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vaga / Unidade</TableHead>
                      <TableHead>Canal</TableHead>
                      <TableHead>Campanha</TableHead>
                      <TableHead className="text-right">Cliques</TableHead>
                      <TableHead className="text-right">Cands.</TableHead>
                      <TableHead className="text-right">Conv.</TableHead>
                      <TableHead className="text-right">Contratados</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.link_id}>
                        <TableCell>
                          <div className="font-medium text-sm">{r.job_title ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">
                            {r.unit_name} {r.unit_city ? `· ${r.unit_city}/${r.unit_state}` : ""}
                          </div>
                        </TableCell>
                        <TableCell><Badge variant="outline">{r.channel}</Badge></TableCell>
                        <TableCell className="text-sm">{r.campaign || <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.clicks}</TableCell>
                        <TableCell className="text-right tabular-nums">{Number(r.applications)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatPct(r.conv_rate)}</TableCell>
                        <TableCell className="text-right tabular-nums">{Number(r.contratado)}</TableCell>
                        <TableCell>
                          {r.is_active ? (
                            <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15">Ativo</Badge>
                          ) : (
                            <Badge variant="secondary">Inativo</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" onClick={() => copyUrl(r.token)} title="Copiar URL">
                            <Copy className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function KpiCard({ icon, label, value }: { icon?: React.ReactNode; label: string; value: number | string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">{icon}{label}</div>
        <div className="text-2xl font-bold tabular-nums mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}

interface GroupRow {
  key: string;
  clicks: number;
  applications: number;
  contratado: number;
  em_andamento: number;
  aprovado: number;
  desistente: number;
  desligado: number;
  on_hold: number;
}

function groupBy(rows: LinkMetricRow[], keyFn: (r: LinkMetricRow) => string): GroupRow[] {
  const map = new Map<string, GroupRow>();
  for (const r of rows) {
    const k = keyFn(r);
    const cur = map.get(k) ?? {
      key: k, clicks: 0, applications: 0, contratado: 0,
      em_andamento: 0, aprovado: 0, desistente: 0, desligado: 0, on_hold: 0,
    };
    cur.clicks += r.clicks ?? 0;
    cur.applications += Number(r.applications ?? 0);
    cur.contratado += Number(r.contratado ?? 0);
    cur.em_andamento += Number(r.em_andamento ?? 0);
    cur.aprovado += Number(r.aprovado ?? 0);
    cur.desistente += Number(r.desistente ?? 0);
    cur.desligado += Number(r.desligado ?? 0);
    cur.on_hold += Number(r.on_hold ?? 0);
    map.set(k, cur);
  }
  return Array.from(map.values()).sort((a, b) => b.applications - a.applications);
}

function GroupedView({ title, rows, loading }: { title: string; rows: GroupRow[]; loading: boolean }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Funil por {title.toLowerCase()}</CardTitle></CardHeader>
        <CardContent className="h-72">
          {loading ? (
            <div className="h-full grid place-items-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : rows.length === 0 ? (
            <div className="h-full grid place-items-center text-sm text-muted-foreground">
              Sem dados para o período.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows.slice(0, 10)}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="key" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="clicks" name="Cliques" fill="hsl(var(--muted-foreground))" />
                <Bar dataKey="applications" name="Candidaturas" fill="hsl(var(--primary))" />
                <Bar dataKey="contratado" name="Contratados" fill="hsl(142 71% 45%)" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">{title}s</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{title}</TableHead>
                <TableHead className="text-right">Cliques</TableHead>
                <TableHead className="text-right">Candidaturas</TableHead>
                <TableHead className="text-right">Conv.</TableHead>
                <TableHead className="text-right">Em andamento</TableHead>
                <TableHead className="text-right">Aprovados</TableHead>
                <TableHead className="text-right">Contratados</TableHead>
                <TableHead className="text-right">Standby</TableHead>
                <TableHead className="text-right">Desistentes</TableHead>
                <TableHead className="text-right">Desligados</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((g) => {
                const conv = g.clicks > 0 ? (g.applications / g.clicks) * 100 : null;
                return (
                  <TableRow key={g.key}>
                    <TableCell className="font-medium">{g.key}</TableCell>
                    <TableCell className="text-right tabular-nums">{g.clicks}</TableCell>
                    <TableCell className="text-right tabular-nums">{g.applications}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPct(conv)}</TableCell>
                    <TableCell className="text-right tabular-nums">{g.em_andamento}</TableCell>
                    <TableCell className="text-right tabular-nums">{g.aprovado}</TableCell>
                    <TableCell className="text-right tabular-nums">{g.contratado}</TableCell>
                    <TableCell className="text-right tabular-nums">{g.on_hold}</TableCell>
                    <TableCell className="text-right tabular-nums">{g.desistente}</TableCell>
                    <TableCell className="text-right tabular-nums">{g.desligado}</TableCell>
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
