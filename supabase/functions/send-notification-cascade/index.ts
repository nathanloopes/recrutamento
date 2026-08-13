import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * send-notification-cascade — Global-Settings-driven dispatcher
 *
 * Single source of truth = global_settings (category="notifications"):
 *   - default_channel: ALWAYS fires
 *   - enable_push / whatsapp_enabled / email_enabled: additional channels only
 *
 * Extras only fire if a notification_template exists for (event_type, channel).
 * Templates control CONTENT only — never routing.
 *
 * Pipeline:
 *   1. Kill switch          2. Quiet hours
 *   3. Per-recipient limits  4. Global limits
 *   5. Channel selection (global default + extras with template)
 *   6. Parallel delivery     7. In-app fallback + logging
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Auth gate
    const authHeader = req.headers.get("Authorization") || "";
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const dispatchSecretHeader = req.headers.get("x-dispatch-secret") || "";
    const dispatchSecretEnv = Deno.env.get("CASCADE_DISPATCH_SECRET") || "";

    // Path 1a: shared dispatch secret via env (if set)
    let authorized = !!dispatchSecretEnv && dispatchSecretHeader === dispatchSecretEnv;

    // Path 2: service_role key match (env)
    if (!authorized) authorized = !!bearer && bearer === serviceKey;

    // Path 3: decode JWT and check role===service_role (legacy long-lived tokens)
    if (!authorized && bearer) {
      try {
        const parts = bearer.split(".");
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
          if (payload?.role === "service_role" && (!payload.exp || payload.exp * 1000 > Date.now())) {
            authorized = true;
          }
        }
      } catch { /* ignore */ }
    }

    // Service client (used for vault lookup + downstream work)
    const supabase = createClient(supabaseUrl, serviceKey);

    // Path 1b: dispatch secret stored in Vault (canonical source — survives env drift)
    if (!authorized && dispatchSecretHeader) {
      try {
        const { data: vaultRow } = await supabase
          .schema("vault" as any)
          .from("decrypted_secrets")
          .select("decrypted_secret")
          .eq("name", "cascade_dispatch_secret")
          .maybeSingle();
        const vaultSecret = (vaultRow as any)?.decrypted_secret as string | undefined;
        if (vaultSecret && dispatchSecretHeader === vaultSecret) {
          authorized = true;
        }
      } catch (e) {
        console.warn("[cascade] vault lookup failed", String(e));
      }
    }

    // Path 4: user JWT
    if (!authorized && bearer && bearer !== anonKey) {
      const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${bearer}` } } });
      const { data, error } = await userClient.auth.getUser();
      authorized = !!data?.user && !error;
    }
    if (!authorized) {
      console.warn("[cascade] unauthorized", { hasBearer: !!bearer, hasDispatchSecret: !!dispatchSecretHeader });
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }


    const { notification_id } = await req.json();
    if (!notification_id) {
      return new Response(JSON.stringify({ error: "notification_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Pull all notification settings
    const { data: notifSettings } = await supabase
      .from("global_settings")
      .select("key, value")
      .eq("category", "notifications");

    const getVal = (key: string, fallback: string) => {
      const s = (notifSettings || []).find((s: any) => s.key === key);
      if (s?.value === undefined || s?.value === null) return fallback;
      return typeof s.value === "string" ? s.value : String(s.value);
    };
    const getBool = (key: string, fallback: boolean) => {
      const s = (notifSettings || []).find((s: any) => s.key === key);
      if (s === undefined) return fallback;
      return s.value === true || s.value === "true";
    };
    const getNum = (key: string, fallback: number) => {
      const s = (notifSettings || []).find((s: any) => s.key === key);
      const v = Number(s?.value);
      return !isNaN(v) && v > 0 ? v : fallback;
    };

    // ── STEP 1: Kill switch ──
    if (!getBool("notifications_enabled", true)) {
      return new Response(JSON.stringify({ delivered: false, blocked: "kill_switch" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fetch notification
    const { data: notification, error: notifErr } = await supabase
      .from("notifications")
      .select("*")
      .eq("id", notification_id)
      .single();
    if (notifErr || !notification) {
      return new Response(JSON.stringify({ error: "Notification not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Templates ativos para este evento (buscados cedo: também decidem o bypass
    // transacional). Um evento com template configurado (mudança de status da
    // vaga, entrevistas, etc.) é uma mensagem INTENCIONAL que precisa ser
    // entregue — não passa por quiet-hours nem rate-limit/cooldown.
    const { data: eventTemplates } = await supabase
      .from("notification_templates")
      .select("id, channel, title, body, version, is_active, status, meta_template_name, meta_template_language, meta_variable_mapping")
      .eq("event_type", notification.event_type)
      .eq("is_active", true)
      .order("version", { ascending: false });

    const templateByChannel = new Map<string, any>();
    (eventTemplates || []).forEach((t: any) => {
      const ch = String(t.channel).toLowerCase();
      if (!templateByChannel.has(ch)) templateByChannel.set(ch, t);
    });

    // Transacional = evento com pelo menos 1 template ativo. Pula throttling
    // (STEPS 2–4). O kill switch global (STEP 1) continua valendo para todos.
    const isTransactional = templateByChannel.size > 0;

    // ── STEPS 2–4: throttling (quiet hours + rate limits) ──
    // Ignoradas para eventos transacionais (com template) — precisam ser entregues.
    if (!isTransactional) {
    // ── STEP 2: Quiet hours ──
    const quietStart = getVal("quiet_hours_start", "");
    const quietEnd = getVal("quiet_hours_end", "");
    if (quietStart && quietEnd) {
      const now = new Date();
      const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
      const brtMinutes = ((currentMinutes - 180) + 1440) % 1440;
      const [sh, sm] = quietStart.split(":").map(Number);
      const [eh, em] = quietEnd.split(":").map(Number);
      const startMin = sh * 60 + sm;
      const endMin = eh * 60 + em;
      const inQuietHours = startMin > endMin
        ? brtMinutes >= startMin || brtMinutes < endMin
        : brtMinutes >= startMin && brtMinutes < endMin;
      if (inQuietHours) {
        return new Response(JSON.stringify({ delivered: false, blocked: "quiet_hours" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ── STEP 3: Per-recipient limits ──
    const maxPerHour = getNum("max_per_hour", 10);
    const maxPerDay = getNum("max_per_day", 30);
    const cooldownMinutes = getNum("cooldown_minutes", 5);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const cooldownAgo = new Date(Date.now() - cooldownMinutes * 60 * 1000).toISOString();

    const { count: hourCount } = await supabase.from("notifications").select("id", { count: "exact", head: true })
      .eq("recipient_id", notification.recipient_id).eq("status", "sent").gte("created_at", oneHourAgo);
    if ((hourCount || 0) >= maxPerHour) {
      return new Response(JSON.stringify({ delivered: false, blocked: "rate_limit_hour" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { count: dayCount } = await supabase.from("notifications").select("id", { count: "exact", head: true })
      .eq("recipient_id", notification.recipient_id).eq("status", "sent").gte("created_at", oneDayAgo);
    if ((dayCount || 0) >= maxPerDay) {
      return new Response(JSON.stringify({ delivered: false, blocked: "rate_limit_day" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: lastSent } = await supabase.from("notifications").select("created_at")
      .eq("recipient_id", notification.recipient_id).eq("status", "sent").gte("created_at", cooldownAgo)
      .order("created_at", { ascending: false }).limit(1);
    if (lastSent && lastSent.length > 0) {
      return new Response(JSON.stringify({ delivered: false, blocked: "cooldown" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── STEP 4: Global limits ──
    const globalDailyLimit = getNum("global_daily_limit", 1000);
    const globalHourlyLimit = getNum("global_hourly_limit", 200);
    const { count: globalDayCount } = await supabase.from("notifications").select("id", { count: "exact", head: true })
      .eq("status", "sent").gte("created_at", oneDayAgo);
    if ((globalDayCount || 0) >= globalDailyLimit) {
      return new Response(JSON.stringify({ delivered: false, blocked: "global_daily_limit" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { count: globalHourCount } = await supabase.from("notifications").select("id", { count: "exact", head: true })
      .eq("status", "sent").gte("created_at", oneHourAgo);
    if ((globalHourCount || 0) >= globalHourlyLimit) {
      return new Response(JSON.stringify({ delivered: false, blocked: "global_hourly_limit" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    } // fim do throttling (!isTransactional)

    // ── STEP 5: Channel selection (Global Settings = source of truth) ──
    const defaultChannel = (getVal("default_channel", "push") || "push").replace(/"/g, "").toLowerCase();
    const channelEnabled: Record<string, boolean> = {
      push: getBool("enable_push", true),
      whatsapp: getBool("whatsapp_enabled", false),
      email: getBool("email_enabled", false),
    };

    // (templates já buscados no início — ver eventTemplates/templateByChannel acima)

    // Routing is ALWAYS decided by Global Settings.
    // - default_channel ALWAYS fires — parent of every notification/template
    // - extras (push/whatsapp/email) only fire when an active template exists for the event
    // notification.channel from callers is IGNORED for routing (templates control content only)
    const selectedChannels: string[] = [defaultChannel];
    for (const ch of ["push", "whatsapp", "email"]) {
      if (ch === defaultChannel) continue;
      if (channelEnabled[ch] && templateByChannel.has(ch)) selectedChannels.push(ch);
    }

    // Recipient profile
    const { data: profile } = await supabase.from("profiles")
      .select("phone, email, full_name").eq("id", notification.recipient_id).single();

    // Email gate for admin-like roles (no fan-out blasts)
    const ADMIN_EMAIL_ALLOWED_EVENTS = new Set<string>(["password_reset", "account_invite", "fn_notify_password_reset"]);
    const ADMIN_ROLES = new Set(["admin", "rh_franqueadora", "franqueado", "gestor_recrutamento", "auditor_admin"]);
    let emailAllowed = true;
    {
      const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", notification.recipient_id);
      const recipientRoles = (roles || []).map((r: any) => String(r.role));
      const isAdminLike = recipientRoles.some((r) => ADMIN_ROLES.has(r));
      if (isAdminLike && !ADMIN_EMAIL_ALLOWED_EVENTS.has(notification.event_type)) emailAllowed = false;
    }

    // Content resolver: template wins; fallback to notification.title/body
    const interpolate = (tpl: string, vars: Record<string, any>) => {
      if (!tpl) return tpl;
      const s = String(tpl);
      // Suporte legado: mapping salvo como "candidate_name" (sem {{ }})
      // — trata como chave direta de lookup.
      if (/^[\w.-]+$/.test(s.trim())) {
        const v = vars?.[s.trim()];
        if (v !== undefined && v !== null && String(v) !== "") return String(v);
      }
      return s.replace(/\{\{\s*([\w_.-]+)\s*\}\}/g, (_, k) => {
        const v = vars?.[k];
        return v === undefined || v === null ? "" : String(v);
      });
    };
    // ── STEP 5b: Hydrate interview payload from unified view ──
    // Para eventos de entrevista, garantir candidate_name/job_title/meeting_link/
    // interview_datetime sempre presentes — busca direto na view
    // interviews_for_whatsapp_notifications (fonte única). Callers só precisam
    // passar interview_id no payload.
    const APP_PUBLIC_URL = (Deno.env.get("APP_PUBLIC_URL") || "https://recrutamento.example.com").replace(/\/+$/, "");
    let hydratedPayload: Record<string, any> = { ...((notification.payload || {}) as Record<string, any>) };
    if (
      String(notification.event_type || "").startsWith("interview_") &&
      hydratedPayload.interview_id &&
      (!hydratedPayload.candidate_name ||
        !hydratedPayload.job_title ||
        !hydratedPayload.meeting_link ||
        !hydratedPayload.interview_datetime)
    ) {
      const { data: row } = await supabase
        .from("interviews_for_whatsapp_notifications")
        .select("candidate_name, job_title, meeting_link, interview_datetime")
        .eq("interview_id", hydratedPayload.interview_id)
        .maybeSingle();
      if (row) {
        if (!hydratedPayload.candidate_name) hydratedPayload.candidate_name = row.candidate_name || "";
        if (!hydratedPayload.job_title) hydratedPayload.job_title = row.job_title || "";
        if (!hydratedPayload.interview_datetime) hydratedPayload.interview_datetime = row.interview_datetime || "";
        if (!hydratedPayload.meeting_link) {
          const ml = (row.meeting_link || "").trim();
          hydratedPayload.meeting_link = ml
            ? (/^https?:\/\//i.test(ml) ? ml : (ml.startsWith("/") ? `${APP_PUBLIC_URL}${ml}` : ml))
            : "";
        }
      }
    }

    const resolveContent = (channel: string) => {
      const tpl = templateByChannel.get(channel);
      if (tpl) {
        return {
          title: interpolate(tpl.title || notification.title, hydratedPayload),
          body: interpolate(tpl.body || notification.body, hydratedPayload),
        };
      }
      return { title: notification.title, body: notification.body };
    };


    // ── STEP 6: Parallel delivery to every selected channel ──
    const results: { channel: string; success: boolean; error?: string; skipped?: boolean }[] = [];

    await Promise.all(selectedChannels.map(async (channel) => {
      try {
        const { title: chTitle, body: chBody } = resolveContent(channel);

        if (channel === "push") {
          const r = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
            body: JSON.stringify({
              recipient_id: notification.recipient_id,
              title: chTitle, body: chBody,
              notification_id: notification.id,
              data: hydratedPayload,
            }),
          });
          const j = await r.json();
          if (j.success) results.push({ channel: "push", success: true });
          else if (j.skipped) results.push({ channel: "push", success: false, error: j.reason || "skipped", skipped: true });
          else results.push({ channel: "push", success: false, error: j.error || "push_failed" });
        } else if (channel === "whatsapp") {
          if (!profile?.phone) { results.push({ channel: "whatsapp", success: false, error: "no_phone" }); return; }
          const tpl = templateByChannel.get("whatsapp");
          const metaTplName = tpl?.meta_template_name ? String(tpl.meta_template_name).trim() : "";
          const metaLang = tpl?.meta_template_language || "pt_BR";
          const metaMapping: any[] = Array.isArray(tpl?.meta_variable_mapping) ? tpl.meta_variable_mapping : [];

          const waPayload: Record<string, any> = {
            phone: profile.phone,
            message: `${chTitle}\n\n${chBody}`,
            notification_id: notification.id,
          };
          if (metaTplName) {
            waPayload.template_name = metaTplName;
            waPayload.template_language = metaLang;
            waPayload.template_components = [{
              type: "body",
              parameters: metaMapping.map((v: any) => ({
                type: "text",
                text: interpolate(String(v ?? ""), hydratedPayload) || "-",
              })),
            }];
          }


          const r = await fetch(`${supabaseUrl}/functions/v1/send-whatsapp`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
            body: JSON.stringify(waPayload),
          });
          const j = await r.json();
          if (j.success) results.push({ channel: "whatsapp", success: true });
          else results.push({ channel: "whatsapp", success: false, error: j.error || "whatsapp_failed" });

        } else if (channel === "email") {
          if (!emailAllowed) { results.push({ channel: "email", success: false, error: "admin_fanout_no_email", skipped: true }); return; }
          if (!profile?.email) { results.push({ channel: "email", success: false, error: "no_email" }); return; }
          const r = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
            body: JSON.stringify({
              to_email: profile.email,
              to_name: profile.full_name || profile.email,
              subject: chTitle,
              html_content: `<p>${(chBody || "").replace(/\n/g, "<br>")}</p>`,
              text_content: chBody,
              notification_id: notification.id,
            }),
          });
          const j = await r.json();
          if (j.success) results.push({ channel: "email", success: true });
          else results.push({ channel: "email", success: false, error: j.error || "email_failed" });
        }
      } catch (err: any) {
        results.push({ channel, success: false, error: err.message });
      }
    }));

    const delivered = results.some((r) => r.success);
    const realFailures = results.filter((r) => !r.success && !r.skipped);
    const onlySkipped = results.length > 0 && realFailures.length === 0 && !delivered;

    // ── STEP 7: In-app fallback + logging ──
    if (!delivered) {
      if (notification.event_type !== "channel_failure" && !onlySkipped) {
        console.error("[cascade] all channels failed", { notification_id, results });
      }
      await supabase.from("notifications").update({ status: "sent", channel: "in_app" }).eq("id", notification_id);
      await supabase.from("delivery_logs").insert({
        notification_id, channel: "in_app", delivered: true,
        provider_response: { fallback: "in_app", external_channels_failed: selectedChannels, results },
      });
    } else {
      await supabase.from("notifications").update({ status: "sent" }).eq("id", notification_id);
    }

    await supabase.from("delivery_logs").insert({
      notification_id, channel: "cascade", delivered,
      provider_response: {
        selected_channels: selectedChannels,
        default_channel: defaultChannel,
        results,
        routing: "global_settings",
      },
    });

    return new Response(JSON.stringify({ delivered, channels: selectedChannels, results }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-notification-cascade error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
