import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  SENDER_EMAIL,
  SENDER_NAME,
  REPLY_TO_EMAIL,
  buildDeliverabilityHeaders,
  ensureFooterHtml,
  institutionalFooterText,
  htmlToPlainText,
} from "../_shared/email-footer.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 20;
const LOOP_DURATION_MS = 50_000; // run for ~50s per cron tick (cron runs every 60s)
const TICK_INTERVAL_MS = 5_000;  // process a batch every 5s within the loop

async function processBatch(supabase: any, brevoApiKey: string): Promise<number> {
  // Atomically claim a batch
  const { data: claimed, error: claimErr } = await supabase
    .from("email_queue")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (claimErr || !claimed || claimed.length === 0) return 0;

  const ids = claimed.map((r: any) => r.id);
  const pickedAt = new Date().toISOString();
  await supabase
    .from("email_queue")
    .update({ status: "sending", picked_at: pickedAt })
    .in("id", ids)
    .eq("status", "pending");

  let sent = 0;
  for (const row of claimed) {
    const t0 = Date.now();
    try {
      const safeName = (row.to_name || row.to_email).replace(/[\r\n]/g, "").slice(0, 200);
      const htmlWithFooter = ensureFooterHtml(row.html_content || `<p>${row.text_content || row.subject}</p>`, row.to_email);
      const plainText = (row.text_content && row.text_content.trim().length > 20)
        ? `${row.text_content}\n${institutionalFooterText(row.to_email)}`
        : htmlToPlainText(htmlWithFooter);

      const requestSentAt = new Date().toISOString();
      const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": brevoApiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          sender: { name: SENDER_NAME, email: SENDER_EMAIL },
          replyTo: { email: REPLY_TO_EMAIL, name: SENDER_NAME },
          to: [{ email: row.to_email, name: safeName }],
          subject: row.subject,
          htmlContent: htmlWithFooter,
          textContent: plainText,
          headers: buildDeliverabilityHeaders(row.to_email, row.notification_id),
        }),
      });
      const result = await resp.json();
      const responseReceivedAt = new Date().toISOString();
      const latencyMs = Date.now() - t0;
      const queuedToSentMs = Date.parse(responseReceivedAt) - Date.parse(row.created_at);

      console.log(`[queue] id=${row.id} to=${row.to_email} brevo_status=${resp.status} brevo_latency_ms=${latencyMs} queued_to_sent_ms=${queuedToSentMs} messageId=${result?.messageId || "n/a"}`);

      if (resp.ok) {
        await supabase
          .from("email_queue")
          .update({
            status: "sent",
            sent_at: responseReceivedAt,
            attempts: (row.attempts || 0) + 1,
            brevo_response: {
              ...result,
              request_sent_at: requestSentAt,
              response_received_at: responseReceivedAt,
              brevo_latency_ms: latencyMs,
              brevo_status: resp.status,
              queued_to_sent_ms: queuedToSentMs,
            },
          })
          .eq("id", row.id);

        if (row.notification_id) {
          await supabase.from("delivery_logs").insert({
            notification_id: row.notification_id,
            channel: "email",
            delivered: true,
            provider_response: {
              ...result,
              event_created_at: row.created_at,
              email_picked_at: pickedAt,
              brevo_request_at: requestSentAt,
              brevo_response_at: responseReceivedAt,
              brevo_latency_ms: latencyMs,
              queued_to_sent_ms: queuedToSentMs,
            },
          });
          await supabase
            .from("notifications")
            .update({ status: "sent" })
            .eq("id", row.notification_id);
        }
        sent++;
      } else {
        const attempts = (row.attempts || 0) + 1;
        const isFinal = attempts >= MAX_ATTEMPTS;
        await supabase
          .from("email_queue")
          .update({
            status: isFinal ? "dlq" : "pending",
            attempts,
            last_error: JSON.stringify(result).slice(0, 1000),
            picked_at: null,
          })
          .eq("id", row.id);
        if (isFinal && row.notification_id) {
          await supabase
            .from("notifications")
            .update({ status: "failed" })
            .eq("id", row.notification_id);
        }
      }
    } catch (err: any) {
      const attempts = (row.attempts || 0) + 1;
      const isFinal = attempts >= MAX_ATTEMPTS;
      console.error(`[queue] id=${row.id} exception:`, err?.message);
      await supabase
        .from("email_queue")
        .update({
          status: isFinal ? "dlq" : "pending",
          attempts,
          last_error: String(err?.message || err).slice(0, 1000),
          picked_at: null,
        })
        .eq("id", row.id);
    }
  }
  return sent;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const brevoApiKey = Deno.env.get("BREVO_API_KEY");

  if (!brevoApiKey) {
    return new Response(JSON.stringify({ error: "BREVO_API_KEY not configured" }), { status: 500, headers: corsHeaders });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Allow on-demand invoke (no loop) by passing { once: true }
  let once = false;
  try {
    const body = await req.clone().json();
    if (body?.once === true) once = true;
  } catch { /* no body */ }

  const start = Date.now();
  let totalSent = 0;
  let cycles = 0;

  do {
    const sent = await processBatch(supabase, brevoApiKey);
    totalSent += sent;
    cycles++;
    if (once) break;
    if (Date.now() - start + TICK_INTERVAL_MS >= LOOP_DURATION_MS) break;
    await new Promise((r) => setTimeout(r, TICK_INTERVAL_MS));
  } while (true);

  return new Response(
    JSON.stringify({ ok: true, total_sent: totalSent, cycles, duration_ms: Date.now() - start }),
    { status: 200, headers: corsHeaders }
  );
});
