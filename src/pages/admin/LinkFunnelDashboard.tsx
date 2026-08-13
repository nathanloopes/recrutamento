import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  LabelList,
} from "recharts";
import { Loader2, Filter, Users, ClipboardCheck, MessageSquare, CheckCircle2, BadgeCheck } from "lucide-react";
import {
  useLinkFunnelMetrics,
  useLinkFunnelSummary,
  type LinkFunnelFilters,
  type LinkFunnelRow,
} from "@/hooks/useLinkFunnelMetrics";
import { PageHelp } from "@/components/ui/page-help";

const CHANNELS = ["whatsapp", "instagram", "facebook", "email", "qrcode", "outro"];
const PRESETS = [
  { label: "7 dias", days: 7 },
  { label: "30 dias", days: 30 },
  { label: "90 dias", days: 90 },
  { label: "Tudo", days: 0 },
];

function pct(v: number | null | undefined) {
  if (v == null) return "—";
  return `${Number(v).toFixed(1).replace(".", ",")}%`;
}

function isoFromDays(days: number): string | null {
  if (days <= 0) return null;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

type SortKey =
  | "unit_name"
  | "job_title"
  | "total_applied"
  | "total_test"
  | "total_interview"
  | "total_aprovado"
  | "total_contratado"
  | "rate_aprovado";

export default function LinkFunnelDashboard() {
  const [days, setDays] = useState(30);
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [channel, setChannel] = useState<string>("");
  const [groupBy, setGroupBy] = useState<"unit_job" | "unit" | "job">("unit_job");
  const [sortKey, setSortKey] = useState<SortKey>("total_applied");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const filters: LinkFunnelFilters = useMemo(() => {
    const fromIso = from ? new Date(from).toISOString() : isoFromDays(days);
    const toIso = to ? new Date(`${to}T23:59:59`).toISOString() : null;
    return {
      from: fromIso,
      to: toIso,
      channel: channel || null,
    };
  }, [from, to, days, channel]);

  const { data: summary, isLoading: loadingSummary } = useLinkFunnelSummary(filters);
  const { data: rows = [], isLoading: loadingRows } = useLinkFunnelMetrics(filters);

  // Agrupamento
  const grouped = useMemo<LinkFunnelRow[]>(() => {
    if (groupBy === "unit_job") return rows;
    const map = new Map<string, LinkFunnelRow>();
    for (const r of rows) {
      const key =
        groupBy === "unit"
          ? `u:${r.unit_id ?? "null"}`
          : `j:${r.job_id ?? "null"}`;
      const cur = map.get(key);
      if (!cur) {
        map.set(key, {
          unit_id: groupBy === "unit" ? r.unit_id : null,
          unit_name: groupBy === "unit" ? r.unit_name : null,
          job_id: groupBy === "job" ? r.job_id : null,
          job_title: groupBy === "job" ? r.job_title : null,
          total_applied: r.total_applied,
          total_pendente: r.total_pendente,
          total_test: r.total_test,
          total_interview: r.total_interview,
          total_aprovado: r.total_aprovado,
          total_contratado: r.total_contratado,
          rate_test: null,
          rate_interview: null,
          rate_aprovado: null,
          rate_contratado: null,
        });
      } else {
        cur.total_applied += r.total_applied;
        cur.total_pendente += r.total_pendente;
        cur.total_test += r.total_test;
        cur.total_interview += r.total_interview;
        cur.total_aprovado += r.total_aprovado;
        cur.total_contratado += r.total_contratado;
      }
    }
    // recompute rates
    return Array.from(map.values()).map((r) => ({
      ...r,
      rate_test: r.total_applied ? +(100 * r.total_test / r.total_applied).toFixed(2) : null,
      rate_interview: r.total_applied ? +(100 * r.total_interview / r.total_applied).toFixed(2) : null,
      rate_aprovado: r.total_applied ? +(100 * r.total_aprovado / r.total_applied).toFixed(2) : null,
      rate_contratado: r.total_applied ? +(100 * r.total_contratado / r.total_applied).toFixed(2) : null,
    }));
  }, [rows, groupBy]);

  const sorted = useMemo(() => {
    const arr = [...grouped];
    arr.sort((a, b) => {
      const av = (a as any)[sortKey] ?? 0;
      const bv = (b as any)[sortKey] ?? 0;
      if (typeof av === "string" || typeof bv === "string") {
        const cmp = String(av ?? "").localeCompare(String(bv ?? ""));
        return sortDir === "asc" ? cmp : -cmp;
      }
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return arr;
  }, [grouped, sortKey, sortDir]);

  const funnelChartData = useMemo(() => {
    const s = summary ?? {
      total_applied: 0,
      total_pendente: 0,
      total_test: 0,
      total_interview: 0,
      total_aprovado: 0,
      total_contratado: 0,
    };
    return [
      { etapa: "Aplicou", total: s.total_applied },
      { etapa: "Ativo", total: s.total_pendente },
      { etapa: "Teste", total: s.total_test },
      { etapa: "Entrevista", total: s.total_interview },
      { etapa: "Aprovado", total: s.total_aprovado },
      { etapa: "Contratado", total: s.total_contratado },
    ];
  }, [summary]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("desc");
    }
  }

  const totalApplied = summary?.total_applied ?? 0;
  function rateOf(v: number) {
    if (!totalApplied) return null;
    return +(100 * v / totalApplied).toFixed(1);
  }

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
            <Filter className="h-7 w-7 text-amber-600" />
            Funil de candidaturas via link
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Taxa de avanço por etapa das candidaturas originadas em links <code>/v/:token</code>.
          </p>
        </div>
        <PageHelp />
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <Button
                key={p.label}
                size="sm"
                variant={days === p.days && !from && !to ? "default" : "outline"}
                onClick={() => {
                  setDays(p.days);
                  setFrom("");
                  setTo("");
                }}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">De</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-[160px]" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Até</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-[160px]" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Canal</label>
            <Select value={channel || "all"} onValueChange={(v) => setChannel(v === "all" ? "" : v)}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {CHANNELS.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Agrupar por</label>
            <Select value={groupBy} onValueChange={(v) => setGroupBy(v as any)}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unit_job">Unidade + Vaga</SelectItem>
                <SelectItem value="unit">Unidade</SelectItem>
                <SelectItem value="job">Vaga</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "Aplicou", value: summary?.total_applied ?? 0, icon: Users, color: "text-blue-600", rate: 100 },
          { label: "Ativo", value: summary?.total_pendente ?? 0, icon: Users, color: "text-slate-600", rate: rateOf(summary?.total_pendente ?? 0) },
          { label: "Teste feito", value: summary?.total_test ?? 0, icon: ClipboardCheck, color: "text-violet-600", rate: rateOf(summary?.total_test ?? 0) },
          { label: "Entrevista", value: summary?.total_interview ?? 0, icon: MessageSquare, color: "text-orange-600", rate: rateOf(summary?.total_interview ?? 0) },
          { label: "Aprovado", value: summary?.total_aprovado ?? 0, icon: CheckCircle2, color: "text-emerald-600", rate: rateOf(summary?.total_aprovado ?? 0) },
          { label: "Contratado", value: summary?.total_contratado ?? 0, icon: BadgeCheck, color: "text-amber-600", rate: rateOf(summary?.total_contratado ?? 0) },
        ].map((k) => {
          const Icon = k.icon;
          return (
            <Card key={k.label}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">{k.label}</span>
                  <Icon className={`h-4 w-4 ${k.color}`} />
                </div>
                <div className="text-2xl font-bold mt-1">
                  {loadingSummary ? <Loader2 className="h-5 w-5 animate-spin" /> : k.value.toLocaleString("pt-BR")}
                </div>
                <div className="text-xs text-muted-foreground">{k.rate == null ? "—" : `${k.rate.toString().replace(".", ",")}% do total`}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Funil visual */}
      <Card>
        <CardHeader><CardTitle>Funil global</CardTitle></CardHeader>
        <CardContent className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={funnelChartData} layout="vertical" margin={{ left: 16, right: 32 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis dataKey="etapa" type="category" width={90} />
              <Tooltip formatter={(v: any) => [v, "Candidaturas"]} />
              <Bar dataKey="total" fill="hsl(var(--primary))" radius={[0, 6, 6, 0]}>
                <LabelList dataKey="total" position="right" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Tabela */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Detalhamento</span>
            <Badge variant="secondary">{sorted.length} {sorted.length === 1 ? "linha" : "linhas"}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingRows ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando...
            </div>
          ) : sorted.length === 0 ? (
            <div className="text-center text-muted-foreground py-10 text-sm">
              Nenhuma candidatura via link no período selecionado.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {groupBy !== "job" && (
                      <TableHead className="cursor-pointer" onClick={() => toggleSort("unit_name")}>Unidade</TableHead>
                    )}
                    {groupBy !== "unit" && (
                      <TableHead className="cursor-pointer" onClick={() => toggleSort("job_title")}>Vaga</TableHead>
                    )}
                    <TableHead className="text-right cursor-pointer" onClick={() => toggleSort("total_applied")}>Aplicou</TableHead>
                    <TableHead className="text-right cursor-pointer" onClick={() => toggleSort("total_test")}>Teste</TableHead>
                    <TableHead className="text-right cursor-pointer" onClick={() => toggleSort("total_interview")}>Entrevista</TableHead>
                    <TableHead className="text-right cursor-pointer" onClick={() => toggleSort("total_aprovado")}>Aprovado</TableHead>
                    <TableHead className="text-right cursor-pointer" onClick={() => toggleSort("total_contratado")}>Contratado</TableHead>
                    <TableHead className="text-right cursor-pointer" onClick={() => toggleSort("rate_aprovado")}>Taxa aprov.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((r, idx) => {
                    const lowRate = (r.rate_aprovado ?? 0) < 10 && r.total_applied >= 5;
                    return (
                      <TableRow key={`${r.unit_id ?? "u"}-${r.job_id ?? "j"}-${idx}`} className={lowRate ? "bg-amber-50 dark:bg-amber-950/20" : ""}>
                        {groupBy !== "job" && <TableCell>{r.unit_name ?? <span className="text-muted-foreground">—</span>}</TableCell>}
                        {groupBy !== "unit" && <TableCell>{r.job_title ?? <span className="text-muted-foreground">—</span>}</TableCell>}
                        <TableCell className="text-right font-medium">{r.total_applied}</TableCell>
                        <TableCell className="text-right">{r.total_test} <span className="text-xs text-muted-foreground">({pct(r.rate_test)})</span></TableCell>
                        <TableCell className="text-right">{r.total_interview} <span className="text-xs text-muted-foreground">({pct(r.rate_interview)})</span></TableCell>
                        <TableCell className="text-right">{r.total_aprovado} <span className="text-xs text-muted-foreground">({pct(r.rate_aprovado)})</span></TableCell>
                        <TableCell className="text-right">{r.total_contratado} <span className="text-xs text-muted-foreground">({pct(r.rate_contratado)})</span></TableCell>
                        <TableCell className="text-right">
                          <Badge variant={lowRate ? "destructive" : "secondary"}>{pct(r.rate_aprovado)}</Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
