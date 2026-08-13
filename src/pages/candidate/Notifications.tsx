import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bell, CheckCheck, Loader2, ExternalLink, Filter } from "lucide-react";
import { useMyNotifications, useMarkAsRead, useMarkAllAsRead, useUnreadCount } from "@/hooks/useNotifications";
import { resolveNotificationRoute } from "@/lib/notificationRoutes";
import { EVENT_TYPE_LABELS } from "@/lib/notificationLabels";
import { PageHelp } from "@/components/ui/page-help";
import { useNavigate } from "react-router-dom";

const STATUS_COLORS: Record<string, string> = {
  sent: "border-green-500/30 bg-green-500/5",
  read: "",
  pending: "border-yellow-500/30 bg-yellow-500/5",
  failed: "border-destructive/30 bg-destructive/5",
  queued: "border-yellow-500/30 bg-yellow-500/5",
};

const STATUS_BADGES: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  sent: { label: "Entregue", variant: "default" },
  pending: { label: "Pendente", variant: "secondary" },
  failed: { label: "Falha", variant: "destructive" },
  queued: { label: "Na fila", variant: "outline" },
  read: { label: "Lida", variant: "outline" },
};

export default function Notifications() {
  const { data: notifications, isLoading } = useMyNotifications();
  const { data: unreadCount } = useUnreadCount();
  const markAsRead = useMarkAsRead();
  const markAllAsRead = useMarkAllAsRead();
  const navigate = useNavigate();

  const [filterEvent, setFilterEvent] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  const filtered = (notifications || []).filter((n: any) => {
    if (filterEvent !== "all" && n.event_type !== filterEvent) return false;
    if (filterStatus === "unread" && n.read_at) return false;
    if (filterStatus === "failed" && n.status !== "failed") return false;
    return true;
  });

  const eventTypes = [...new Set((notifications || []).map((n: any) => n.event_type))];

  const handleClick = (n: any) => {
    if (!n.read_at) markAsRead.mutate(n.id);
    const url = n.action_url || resolveNotificationRoute(n.event_type, n.payload || {}).actionUrl;
    if (n.event_type === "faq_resposta") {
      navigate("/faq", { state: { activeTab: "minhas" } });
    } else if (url) {
      navigate(url);
    }
  };

  return (
    <div className="p-4 space-y-4 safe-left safe-right">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 w-full min-w-0">
        <h1 className="text-xl font-bold flex items-center gap-2 min-w-0">
          <Bell className="h-5 w-5 shrink-0" />
          <span className="truncate">Avisos</span>
          <PageHelp />
        </h1>
        {(unreadCount ?? 0) > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => markAllAsRead.mutate()}
            disabled={markAllAsRead.isPending}
            className="w-full sm:w-auto justify-center shrink-0"
          >
            {markAllAsRead.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1 shrink-0" /> : <CheckCheck className="h-3 w-3 mr-1 shrink-0" />}
            <span className="truncate">Marcar todas como lidas</span>
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <Select value={filterEvent} onValueChange={setFilterEvent}>
          <SelectTrigger className="w-44 h-8 text-xs">
            <Filter className="h-3 w-3 mr-1" />
            <SelectValue placeholder="Evento" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os eventos</SelectItem>
            {eventTypes.map((e: string) => (
              <SelectItem key={e} value={e}>{EVENT_TYPE_LABELS[e] || e}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="unread">Não lidas</SelectItem>
            <SelectItem value="failed">Falhas</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : !filtered?.length ? (
        <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-primary/10">
            <Bell className="h-8 w-8 text-primary" />
          </div>
          <p className="text-sm font-medium text-foreground">Tudo em dia! 🎉</p>
          <p className="text-xs text-muted-foreground max-w-[250px]">
            Quando houver novidades sobre suas candidaturas, você será notificado aqui.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((n: any) => {
            const statusStyle = STATUS_COLORS[n.read_at ? "read" : (n.status || "pending")] || "";
            const statusInfo = STATUS_BADGES[n.read_at ? "read" : (n.status || "pending")];
            return (
              <Card
                key={n.id}
                className={`cursor-pointer transition-colors ${statusStyle} ${!n.read_at ? "border-primary/30" : ""}`}
                onClick={() => handleClick(n)}
              >
                <CardContent className="p-4">
                    <div className="flex items-start justify-between flex-wrap gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium min-w-0">{n.title || EVENT_TYPE_LABELS[n.event_type] || n.event_type}</p>
                        <p className="text-xs text-muted-foreground mt-1">{n.body}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                        {n.action_url && <ExternalLink className="h-3.5 w-3.5 text-primary shrink-0" />}
                        {statusInfo && !n.read_at && (
                          <Badge variant={statusInfo.variant} className="text-[10px] shrink-0 whitespace-nowrap">{statusInfo.label}</Badge>
                        )}
                      </div>
                    </div>
                  <p className="text-[10px] text-muted-foreground mt-2">{new Date(n.created_at).toLocaleString("pt-BR")}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
