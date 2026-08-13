import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Bell, CheckCheck, Loader2, ExternalLink, AlertCircle, Filter, Send, BarChart3, XCircle, RefreshCw, CalendarIcon, Settings2, Download } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { useMyNotifications, useMarkAsRead, useMarkAllAsRead, useUnreadCount } from "@/hooks/useNotifications";
import { useNotificationAuditMetrics, useFilteredDeliveryLogs, useReprocessNotification } from "@/hooks/useNotificationAudit";
import { resolveNotificationRoute } from "@/lib/notificationRoutes";
import { PageHelp } from "@/components/ui/page-help";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { EVENT_TYPE_LABELS } from "@/lib/notificationLabels";

type NotifFilter = "all" | "unread" | "action_required";

export default function AdminNotifications() {
  const { data: notifications, isLoading } = useMyNotifications();
  const { data: unreadCount } = useUnreadCount();
  const markAsRead = useMarkAsRead();
  const markAllAsRead = useMarkAllAsRead();
  const navigate = useNavigate();
  const { hasRole } = useAuth();

  // Notification list filters
  const [statusFilter, setStatusFilter] = useState<NotifFilter>("all");
  const [eventFilter, setEventFilter] = useState("all");

  // Admin-only: logs & audit
  const isManager = hasRole("admin") || hasRole("rh_franqueadora");

  // Logs filters (admin only)
  const [logChannel, setLogChannel] = useState("all");
  const [logStatus, setLogStatus] = useState("all");
  const [logEvent, setLogEvent] = useState("all");
  const [logDateFrom, setLogDateFrom] = useState<Date | undefined>();
  const [logDateTo, setLogDateTo] = useState<Date | undefined>();

  const deliveredFilter = logStatus === "all" ? null : logStatus === "delivered" ? true : false;
  const { data: filteredLogs, isLoading: logsLoading } = useFilteredDeliveryLogs(
    isManager ? {
      channel: logChannel !== "all" ? logChannel : undefined,
      delivered: deliveredFilter !== null ? deliveredFilter : undefined,
      eventType: logEvent !== "all" ? logEvent : undefined,
      dateFrom: logDateFrom ? format(logDateFrom, "yyyy-MM-dd") : undefined,
      dateTo: logDateTo ? format(logDateTo, "yyyy-MM-dd") : undefined,
    } : {}
  );
  const { data: auditMetrics, isLoading: auditLoading } = useNotificationAuditMetrics();
  const reprocess = useReprocessNotification();

  // Filtered notifications
  const filteredNotifications = useMemo(() => {
    if (!notifications) return [];
    let list = notifications;
    if (statusFilter === "unread") list = list.filter((n: any) => !n.read_at);
    if (statusFilter === "action_required") list = list.filter((n: any) => n.action_type === "action_required");
    if (eventFilter !== "all") list = list.filter((n: any) => n.event_type === eventFilter);
    return list;
  }, [notifications, statusFilter, eventFilter]);

  // Unique event types from user's notifications (for dropdown)
  const availableEventTypes = useMemo(() => {
    if (!notifications) return [];
    const types = [...new Set(notifications.map((n: any) => n.event_type))];
    return types.sort();
  }, [notifications]);

  const handleClick = (n: any) => {
    if (!n.read_at) markAsRead.mutate(n.id);
    const url = n.action_url || resolveNotificationRoute(n.event_type, n.payload || {}).actionUrl;
    if (n.event_type === "faq_resposta") {
      navigate("/admin/faq");
    } else if (url) {
      navigate(url);
    }
  };

  const getHealthBadge = (rate: number) => {
    if (rate >= 90) return <Badge variant="default">Saudável</Badge>;
    if (rate >= 70) return <Badge variant="secondary">Atenção</Badge>;
    return <Badge variant="destructive">Crítico</Badge>;
  };

  return (
    <div className="space-y-4 safe-left safe-right">
      <div className="flex flex-wrap items-center justify-between gap-2 w-full min-w-0">
        <h1 className="text-xl font-bold flex items-center gap-2 min-w-0 flex-1">
          <Bell className="h-5 w-5 shrink-0" /> <span className="truncate">Minhas Notificações</span> <PageHelp />
        </h1>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
          {isManager && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/admin/notificacoes")}
              className="flex-1 sm:flex-initial justify-center max-w-full"
            >
              <Settings2 className="h-3 w-3 mr-1 shrink-0" /> <span className="truncate">Gestão</span>
            </Button>
          )}
          {(unreadCount ?? 0) > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => markAllAsRead.mutate()}
              disabled={markAllAsRead.isPending}
              className="flex-1 sm:flex-initial justify-center max-w-full"
            >
              {markAllAsRead.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1 shrink-0" /> : <CheckCheck className="h-3 w-3 mr-1 shrink-0" />}
              <span className="truncate">Marcar todas como lidas</span>
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="notifications">
        <TabsList>
          <TabsTrigger value="notifications">
            Notificações
            {(unreadCount ?? 0) > 0 && (
              <Badge variant="destructive" className="ml-1.5 text-[9px] h-4 min-w-4 px-1">
                {unreadCount! > 99 ? "99+" : unreadCount}
              </Badge>
            )}
          </TabsTrigger>
          {isManager && <TabsTrigger value="logs">Logs de Entrega</TabsTrigger>}
          {isManager && <TabsTrigger value="audit">Auditoria</TabsTrigger>}
        </TabsList>

        {/* ── Tab: Notificações ── */}
        <TabsContent value="notifications" className="space-y-3">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
            <div className="flex items-center gap-1.5">
              <Filter className="h-3.5 w-3.5 text-muted-foreground" />
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as NotifFilter)}>
                <SelectTrigger className="w-full sm:w-40 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="unread">Não lidas</SelectItem>
                  <SelectItem value="action_required">Ação necessária</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {availableEventTypes.length > 1 && (
              <Select value={eventFilter} onValueChange={setEventFilter}>
                <SelectTrigger className="w-full sm:w-48 h-8 text-xs">
                  <SelectValue placeholder="Tipo de evento" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os tipos</SelectItem>
                  {availableEventTypes.map((et: string) => (
                    <SelectItem key={et} value={et}>
                      {EVENT_TYPE_LABELS[et] || et}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {(statusFilter !== "all" || eventFilter !== "all") && (
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setStatusFilter("all"); setEventFilter("all"); }}>
                Limpar filtros
              </Button>
            )}
          </div>

          {/* Notification List */}
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : !filteredNotifications.length ? (
            <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
              <div className="flex items-center justify-center w-16 h-16 rounded-full bg-primary/10">
                <Bell className="h-8 w-8 text-primary" />
              </div>
              <p className="text-sm font-medium text-foreground">
                {statusFilter !== "all" || eventFilter !== "all" ? "Nenhuma notificação com esses filtros" : "Tudo em dia! 🎉"}
              </p>
              <p className="text-xs text-muted-foreground max-w-[250px]">
                {statusFilter !== "all" || eventFilter !== "all"
                  ? "Tente alterar os filtros para ver mais resultados."
                  : "Quando houver novidades, você será notificado aqui."}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredNotifications.map((n: any) => (
                <Card
                  key={n.id}
                  className={`cursor-pointer transition-colors ${!n.read_at ? "border-primary/30 bg-primary/5" : ""}`}
                  onClick={() => handleClick(n)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between flex-wrap gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-start gap-1.5 min-w-0">
                          <p className="text-sm font-medium min-w-0">{n.title || EVENT_TYPE_LABELS[n.event_type] || n.event_type}</p>
                          <Badge variant="outline" className="text-[9px] shrink-0 whitespace-nowrap">
                            {EVENT_TYPE_LABELS[n.event_type] || n.event_type}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{n.body}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                        {n.action_url && <ExternalLink className="h-3.5 w-3.5 text-primary shrink-0" />}
                        {!n.read_at && (
                          <Badge variant="default" className="text-[10px] shrink-0 whitespace-nowrap">Nova</Badge>
                        )}
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-2">{new Date(n.created_at).toLocaleString("pt-BR")}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Tab: Logs de Entrega (admin/rh only) ── */}
        {isManager && (
          <TabsContent value="logs" className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
              <div>
                <Label className="text-xs">Canal</Label>
                <Select value={logChannel} onValueChange={setLogChannel}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="push">Push</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="email">E-mail</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Status</Label>
                <Select value={logStatus} onValueChange={setLogStatus}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="delivered">Entregue</SelectItem>
                    <SelectItem value="failed">Falha</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Evento</Label>
                <Select value={logEvent} onValueChange={setLogEvent}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">De</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !logDateFrom && "text-muted-foreground")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {logDateFrom ? format(logDateFrom, "dd/MM/yyyy") : "Início"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={logDateFrom} onSelect={setLogDateFrom} className="p-3 pointer-events-auto" />
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <Label className="text-xs">Até</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !logDateTo && "text-muted-foreground")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {logDateTo ? format(logDateTo, "dd/MM/yyyy") : "Fim"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={logDateTo} onSelect={setLogDateTo} className="p-3 pointer-events-auto" />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {logsLoading ? <Skeleton className="h-64 w-full" /> : (
              <div className="border rounded-lg overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Evento</TableHead>
                      <TableHead>Canal</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Fallback</TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead>Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!filteredLogs?.length ? (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nenhum log encontrado</TableCell></TableRow>
                    ) : filteredLogs.map((l: any) => (
                      <TableRow key={l.id}>
                        <TableCell className="text-sm">{EVENT_TYPE_LABELS[l.notifications?.event_type] || l.notifications?.event_type}</TableCell>
                        <TableCell><Badge variant="outline">{l.channel}</Badge></TableCell>
                        <TableCell><Badge variant={l.delivered ? "default" : "destructive"}>{l.delivered ? "Entregue" : "Falha"}</Badge></TableCell>
                        <TableCell>
                          {l.provider_response?.fallback_applied ? (
                            <Badge variant="secondary">Fallback</Badge>
                          ) : l.provider_response?.fallback_triggered ? (
                            <Badge variant="outline">Tentou</Badge>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-xs">{new Date(l.attempted_at).toLocaleString("pt-BR")}</TableCell>
                        <TableCell>
                          {!l.delivered && (
                            <Button size="sm" variant="outline" onClick={() => reprocess.mutate(l.notification_id)} disabled={reprocess.isPending}>
                              {reprocess.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                              Reenviar
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {/* Batch reprocess */}
            {filteredLogs?.some((l: any) => !l.delivered) && (
              <Button variant="outline" size="sm" onClick={() => {
                const failedIds = [...new Set(filteredLogs!.filter((l: any) => !l.delivered && l.notification_id).map((l: any) => l.notification_id))];
                if (!failedIds.length) return;
                if (!confirm(`Reprocessar ${failedIds.length} notificação(ões) com falha?`)) return;
                failedIds.forEach(id => reprocess.mutate(id));
              }} disabled={reprocess.isPending}>
                <RefreshCw className="h-4 w-4 mr-1" /> Reprocessar Todas as Falhas
              </Button>
            )}
          </TabsContent>
        )}

        {/* ── Tab: Auditoria (admin/rh only) ── */}
        {isManager && (
          <TabsContent value="audit" className="space-y-4">
            {auditLoading ? <Skeleton className="h-64 w-full" /> : (
              <>
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

                {/* Trend Chart */}
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

                <div className="flex justify-end">
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
                          <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Sem dados de auditoria</TableCell></TableRow>
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
              </>
            )}
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
