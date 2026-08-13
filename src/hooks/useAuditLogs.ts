import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// ── IP fetcher (cached per session) ──
let cachedIp: string | null = null;

async function getClientIp(): Promise<string | null> {
  if (cachedIp) return cachedIp;
  return null;
}

// ── Check CrossConfig flag ──
async function isIpTrackingEnabled(): Promise<boolean> {
  try {
    const { data } = await supabase
      .from("global_settings")
      .select("value")
      .eq("category", "compliance")
      .eq("key", "enable_ip_tracking")
      .maybeSingle();
    return data?.value === true || data?.value === "true";
  } catch {
    return false;
  }
}

// ── Fetch actor role from user_roles ──
async function getActorRole(userId: string): Promise<string | null> {
  try {
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    return data?.role || null;
  } catch {
    return null;
  }
}

// ── Check if action is critical ──
async function getCriticalActions(): Promise<string[]> {
  try {
    const { data } = await supabase
      .from("global_settings")
      .select("value")
      .eq("category", "compliance")
      .eq("key", "critical_actions")
      .maybeSingle();
    if (data?.value && Array.isArray(data.value)) return data.value as string[];
    return ["pipeline_deleted", "job_deleted", "config_alterada", "ai_criteria_changed", "channel_disabled"];
  } catch {
    return [];
  }
}

// ── Log Activity (insert into activity_logs + cpf_history) ──

export function useLogActivity() {
  const { user, profile } = useAuth();

  return useMutation({
    mutationFn: async ({
      action,
      module,
      details,
      cpf,
      targetType,
      targetId,
    }: {
      action: string;
      module: string;
      details?: Record<string, any>;
      cpf?: string;
      targetType?: string;
      targetId?: string;
    }) => {
      // Check if audit is enabled globally
      const { data: auditFlag } = await supabase
        .from("global_settings")
        .select("value")
        .eq("category", "audit")
        .eq("key", "audit_enabled")
        .maybeSingle();

      if (auditFlag?.value === false) {
        return;
      }

      // Gap 3: Include actor_role in details
      const actorRole = user?.id ? await getActorRole(user.id) : null;
      const enrichedDetails = {
        ...details,
        ...(actorRole ? { actor_role: actorRole } : {}),
      };

      // Insert activity_log
      await supabase.from("activity_logs").insert({
        user_id: user?.id || null,
        action,
        module,
        details: enrichedDetails || {},
      } as any);

      // Insert cpf_history if CPF available
      const effectiveCpf = cpf || profile?.cpf;
      if (effectiveCpf) {
        await supabase.from("cpf_history" as any).insert({
          cpf: effectiveCpf,
          event: action,
          source_module: module,
          metadata: enrichedDetails || {},
          actor_id: user?.id || null,
        } as any);
      }

      // Insert audit_trail for admin actions (with conditional IP tracking)
      if (targetType && user?.id) {
        // Gap 1: Only collect IP if enable_ip_tracking is true
        const ipEnabled = await isIpTrackingEnabled();
        const ipAddress = ipEnabled ? await getClientIp() : null;
        
        await supabase.from("audit_trail" as any).insert({
          actor_id: user.id,
          action,
          target_type: targetType,
          target_id: targetId || null,
          context: enrichedDetails || {},
          ip_address: ipAddress,
        } as any);
      }

      // Gap 6: Proactive critical alert — insert push notification for admins
      const criticalActions = await getCriticalActions();
      if (criticalActions.includes(action)) {
        const { data: admins } = await supabase
          .from("user_roles")
          .select("user_id")
          .in("role", ["admin", "rh_franqueadora"]);

        if (admins && admins.length > 0) {
          const notifications = admins
            .filter((a) => a.user_id !== user?.id)
            .map((a) => ({
              event_type: "critical_change_alert",
              recipient_id: a.user_id,
              channel: "push",
              title: "Alteração crítica detectada",
              body: `Ação "${action}" executada no módulo "${module}".`,
              status: "pending",
              action_url: "/admin/auditoria",
              action_type: "action_required",
              payload: { action, module, details: enrichedDetails },
            }));

          if (notifications.length > 0) {
            await supabase.from("notifications").insert(notifications as any);
          }
        }
      }
    },
  });
}

// ── Audit Trail ──

export interface AuditTrailFilters {
  action?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

export function useAuditTrail(filters?: AuditTrailFilters) {
  return useQuery({
    queryKey: ["audit_trail", filters],
    queryFn: async () => {
      let q = supabase
        .from("audit_trail" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(filters?.limit || 100);

      if (filters?.action) q = q.eq("action", filters.action);
      if (filters?.dateFrom) q = q.gte("created_at", filters.dateFrom);
      if (filters?.dateTo) q = q.lte("created_at", filters.dateTo);

      const { data, error } = await q;
      if (error) throw error;
      return (data as any[]) || [];
    },
  });
}

// ── CPF History ──

export function useCPFHistory(cpf?: string) {
  return useQuery({
    queryKey: ["cpf_history", cpf],
    enabled: !!cpf && cpf.length >= 11,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cpf_history" as any)
        .select("*")
        .eq("cpf", cpf!)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data as any[]) || [];
    },
  });
}

