import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Activity,
  Wifi,
  WifiOff,
  MessageSquare,
  Mail,
  Bell,
  RefreshCw,
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SKIP_DELIVERY_ERRORS } from "@/lib/notificationAuditFilters";


// ─── Helpers ───────────────────────────────────────────────────────────────
const TRACKED_EVENTS = [
  "interview_scheduled",
  "interview_approved",
  "interview_reminder_24h",
  "interview_confirm_reminder_24h",
  "interview_reminder_30min",
  "interview_reminder_10min",
] as const;

type TrackedEvent = (typeof TRACKED_EVENTS)[number];

const EVENT_LABEL: Record<TrackedEvent, string> = {
  interview_scheduled: "24h",
  interview_approved: "24h",
  interview_reminder_24h: "24h",
  interview_confirm_reminder_24h: "24h",
  interview_reminder_30min: "30 min",
  interview_reminder_10min: "10 min",
};

const CHANNEL_LABEL: Record<string, string> = {
  push: "Push",
  whatsapp: "WhatsApp (Meta)",
  email: "E-mail",
  in_app: "In-app",
};

// Formata "YYYY-MM-DD" + "HH:mm:ss" (BRT) sem TZ shift
const fmtBrtDateTime = (date: string, time: string): string => {
  const d = (date || "").slice(0, 10);
  const dm = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const t = (time || "").slice(0, 5);
  if (!dm) return t;
  return `${dm[3]}/${dm[2]} às ${t}`;
};

// diff em minutos entre uma entrevista (BRT) e agora
const minutesUntilInterview = (date: string, time: string): number => {
  const iso = `${date}T${time}-03:00`;
  return (new Date(iso).getTime() - Date.now()) / 60000;
};

const fmtRelative = (min: number): string => {
  const abs = Math.abs(min);
  const sign = min < 0 ? "atrás" : "em";
  if (abs < 60) return `${sign} ${Math.round(abs)} min`;
  const h = Math.floor(abs / 60);
  const m = Math.round(abs % 60);
  return `${sign} ${h}h${m ? ` ${m}min` : ""}`;
};

// ─── Tipos ─────────────────────────────────────────────────────────────────
interface ChannelHealth {
  channel: "push" | "whatsapp" | "email";
  pendingCount: number;
  failedLastHour: number;
  sentLastHour: number;
  lastDispatchAt: Date | null;
}

type ReminderState = "delivered" | "failed" | "pending" | "none";

interface InterviewRow {
  id: string;
  candidate_id: string;
  candidate_name: string;
  scheduled_date: string;
  scheduled_time: string;
  status: string;
  instance_status: "current" | "historical" | "orphan";
  reminder_state: Record<"24h" | "30min" | "10min", ReminderState>;
  minutes_until: number;
}

interface AuditEventRow extends NotificationRow {
  interview_id: string | null;
  instance_date: string | null;
  instance_time: string | null;
  bucket: "24h" | "30min" | "10min" | null;
  delivery_state: ReminderState;
  delivery_log_count: number;
}

interface NotificationRow {
  id: string;
  event_type: string;
  recipient_id: string;
  channel: string;
  status: string;
  title: string | null;
  created_at: string;
  payload: Record<string, unknown> | null;
}

interface DeliveryLogRow {
  id: string;
  notification_id: string | null;
  channel: string;
  delivered: boolean | null;
  attempted_at: string | null;
  provider_response: Record<string, unknown> | null;
}

interface DeliveryHealthRow {
  channel: string | null;
  delivered: boolean | null;
  attempted_at: string | null;
  provider_response: Record<string, unknown> | null;
}

interface PendingNotificationRow {
  channel: string | null;
  status: string | null;
  created_at: string | null;
}

interface InterviewDbRow {
  id: string;
  candidate_id: string;
  scheduled_date: string;
  scheduled_time: string;
  status: string;
}

type InterviewInstance = Pick<InterviewRow, "id" | "candidate_id" | "candidate_name" | "scheduled_date" | "scheduled_time" | "status" | "instance_status" | "minutes_until">;

