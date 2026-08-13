import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Shield } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";

const ACTION_LABELS: Record<string, string> = {
  role_assigned: "Role atribuída",
  role_removed: "Role removida",
  role_changed: "Role alterada",
  scope_updated: "Escopo alterado",
  user_activated: "Usuário ativado",
  user_deactivated: "Usuário desativado",
};

interface HistoryLog {
  id: string;
  action: string;
  actor_name: string;
  created_at: string;
  details: any;
}

interface SecurityNotification {
  id: string;
  event_type: string;
  title: string;
  body: string;
  created_at: string;
}

interface SecurityAlertsPanelProps {
  historyLogs: HistoryLog[];
}

export function SecurityAlertsPanel({ historyLogs }: SecurityAlertsPanelProps) {
  const [securityNotifs, setSecurityNotifs] = useState<SecurityNotification[]>([]);

  useEffect(() => {
    const fetchSecurityNotifs = async () => {
      const { data } = await supabase
        .from("notifications")
        .select("id, event_type, title, body, created_at")
        .in("event_type", ["security_alert", "suspicious_access", "user_blocked"])
        .order("created_at", { ascending: false })
        .limit(20);
      if (data) setSecurityNotifs(data);
    };
    fetchSecurityNotifs();
  }, []);

  const criticalActions = historyLogs.filter((l) => {
    const action = l.action ?? "";
    return action.includes("role_removed") || action.includes("role_changed") || action.includes("user_deactivated") || action.includes("scope_updated");
  });

  // Merge both sources into a single timeline
  const allAlerts: Array<{
    id: string;
    type: "activity" | "notification";
    title: string;
    subtitle: string;
    date: string;
    isCritical: boolean;
  }> = [];

  criticalActions.slice(0, 20).forEach((alert) => {
    const action = alert.action ?? "";
    const isRemoval = action.includes("role_removed") || action.includes("user_deactivated");
    allAlerts.push({
      id: alert.id,
      type: "activity",
      title: ACTION_LABELS[action.split(":")[0]] ?? action,
      subtitle: `${alert.actor_name} • ${format(new Date(alert.created_at), "dd/MM/yyyy HH:mm")}${(alert.details as any)?.reason ? ` • Motivo: ${(alert.details as any).reason}` : ""}`,
      date: alert.created_at,
      isCritical: isRemoval,
    });
  });

  securityNotifs.forEach((n) => {
    allAlerts.push({
      id: n.id,
      type: "notification",
      title: n.title,
      subtitle: `${n.body?.substring(0, 120)} • ${format(new Date(n.created_at), "dd/MM/yyyy HH:mm")}`,
      date: n.created_at,
      isCritical: n.event_type === "security_alert" || n.event_type === "suspicious_access",
    });
  });

  // Sort by date descending
  allAlerts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const displayAlerts = allAlerts.slice(0, 30);

  if (displayAlerts.length === 0) {
    return <p className="text-center text-muted-foreground py-8">Nenhum alerta de segurança recente.</p>;
  }

  return (
    <div className="space-y-2">
      {displayAlerts.map((alert) => (
        <div
          key={alert.id}
          className={`flex items-start gap-3 p-3 rounded-md border ${
            alert.isCritical
              ? "border-destructive/30 bg-destructive/5"
              : "border-amber-500/30 bg-amber-500/5"
          }`}
        >
          {alert.type === "notification" ? (
            <Shield className={`h-4 w-4 mt-0.5 shrink-0 ${alert.isCritical ? "text-destructive" : "text-amber-500"}`} />
          ) : (
            <AlertTriangle className={`h-4 w-4 mt-0.5 shrink-0 ${alert.isCritical ? "text-destructive" : "text-amber-500"}`} />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">{alert.title}</p>
            <p className="text-xs text-muted-foreground">{alert.subtitle}</p>
          </div>
          <Badge
            variant={alert.isCritical ? "destructive" : "outline"}
            className="shrink-0 text-xs"
          >
            {alert.isCritical ? "Crítico" : "Atenção"}
          </Badge>
        </div>
      ))}
    </div>
  );
}
