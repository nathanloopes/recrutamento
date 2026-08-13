import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { withAuth } from "../_shared/with-auth.ts";
import { notificationsEnabled } from "../_shared/config-guard.ts";
import {
  SENDER_EMAIL,
  SENDER_NAME,
  REPLY_TO_EMAIL,
  buildDeliverabilityHeaders,
  ensureFooterHtml,
  institutionalFooterText,
  htmlToPlainText,
} from "../_shared/email-footer.ts";

Deno.serve(withAuth(async (req) => {
  try {
    // Kill switch global (Fase 2 — configGuard)
    if (!(await notificationsEnabled())) {
      return new Response(
        JSON.stringify({ delivered: false, blocked: "kill_switch", reason: "notifications_enabled is false" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Health check curto-circuito (painel de monitoramento) — antes de checar credenciais
    let _bodyClone: any = null;
    try { _bodyClone = await req.clone().json(); } catch { _bodyClone = null; }
    if (_bodyClone?.dry_run) {
      return new Response(
        JSON.stringify({ success: true, dry_run: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, serviceKey);

    // Read default_tone and default_language from CrossConfig
    const { data: toneLanguageSettings } = await supabase
      .from("global_settings")
      .select("key, value")
      .eq("category", "units")
      .in("key", ["default_tone", "default_language"]);
    const tlMap: Record<string, any> = {};
    (toneLanguageSettings || []).forEach((s: any) => { tlMap[s.key] = s.value; });
    const defaultTone = typeof tlMap.default_tone === "string" ? tlMap.default_tone.replace(/"/g, "") : "formal";
    const defaultLanguage = typeof tlMap.default_language === "string" ? tlMap.default_language.replace(/"/g, "") : "pt-BR";

    const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY");
    if (!BREVO_API_KEY) {
      console.error("BREVO_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "Email service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { to_email, to_name, subject, html_content, text_content, notification_id, sync } = await req.json();

    if (!to_email || !subject) {
      return new Response(
        JSON.stringify({ error: "to_email and subject are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(to_email)) {
      return new Response(
        JSON.stringify({ error: "Invalid email format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Default mode: enqueue and return immediately (non-blocking).
    // Use sync=true ONLY when the caller must wait for actual delivery (e.g. password reset flow).
    if (!sync) {
      const t0enq = Date.now();
      const { data: queued, error: qErr } = await supabase
        .from("email_queue")
        .insert({
          to_email,
          to_name: to_name || null,
          subject,
          html_content: html_content || null,
          text_content: text_content || null,
          notification_id: notification_id || null,
          status: "pending",
        })
        .select("id, created_at")
        .single();
      if (qErr) {
        console.error("[send-email] enqueue error:", qErr);
        return new Response(
          JSON.stringify({ success: false, error: "enqueue_failed" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      console.log(`[send-email] queued id=${queued.id} to=${to_email} enqueue_ms=${Date.now() - t0enq} event_created_at=${queued.created_at}`);
      // Best-effort: kick the worker immediately (fire-and-forget) so latency stays well under 30s
      // even between cron ticks. We don't await — the cron is the durable guarantee.
      fetch(`${supabaseUrl}/functions/v1/process-email-queue`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ once: true }),
      }).catch(() => { /* swallow */ });

      return new Response(
        JSON.stringify({ success: true, queued: true, queue_id: queued.id }),
        { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Sanitize to_name to prevent header injection
    const safeName = (to_name || to_email).replace(/[\r\n]/g, "").slice(0, 200);

    // Build safe HTML content - escape text_content if used as fallback
    const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const safeHtmlContent = html_content || `<p>${escapeHtml(text_content || subject)}</p>`;

    // Versão HTML com rodapé institucional + texto plano real (multipart)
    const htmlWithFooter = ensureFooterHtml(safeHtmlContent, to_email);
    const plainTextContent = (text_content && text_content.trim().length > 20)
      ? `${text_content}\n${institutionalFooterText(to_email)}`
      : `${htmlToPlainText(htmlWithFooter)}`;

    const requestSentAt = new Date().toISOString();
    const t0 = Date.now();
    const brevoResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": BREVO_API_KEY,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        sender: { name: SENDER_NAME, email: SENDER_EMAIL },
        replyTo: { email: REPLY_TO_EMAIL, name: SENDER_NAME },
        to: [{ email: to_email, name: safeName }],
        subject,
        htmlContent: htmlWithFooter,
        textContent: plainTextContent,
        headers: {
          "Content-Language": defaultLanguage,
          "X-Tone": defaultTone,
          ...buildDeliverabilityHeaders(to_email, notification_id),
        },
      }),
    });

    const brevoResult = await brevoResponse.json();
    const responseReceivedAt = new Date().toISOString();
    const brevoLatencyMs = Date.now() - t0;
    const delivered = brevoResponse.ok;

    console.log(`[send-email] to=${to_email} status=${brevoResponse.status} latency_ms=${brevoLatencyMs} messageId=${brevoResult?.messageId || "n/a"}`);

    // Log delivery with timestamps for diagnostics (atraso real Brevo vs receptor)
    if (notification_id) {
      await supabase.from("delivery_logs").insert({
        notification_id,
        channel: "email",
        delivered,
        provider_response: {
          ...brevoResult,
          request_sent_at: requestSentAt,
          response_received_at: responseReceivedAt,
          brevo_latency_ms: brevoLatencyMs,
          brevo_status: brevoResponse.status,
          brevo_message_id: brevoResult?.messageId || null,
        },
      });

      await supabase
        .from("notifications")
        .update({ status: delivered ? "sent" : "failed" })
        .eq("id", notification_id);
    }

    if (!delivered) {
      console.error("Brevo error:", brevoResult);
      return new Response(
        JSON.stringify({ success: false, error: "Email delivery failed" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, messageId: brevoResult.messageId }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("send-email error:", err);
    return new Response(
      JSON.stringify({ error: "An error occurred. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}, { allowedRoles: ["admin", "rh_franqueadora"] }));