interface CandidateNameRow {
  id: string;
  full_name: string | null;
}

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

const bucketOf = (ev: string): "24h" | "30min" | "10min" | null => {
  if (
    ev === "interview_scheduled" ||
    ev === "interview_approved" ||
    ev === "interview_reminder_24h" ||
    ev === "interview_confirm_reminder_24h"
  ) return "24h";
  if (ev === "interview_reminder_30min") return "30min";
  if (ev === "interview_reminder_10min") return "10min";
  return null;
};

const normalizePayloadDate = (payload: Record<string, unknown> | null): string | null => {
  const direct = typeof payload?.date === "string" ? payload.date.slice(0, 10) : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(direct)) return direct;

  const scheduled = typeof payload?.scheduled_date === "string" ? payload.scheduled_date.slice(0, 10) : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(scheduled)) return scheduled;

  const dt = typeof payload?.interview_datetime === "string" ? payload.interview_datetime : "";
  const br = dt.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;

  return null;
};

const normalizePayloadTime = (payload: Record<string, unknown> | null): string | null => {
  const direct = typeof payload?.time === "string" ? payload.time.slice(0, 5) : "";
  if (/^\d{2}:\d{2}$/.test(direct)) return direct;

  const scheduled = typeof payload?.scheduled_time === "string" ? payload.scheduled_time.slice(0, 5) : "";
  if (/^\d{2}:\d{2}$/.test(scheduled)) return scheduled;

  const dt = typeof payload?.interview_datetime === "string" ? payload.interview_datetime : "";
  const br = dt.match(/\b(\d{2}:\d{2})\b/);
  return br?.[1] || null;
};

const instanceKey = (interviewId: string, date: string, time: string) =>
  `${interviewId}|${date.slice(0, 10)}|${time.slice(0, 5)}`;

const chunk = <T,>(items: T[], size = 500): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

