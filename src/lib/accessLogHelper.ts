import { supabase } from "@/integrations/supabase/client";

/**
 * Safe insert into access_logs: só dispara quando há sessão válida e silencia
 * 400/401/403 (janelas de JWT ainda não propagado). Best-effort por design.
 */
async function safeInsertAccessLog(payload: Record<string, any>) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token || !session.user?.id) return;
    // garante que user_id bate com a sessão (RLS)
    const row = { ...payload, user_id: payload.user_id ?? session.user.id };
    const { error } = await supabase.from("access_logs").insert(row as any);
    if (error && !["400", "401", "403", "PGRST301"].some((c) => String(error.code || "").includes(c))) {
      // erros inesperados ficam silenciosos também (best-effort)
    }
  } catch {
    /* best-effort */
  }
}

/**
 * Logs a sensitive module access event to access_logs.
 */
export async function logSensitiveAccess(moduleName: string, userId?: string) {
  const ua = navigator.userAgent || "unknown";
  const deviceInfo = `${navigator.platform || "unknown"} | ${ua.substring(0, 120)}`;
  await safeInsertAccessLog({
    user_id: userId,
    event_type: "sensitive_access",
    module_name: moduleName,
    device_info: deviceInfo,
    success: true,
  });
}

/**
 * Logs a data export event to access_logs.
 */
export async function logExportEvent(moduleName: string, exportType: string = "csv") {
  const ua = navigator.userAgent || "unknown";
  const deviceInfo = `${navigator.platform || "unknown"} | ${ua.substring(0, 120)}`;
  await safeInsertAccessLog({
    event_type: "data_export",
    module_name: moduleName,
    device_info: JSON.stringify({ export_type: exportType, user_agent: deviceInfo }),
    success: true,
  });
}

/**
 * Generic safe access log writer (best-effort, JWT-aware).
 */
export async function logAccessSafe(payload: {
  event_type: string;
  module_name?: string;
  device_info?: string;
  ip_address?: string | null;
  success?: boolean;
  user_id?: string;
}) {
  await safeInsertAccessLog({ success: true, ...payload });
}

/**
 * Records a failed login attempt server-side and returns the count of recent failures.
 */
export async function logFailedLogin(email: string): Promise<number> {
  const normalizedEmail = email.trim().toLowerCase();

  if (!normalizedEmail) {
    throw new Error("missing_email_for_failed_login");
  }

  try {
    const { data, error } = await supabase.rpc("record_failed_login", {
      _email: normalizedEmail,
    });

    if (error) {
      console.warn("[logFailedLogin] RPC error:", error.message);
      throw new Error("record_failed_login_rpc_error");
    }

    if (typeof data !== "number" || Number.isNaN(data)) {
      console.warn("[logFailedLogin] Invalid RPC response:", data);
      throw new Error("record_failed_login_invalid_response");
    }

    return data;
  } catch (error) {
    console.warn("[logFailedLogin] Unexpected error:", error);
    throw error instanceof Error ? error : new Error("record_failed_login_unknown_error");
  }
}