// ── Activity Logs (general timeline) ──

export function useActivityLogs(filters?: { module?: string; dateFrom?: string; dateTo?: string; limit?: number }) {
  return useQuery({
    queryKey: ["activity_logs", filters],
    queryFn: async () => {
      let q = supabase
        .from("activity_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(filters?.limit || 100);

      if (filters?.module) q = q.eq("module", filters.module);
      if (filters?.dateFrom) q = q.gte("created_at", filters.dateFrom);
      if (filters?.dateTo) q = q.lte("created_at", filters.dateTo);

      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });
}

// ── Audit Metrics ──

export function useAuditMetrics() {
  return useQuery({
    queryKey: ["audit_metrics"],
    queryFn: async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayISO = today.toISOString();

      const [activityRes, aiRes, alertsRes, todayRes] = await Promise.all([
        supabase.from("activity_logs").select("id", { count: "exact", head: true }),
        supabase.from("ai_decision_logs" as any).select("id", { count: "exact", head: true }),
        supabase.from("activity_logs").select("id", { count: "exact", head: true }).like("action", "%security%"),
        supabase.from("activity_logs").select("id", { count: "exact", head: true }).gte("created_at", todayISO),
      ]);

      return {
        totalEvents: activityRes.count || 0,
        aiDecisions: aiRes.count || 0,
        securityAlerts: alertsRes.count || 0,
        todayActions: todayRes.count || 0,
      };
    },
  });
}

// ── Security Alerts (anomaly detection) ──

export function useSecurityAlerts() {
  return useQuery({
    queryKey: ["security_alerts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activity_logs")
        .select("*")
        .or("action.like.%security%,action.like.%alert%,action.like.%anomaly%,action.like.%fail%")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
  });
}

// ── SHA-256 hash via Web Crypto API ──

async function computeSHA256(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Export to CSV ──

export async function exportToCSV(data: any[], filename: string, moduleName?: string) {
  if (!data.length) return;

  // Log export event
  if (moduleName) {
    try {
      const { logExportEvent } = await import("@/lib/accessLogHelper");
      logExportEvent(moduleName, "csv");
    } catch { /* best-effort */ }
  }

  const headers = Object.keys(data[0]);
  const csvRows = [
    headers.join(","),
    ...data.map((row) =>
      headers
        .map((h) => {
          const val = row[h];
          const str = typeof val === "object" ? JSON.stringify(val) : String(val ?? "");
          return `"${str.replace(/"/g, '""')}"`;
        })
        .join(",")
    ),
  ];
  const csvContent = csvRows.join("\n");
  
  // Gap 5: compute integrity hash
  const hash = await computeSHA256(csvContent);
  const finalContent = `# SHA-256: ${hash}\n# Exportado em: ${new Date().toISOString()}\n${csvContent}`;
  
  const blob = new Blob([finalContent], { type: "text/csv" });
  downloadBlob(blob, `${filename}_${new Date().toISOString().slice(0, 10)}.csv`);
}

// ── Export to JSON ──

export async function exportToJSON(data: any[], filename: string) {
  if (!data.length) return;
  const jsonContent = JSON.stringify(data, null, 2);
  
  // Gap 5: compute integrity hash
  const hash = await computeSHA256(jsonContent);
  const envelope = {
    _meta: {
      sha256: hash,
      exported_at: new Date().toISOString(),
      total_records: data.length,
      system: "Recruta — Auditoria",
    },
    data,
  };
  
  const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" });
  downloadBlob(blob, `${filename}_${new Date().toISOString().slice(0, 10)}.json`);
}

// ── Export to PDF (structured text) ──

export function exportToPDF(data: any[], filename: string, title: string) {
  if (!data.length) return;
  const headers = Object.keys(data[0]);
  const now = new Date().toISOString();

  const rows = data.map((row) =>
    `<tr>${headers.map((h) => {
      const val = row[h];
      const str = typeof val === "object" ? JSON.stringify(val) : String(val ?? "");
      return `<td style="border:1px solid #ddd;padding:4px 8px;font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis">${str.slice(0, 120)}</td>`;
    }).join("")}</tr>`
  ).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:sans-serif;margin:20px}table{border-collapse:collapse;width:100%}th{background:#f3f4f6;border:1px solid #ddd;padding:6px 8px;font-size:11px;text-align:left}</style>
</head><body>
<h1 style="font-size:18px">${title}</h1>
<p style="font-size:12px;color:#666">Exportado em: ${now} | Total: ${data.length} registros</p>
<p style="font-size:10px;color:#999">Sistema Recruta — Relatório de Auditoria</p>
<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>
<p style="font-size:9px;color:#999;margin-top:20px">Documento gerado automaticamente. Não deve ser alterado.</p>
</body></html>`;

  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, "_blank");
  if (w) {
    w.onload = () => {
      w.print();
      URL.revokeObjectURL(url);
    };
  }
}

// ── Download helper ──

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
