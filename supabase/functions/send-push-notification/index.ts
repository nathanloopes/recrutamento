import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { notificationsEnabled } from "../_shared/config-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Configurar VAPID uma vez
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:contato@example.com";
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  } catch (e) {
    console.error("[send-push] VAPID setup error:", e);
  }
}

interface PushTokenRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.warn("[send-push] REJECTED: missing Authorization header");
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Kill switch global de notificações (Fase 2 — configGuard)
    if (!(await notificationsEnabled())) {
      return new Response(
        JSON.stringify({ delivered: false, blocked: "kill_switch", reason: "notifications_enabled is false" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const token = authHeader.replace(/^Bearer\s+/i, "").trim();

    // Detecta service-role de duas formas:
    //  1) Igualdade exata com a env var (via edge function deploy padrão).
    //  2) Decodificação do JWT payload — protege contra whitespace/rotações do Vault
    //     desde que o JWT seja válido e emitido pelo mesmo projeto.
    let isServiceRole = token === serviceKey.trim();
    if (!isServiceRole) {
      try {
        const parts = token.split(".");
        if (parts.length === 3) {
          const payloadJson = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
          const payload = JSON.parse(payloadJson);
          if (payload?.role === "service_role" && typeof payload?.exp === "number" && payload.exp * 1000 > Date.now()) {
            isServiceRole = true;
          }
        }
      } catch {
        // ignora — cai no fluxo normal de autenticação
      }
    }

    let callerUserId: string | null = null;
    const isServiceCall = isServiceRole;

    if (!isServiceRole) {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: authError } = await userClient.auth.getUser();
      if (authError || !user) {
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      callerUserId = user.id;
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const { recipient_id, title, body, notification_id, data, dry_run } = await req.json();

    // Health check curto-circuito (painel de monitoramento)
    if (dry_run) {
      return new Response(
        JSON.stringify({ success: true, dry_run: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!recipient_id || !title || !body) {
      return new Response(
        JSON.stringify({ error: "recipient_id, title and body are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!isServiceCall && !notification_id) {
      return new Response(
        JSON.stringify({ error: "notification_id is required for user-triggered push" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (notification_id) {
      const { data: notification, error: notificationError } = await supabase
        .from("notifications")
        .select("id, recipient_id, channel")
        .eq("id", notification_id)
        .maybeSingle();

      if (notificationError || !notification) {
        return new Response(
          JSON.stringify({ error: "notification_not_found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (notification.recipient_id !== recipient_id) {
        return new Response(
          JSON.stringify({ error: "notification_recipient_mismatch" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      // Channel check: apenas para chamadas de usuário. Service role (ex: trigger
      // automático de push) pode enviar para qualquer channel, pois o push é
      // um canal complementar ao in_app/email/etc.
      if (!isServiceCall && notification.channel !== "push") {
        return new Response(
          JSON.stringify({ error: "notification_channel_mismatch" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
      console.error("[send-push] VAPID keys not configured");
      if (notification_id) {
        await supabase.from("delivery_logs").insert({
          notification_id,
          channel: "push",
          delivered: false,
          provider_response: { error: "vapid_not_configured" },
        });
      }
      return new Response(
        JSON.stringify({ success: false, error: "vapid_not_configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Buscar inscrições Web Push (VAPID) + Expo (app nativo iOS/Android) em paralelo
    const [webSubsRes, expoTokensRes] = await Promise.all([
      supabase
        .from("push_tokens")
        .select("id, endpoint, p256dh, auth")
        .eq("user_id", recipient_id)
        .eq("is_active", true),
      supabase
        .from("expo_push_tokens")
        .select("id, token, platform")
        .eq("user_id", recipient_id),
    ]);

    const rawSubs = webSubsRes.data;
    const subsError = webSubsRes.error;
    const expoTokensRaw = (expoTokensRes.data ?? []) as Array<{ id: string; token: string; platform: string | null }>;
    if (expoTokensRes.error) {
      console.warn("[send-push] expo tokens fetch error:", expoTokensRes.error);
    }

    if (subsError) {
      console.error("Error fetching push subscriptions:", subsError);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to fetch push subscriptions" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    // Defesa-em-profundidade (cinto-e-suspensório): se algum endpoint também
    // está ativo para outro user_id (não deve ocorrer após o índice único parcial),
    // pula esse endpoint e loga conflito. Garante "1 device = 1 usuário ativo".
    const subs: PushTokenRow[] = [];
    const conflictingEndpoints: string[] = [];
    if (rawSubs && rawSubs.length > 0) {
      const endpoints = (rawSubs as PushTokenRow[]).map((s) => s.endpoint);
      const { data: conflicts } = await supabase
        .from("push_tokens")
        .select("endpoint, user_id")
        .in("endpoint", endpoints)
        .eq("is_active", true)
        .neq("user_id", recipient_id);

      const blocked = new Set((conflicts ?? []).map((c) => c.endpoint));
      for (const s of rawSubs as PushTokenRow[]) {
        if (blocked.has(s.endpoint)) {
          conflictingEndpoints.push(s.endpoint);
          // Auto-cura: desativa o duplicado do recipient (mantém apenas o mais recente)
          await supabase
            .from("push_tokens")
            .update({ is_active: false })
            .eq("id", s.id);
        } else {
          subs.push(s);
        }
      }
    }

    if (conflictingEndpoints.length > 0) {
      console.warn(
        `[send-push] cross_user_endpoint_conflict recipient=${recipient_id} endpoints=${conflictingEndpoints.length}`
      );
    }
    if ((!subs || subs.length === 0) && expoTokensRaw.length === 0) {
      console.warn(`[send-push] NO_SUBSCRIPTIONS for recipient=${recipient_id}`);
      if (notification_id) {
        await supabase.from("delivery_logs").insert({
          notification_id,
          channel: "push",
          delivered: false,
          provider_response: {
            error: "no_push_tokens",
            skipped: true,
            recipient_id,
            caller_user_id: callerUserId,
            cross_user_conflicts: conflictingEndpoints.length,
          },
        });
      }
      return new Response(
        JSON.stringify({ success: false, skipped: true, reason: "no_push_tokens" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const payload = JSON.stringify({
      title,
      body,
      url: data?.url || data?.action_url || "/",
      tag: data?.tag,
      notification_id: notification_id ?? null,
    });

    const results: Array<{ endpoint: string; status: number; ok: boolean }> = [];
    const invalidEndpoints: string[] = [];
    let anyDelivered = false;

    await Promise.all(
      (subs as PushTokenRow[]).map(async (s) => {
        try {
          const result = await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
            {
              TTL: 60 * 60 * 24,
              urgency: "high", // Android: prioridade HIGH; iOS: apns-priority 10 (alert+sound+badge)
              topic: notification_id ? String(notification_id).slice(0, 32) : undefined,
            },
          );
          const status = (result as { statusCode?: number }).statusCode ?? 201;
          const ok = status >= 200 && status < 300;
          results.push({ endpoint: s.endpoint, status, ok });
          if (ok) anyDelivered = true;
        } catch (err) {
          const e = err as { statusCode?: number; body?: string };
          const status = e?.statusCode ?? 500;
          results.push({ endpoint: s.endpoint, status, ok: false });
          if (status === 404 || status === 410) {
            invalidEndpoints.push(s.endpoint);
          } else {
            console.error("[send-push] webpush error", status, e?.body);
          }
        }
      }),
    );

    // Desativar inscrições inválidas
    if (invalidEndpoints.length > 0) {
      await supabase
        .from("push_tokens")
        .update({ is_active: false })
        .in("endpoint", invalidEndpoints);
    }

    // ============= Expo Push (app nativo iOS/Android) =============
    const expoResults: Array<{ token: string; platform: string | null; status: string; ok: boolean; message?: string }> = [];
    const invalidExpoTokenIds: string[] = [];

    if (expoTokensRaw.length > 0) {
      const expoMessages = expoTokensRaw.map((t) => ({
        to: t.token,
        title,
        body,
        sound: "default" as const,
        priority: "high" as const,
        channelId: "default",
        data: {
          url: data?.url || data?.action_url || "/",
          notification_id: notification_id ?? null,
          ...(data ?? {}),
        },
      }));

      try {
        const expoRes = await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "Accept-Encoding": "gzip, deflate",
          },
          body: JSON.stringify(expoMessages),
        });

        const expoJson = await expoRes.json().catch(() => ({ data: [] as unknown[] }));
        const ticketArray: Array<{ status?: string; message?: string; details?: { error?: string } }> =
          Array.isArray(expoJson?.data) ? expoJson.data : [];

        ticketArray.forEach((ticket, idx) => {
          const t = expoTokensRaw[idx];
          const ok = ticket?.status === "ok";
          expoResults.push({
            token: t.token,
            platform: t.platform,
            status: ticket?.status ?? "unknown",
            ok,
            message: ticket?.message,
          });
          if (ok) anyDelivered = true;
          if (ticket?.details?.error === "DeviceNotRegistered") {
            invalidExpoTokenIds.push(t.id);
          }
        });

        if (!expoRes.ok) {
          console.error("[send-push] expo push HTTP error", expoRes.status, JSON.stringify(expoJson));
        }
      } catch (err) {
        console.error("[send-push] expo push exception:", err);
        expoTokensRaw.forEach((t) => {
          expoResults.push({
            token: t.token,
            platform: t.platform,
            status: "exception",
            ok: false,
            message: String(err),
          });
        });
      }
    }

    if (invalidExpoTokenIds.length > 0) {
      await supabase.from("expo_push_tokens").delete().in("id", invalidExpoTokenIds);
    }

    // Log delivery
    if (notification_id) {
      await supabase.from("delivery_logs").insert({
        notification_id,
        channel: "push",
        delivered: anyDelivered,
        provider_response: {
          web_results: results,
          web_sent: subs.length,
          web_invalidated: invalidEndpoints.length,
          expo_results: expoResults,
          expo_sent: expoTokensRaw.length,
          expo_invalidated: invalidExpoTokenIds.length,
          caller_user_id: callerUserId,
        },
      });

      await supabase
        .from("notifications")
        .update({ status: anyDelivered ? "sent" : "failed" })
        .eq("id", notification_id);
    }

    return new Response(
      JSON.stringify({
        success: anyDelivered,
        results,
        sent: subs.length,
        invalidated: invalidEndpoints.length,
        expo_results: expoResults,
        expo_sent: expoTokensRaw.length,
        expo_invalidated: invalidExpoTokenIds.length,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("send-push-notification error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