const fetchPaged = async <T,>(makeQuery: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>, pageSize = 1000): Promise<T[]> => {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makeQuery(from, from + pageSize - 1);
    if (error) throw error;
    const page = (data || []) as T[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
};

// ─── Componente ────────────────────────────────────────────────────────────
export function ChannelMonitoringTab() {
  const [channelHealth, setChannelHealth] = useState<ChannelHealth[]>([]);
  const [interviews, setInterviews] = useState<InterviewRow[]>([]);
  const [recent, setRecent] = useState<AuditEventRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [pageSize, setPageSize] = useState<number>(10);
  const [visibleCount, setVisibleCount] = useState<number>(10);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const oneHourAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      // 1. Saúde por canal (últimas 24h) — fonte de verdade: delivery_logs
      // (qualquer disparo nos canais conta, inclusive templates WA Meta).
      const { data: deliveryRows } = await supabase
        .from("delivery_logs")
        .select("channel, delivered, attempted_at, provider_response")
        .gte("attempted_at", oneHourAgo);

      // Pendentes ainda saem de `notifications` (delivery_logs só registra
      // tentativas de entrega; o que ficou parado em pending fica aqui).
      const { data: pendingRows } = await supabase
        .from("notifications")
        .select("channel, status, created_at")
        .eq("status", "pending")
        .gte("created_at", oneHourAgo);


      const buckets: Record<string, ChannelHealth> = {
        push: { channel: "push", pendingCount: 0, failedLastHour: 0, sentLastHour: 0, lastDispatchAt: null },
        whatsapp: { channel: "whatsapp", pendingCount: 0, failedLastHour: 0, sentLastHour: 0, lastDispatchAt: null },
        email: { channel: "email", pendingCount: 0, failedLastHour: 0, sentLastHour: 0, lastDispatchAt: null },
      };
      // Erros "esperados" do destinatário (sem token/telefone/email cadastrado)
      // NÃO indicam degradação do canal — não contam como falha real.
      // Lista compartilhada com a Auditoria (notificationAuditFilters).
      const SKIP_ERRORS = SKIP_DELIVERY_ERRORS;

      for (const row of (deliveryRows || []) as DeliveryHealthRow[]) {
        const b = buckets[row.channel || ""];
        if (!b) continue;
        if (row.delivered) {
          b.sentLastHour++;
        } else {
          const err = row.provider_response?.error || row.provider_response?.reason;
          if (typeof err !== "string" || !SKIP_ERRORS.has(err)) b.failedLastHour++;
        }
        const dt = new Date(row.attempted_at || "");
        if (!b.lastDispatchAt || dt > b.lastDispatchAt) b.lastDispatchAt = dt;
      }
      for (const r of (pendingRows || []) as PendingNotificationRow[]) {
        const b = buckets[r.channel || ""];
        if (b) b.pendingCount++;
      }
      setChannelHealth(Object.values(buckets));

      // 2. Auditoria universal: entrevista + instância do payload + delivery_logs.
      // A chave canônica é interview_id|data|hora. Não há associação por candidato,
      // ordem, proximidade temporal, horário atual ou status mutável da entrevista.
      const [interviewRows, allTracked] = await Promise.all([
        fetchPaged<InterviewDbRow>((from, to) =>
          supabase
            .from("interviews")
            .select("id, candidate_id, scheduled_date, scheduled_time, status")
            .order("scheduled_date", { ascending: false })
            .order("scheduled_time", { ascending: false })
            .range(from, to)
        ),
        fetchPaged<NotificationRow>((from, to) =>
          supabase
            .from("notifications")
            .select("id, event_type, recipient_id, channel, status, title, created_at, payload")
            .in("event_type", [...TRACKED_EVENTS])
            .order("created_at", { ascending: false })
            .range(from, to)
        ),
      ]);

      const notificationIds = allTracked.map((n) => n.id).filter(Boolean);
      const deliveryLogs: DeliveryLogRow[] = [];
      for (const ids of chunk(notificationIds)) {
        deliveryLogs.push(...await fetchPaged<DeliveryLogRow>((from, to) =>
          supabase
            .from("delivery_logs")
            .select("id, notification_id, channel, delivered, attempted_at, provider_response")
            .in("notification_id", ids)
            .order("attempted_at", { ascending: false })
            .range(from, to)
        ));
      }

      const candidateIds = Array.from(new Set([
        ...interviewRows.map((i) => i.candidate_id),
        ...allTracked.map((n) => n.recipient_id),
      ].filter(Boolean)));
      const namesById: Record<string, string> = {};
      for (const ids of chunk(candidateIds)) {
        const { data: cands, error } = await supabase
          .from("candidates")
          .select("id, full_name")
          .in("id", ids);
        if (error) throw error;
        for (const c of (cands || []) as CandidateNameRow[]) namesById[c.id] = c.full_name || "—";
      }

      const logsByNotificationId = new Map<string, DeliveryLogRow[]>();
      for (const log of deliveryLogs) {
        if (!log.notification_id) continue;
        const arr = logsByNotificationId.get(log.notification_id) || [];
        arr.push(log);
        logsByNotificationId.set(log.notification_id, arr);
      }

      const currentByInterviewId = new Map(interviewRows.map((i) => [i.id, i]));
      const instances = new Map<string, InterviewInstance>();
      for (const i of interviewRows) {
        instances.set(instanceKey(i.id, i.scheduled_date, i.scheduled_time), {
          id: i.id,
          candidate_id: i.candidate_id,
          candidate_name: namesById[i.candidate_id] || "—",
          scheduled_date: i.scheduled_date,
          scheduled_time: i.scheduled_time,
          status: i.status,
          instance_status: "current",
          minutes_until: minutesUntilInterview(i.scheduled_date, i.scheduled_time),
        });
      }

      const stateFromLogs = (n: NotificationRow): { state: ReminderState; count: number } => {
        const logs = (logsByNotificationId.get(n.id) || []).filter((log) => log.channel !== "cascade");
        const hasRealSuccess = logs.some((log) => log.delivered === true);
        const hasRealFailure = logs.some((log) => {
          const skipped = log.provider_response?.skipped === true;
          return log.delivered === false && !skipped;
        });
        if (hasRealSuccess) return { state: "delivered", count: logs.length };
        if (hasRealFailure || n.status === "failed") return { state: "failed", count: logs.length };
        return { state: "pending", count: logs.length };
      };

      const auditEvents: AuditEventRow[] = allTracked.map((n) => {
        const delivery = stateFromLogs(n);
        return {
          ...n,
          interview_id: typeof n.payload?.interview_id === "string" ? n.payload.interview_id : null,
          instance_date: normalizePayloadDate(n.payload),
          instance_time: normalizePayloadTime(n.payload),
          bucket: bucketOf(n.event_type),
          delivery_state: delivery.state,
          delivery_log_count: delivery.count,
        };
      });

      for (const ev of auditEvents) {
        if (!ev.interview_id || !ev.instance_date || !ev.instance_time) continue;
        const key = instanceKey(ev.interview_id, ev.instance_date, ev.instance_time);
        if (instances.has(key)) continue;
        const current = currentByInterviewId.get(ev.interview_id);
        instances.set(key, {
          id: ev.interview_id,
          candidate_id: current?.candidate_id || ev.recipient_id,
          candidate_name: namesById[current?.candidate_id || ev.recipient_id] || "—",
          scheduled_date: ev.instance_date,
          scheduled_time: ev.instance_time,
          status: current ? current.status : "sem entrevista ativa",
          instance_status: current ? "historical" : "orphan",
          minutes_until: minutesUntilInterview(ev.instance_date, ev.instance_time),
        });
      }

      const agg: Record<string, Record<string, { success: number; failed: number; pending: number }>> = {};
      for (const ev of auditEvents) {
        if (!ev.interview_id || !ev.instance_date || !ev.instance_time || !ev.bucket) continue;
        const cell = ((agg[instanceKey(ev.interview_id, ev.instance_date, ev.instance_time)] ||= {})[ev.bucket] ||= {
          success: 0,
          failed: 0,
          pending: 0,
        });
        if (ev.delivery_state === "delivered") cell.success++;
        else if (ev.delivery_state === "failed") cell.failed++;
        else cell.pending++;
      }

      const templateDue = (bucket: "24h" | "30min" | "10min", row: InterviewInstance): boolean => {
        if (bucket === "24h") return row.minutes_until <= 24 * 60;
        if (bucket === "30min") return row.minutes_until <= 30;
        return row.minutes_until <= 10;
      };

      const cellState = (
        c: { success: number; failed: number; pending: number } | undefined,
        bucket: "24h" | "30min" | "10min",
        row: InterviewInstance
      ): ReminderState => {
        if (c?.success && c.success > 0) return "delivered";
        if (c?.failed && c.failed > 0) return "failed";
        if (templateDue(bucket, row)) return "failed";
        if (c?.pending && c.pending > 0) return "pending";
        return "none";
      };

      const itvRows: InterviewRow[] = Array.from(instances.values())
        .map((r) => {
          const key = instanceKey(r.id, r.scheduled_date, r.scheduled_time);
          return {
            ...r,
            reminder_state: {
              "24h": cellState(agg[key]?.["24h"], "24h", r),
              "30min": cellState(agg[key]?.["30min"], "30min", r),
              "10min": cellState(agg[key]?.["10min"], "10min", r),
            },
          };
        })
        .sort((a, b) => `${b.scheduled_date}T${b.scheduled_time}`.localeCompare(`${a.scheduled_date}T${a.scheduled_time}`));

      setRecent(auditEvents.slice(0, 40));
      setInterviews(itvRows);


      setLastRefresh(new Date());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(fetchAll, 10000);
    return () => clearInterval(t);
  }, [autoRefresh]);

  const totalPending = useMemo(
    () => channelHealth.reduce((s, c) => s + c.pendingCount, 0),
    [channelHealth]
  );
  const totalFailed = useMemo(
    () => channelHealth.reduce((s, c) => s + c.failedLastHour, 0),
    [channelHealth]
  );

  // ─── Render ──────────────────────────────────────────────────────────────
  const renderChannelIcon = (ch: string) => {
    if (ch === "whatsapp") return <MessageSquare className="h-5 w-5" />;
    if (ch === "email") return <Mail className="h-5 w-5" />;
    return <Bell className="h-5 w-5" />;
  };

  const renderStatusBadge = (status: string) => {
    const map: Record<string, { variant: BadgeVariant; icon: LucideIcon; label: string }> = {
      pending: { variant: "secondary", icon: Clock, label: "Pendente" },
      sent: { variant: "default", icon: CheckCircle2, label: "Enviado" },
      delivered: { variant: "default", icon: CheckCircle2, label: "Entregue" },
      failed: { variant: "destructive", icon: XCircle, label: "Falhou" },
      skipped: { variant: "outline", icon: AlertTriangle, label: "Pulado" },
    };
    const m = map[status] || { variant: "outline", icon: AlertTriangle, label: status };
    const Icon = m.icon;
    return (
      <Badge variant={m.variant} className="gap-1">
        <Icon className="h-3 w-3" />
        {m.label}
      </Badge>
    );
  };

  const renderReminderCell = (state: ReminderState) => {
    // Verde: template foi de fato enviado/entregue
    if (state === "delivered") return <CheckCircle2 className="h-4 w-4 text-green-600" />;
    // Vermelho: falha no disparo
    if (state === "failed") return <XCircle className="h-4 w-4 text-destructive" />;
    // Laranja: ainda não enviado (pendente ou sem registro de disparo)
    return <Clock className="h-4 w-4 text-amber-500" />;
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-sm text-muted-foreground">
            Monitoramento em tempo real dos lembretes 24h / 30min / 10min
          </p>
          {lastRefresh && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Última atualização: {lastRefresh.toLocaleTimeString("pt-BR")}
              {autoRefresh && " · auto-refresh 10s"}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={autoRefresh ? "default" : "outline"}
            size="sm"
            onClick={() => setAutoRefresh((v) => !v)}
          >
            <Activity className="h-4 w-4 mr-1" />
            Auto-refresh {autoRefresh ? "ON" : "OFF"}
          </Button>
          <Button size="sm" variant="outline" onClick={fetchAll} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Resumo geral */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Pendentes (24h)</p>
            <p className="text-2xl font-bold">{totalPending}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Falhas (24h)</p>
            <p className={`text-2xl font-bold ${totalFailed > 0 ? "text-destructive" : ""}`}>
              {totalFailed}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Instâncias auditadas</p>
            <p className="text-2xl font-bold">{interviews.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Enviados (24h)</p>

            <p className="text-2xl font-bold text-green-600">
              {channelHealth.reduce((s, c) => s + c.sentLastHour, 0)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Saúde por canal */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {channelHealth.map((ch) => {
          const online = ch.failedLastHour === 0 || ch.sentLastHour > ch.failedLastHour;
          return (
            <Card key={ch.channel}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {renderChannelIcon(ch.channel)}
                    <span className="font-medium text-sm">{CHANNEL_LABEL[ch.channel]}</span>
                  </div>
                  <Badge variant={online ? "default" : "destructive"} className="gap-1">
                    {online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                    {online ? "OK" : "Degradado"}
                  </Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-xs text-muted-foreground">Enviados</p>
                    <p className="font-semibold text-green-600">{ch.sentLastHour}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Pendentes</p>
                    <p className="font-semibold">{ch.pendingCount}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Falhas</p>
                    <p className={`font-semibold ${ch.failedLastHour > 0 ? "text-destructive" : ""}`}>
                      {ch.failedLastHour}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground text-center pt-1">
                  Último disparo:{" "}
                  {ch.lastDispatchAt
                    ? ch.lastDispatchAt.toLocaleTimeString("pt-BR")
                    : "—"}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Tabela de instâncias auditadas */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-base">Monitoramento por interview_id + instância</CardTitle>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Mostrar</span>
            <select
              value={pageSize}
              onChange={(e) => {
                const n = Number(e.target.value);
                setPageSize(n);
                setVisibleCount(n);
              }}
              className="h-8 rounded-md border bg-background px-2 text-xs"
            >
              {[10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <span>
              de {interviews.length} ({Math.min(visibleCount, interviews.length)} visíveis)
            </span>
          </div>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {interviews.length === 0 ? (
            <p className="text-sm text-muted-foreground p-4 text-center">
              Nenhuma instância de entrevista encontrada.
            </p>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="text-left">
                    <th className="p-2 px-3">Quando (BRT)</th>
                    <th className="p-2">Candidato</th>
                    <th className="p-2">interview_id</th>
                    <th className="p-2 text-center">24h</th>
                    <th className="p-2 text-center">30min</th>
                    <th className="p-2 text-center">10min</th>
                    <th className="p-2 px-3">Falta</th>
                  </tr>
                </thead>
                <tbody>
                  {interviews.slice(0, visibleCount).map((i) => (
                    <tr key={instanceKey(i.id, i.scheduled_date, i.scheduled_time)} className="border-t hover:bg-muted/30">
                      <td className="p-2 px-3 font-mono text-xs">
                        {fmtBrtDateTime(i.scheduled_date, i.scheduled_time)}
                        {i.instance_status !== "current" && (
                          <Badge variant="outline" className="ml-2 text-[10px]">
                            {i.instance_status === "historical" ? "histórico" : "órfão"}
                          </Badge>
                        )}
                      </td>
                      <td className="p-2 truncate max-w-[200px]" title={i.candidate_name}>
                        {i.candidate_name}
                      </td>
                      <td className="p-2 font-mono text-[10px] text-muted-foreground max-w-[180px] truncate" title={i.id}>
                        {i.id}
                      </td>
                      <td className="p-2 text-center">
                        {renderReminderCell(i.reminder_state["24h"])}
                      </td>
                      <td className="p-2 text-center">
                        {renderReminderCell(i.reminder_state["30min"])}
                      </td>
                      <td className="p-2 text-center">
                        {renderReminderCell(i.reminder_state["10min"])}
                      </td>
                      <td className="p-2 px-3 text-xs text-muted-foreground">
                        {fmtRelative(i.minutes_until)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {visibleCount < interviews.length && (
                <div className="flex items-center justify-center gap-2 p-3 border-t">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setVisibleCount((c) => c + pageSize)}
                  >
                    Ver mais {Math.min(pageSize, interviews.length - visibleCount)}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setVisibleCount(interviews.length)}
                  >
                    Ver todos ({interviews.length})
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>


      {/* Console de disparos recentes */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Console — últimos 40 disparos</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground p-4 text-center">
              Nenhum disparo recente para esses eventos.
            </p>
          ) : (
            <div className="divide-y max-h-[500px] overflow-y-auto">
              {recent.map((n) => (
                <div key={n.id} className="p-3 hover:bg-muted/30 text-xs">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {EVENT_LABEL[n.event_type as TrackedEvent] || n.event_type}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        {CHANNEL_LABEL[n.channel] || n.channel}
                      </Badge>
                      {renderStatusBadge(n.delivery_state === "delivered" ? "delivered" : n.delivery_state === "failed" ? "failed" : "pending")}
                    </div>
                    <span className="font-mono text-muted-foreground whitespace-nowrap">
                      {new Date(n.created_at).toLocaleString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </span>
                  </div>
                  {n.title && <p className="text-foreground truncate">{n.title}</p>}
                  {n.interview_id && (
                    <p className="text-muted-foreground font-mono text-[10px] truncate">
                      interview: {n.interview_id}
                      {n.instance_date && n.instance_time ? ` · instância ${fmtBrtDateTime(n.instance_date, n.instance_time)}` : " · instância sem snapshot"}
                      {` · logs ${n.delivery_log_count}`}
                      {n.payload?.meeting_link ? " · link ok" : " · sem link"}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
