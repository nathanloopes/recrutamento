// notify-interview-scheduled
// Dispara o HSM lembrete_entrevista_24h_v2 imediatamente quando uma entrevista
// é criada (event_type=interview_approved) ou reagendada (event_type=interview_rescheduled).
// Chamada por trigger Postgres em public.interviews via pg_net.
// Marca interviews.reminder_sent['24h']=true para evitar duplicidade com o cron.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const APP_PUBLIC_URL = (Deno.env.get("APP_PUBLIC_URL") || "https://recrutamento.example.com").replace(/\/+$/, "");

function resolveAbsoluteMeetingLink(raw: string | null | undefined): string {
  const v = (raw || "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith("/")) return `${APP_PUBLIC_URL}${v}`;
  return v;
}

function formatInterviewDateTime(dateStr: string, timeStr: string): string {
  const d = (dateStr || "").slice(0, 10);
  const dm = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const t = (timeStr || "").slice(0, 5);
  if (!dm) return `${dateStr} às ${t}`;
  return `${dm[3]}/${dm[2]}/${dm[1]} às ${t}`;
}

function interpolate(tpl: string, vars: Record<string, any>): string {
  const s = String(tpl ?? "");
  if (/^[\w.-]+$/.test(s.trim())) {
    const v = vars?.[s.trim()];
    if (v !== undefined && v !== null && String(v) !== "") return String(v);
  }
  return s.replace(/\{\{\s*([\w_.-]+)\s*\}\}/g, (_, k) => {
    const v = vars?.[k];
    return v === undefined || v === null ? "" : String(v);
  });
}

function maskPhone(p: string) {
  const digits = (p || "").replace(/\D/g, "");
  if (digits.length < 4) return "****";
  return `****${digits.slice(-4)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const projectRef = (supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/) || [])[1];

  // Auth: aceita service_role / anon do projeto (tolerante a rotação de chave).
  const authHeader = req.headers.get("Authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  let authorized = bearer && (bearer === serviceRoleKey || bearer === anonKey);
  if (!authorized && bearer) {
    try {
      const parts = bearer.split(".");
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
        if (payload?.ref === projectRef && (payload?.role === "anon" || payload?.role === "service_role")) {
          authorized = true;
        }
      }
    } catch (_) { /* ignore */ }
  }
  if (!authorized) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: any = {};
  try { body = await req.json(); } catch (_) { /* allow empty */ }
  const interviewId: string | undefined = body?.interview_id;
  const kind: "approved" | "rescheduled" = body?.kind === "rescheduled" ? "rescheduled" : "approved";

  if (!interviewId) {
    return new Response(JSON.stringify({ error: "interview_id required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: iv, error: ivErr } = await supabase
    .from("interviews_for_whatsapp_notifications")
    .select("*")
    .eq("interview_id", interviewId)
    .maybeSingle();

  if (ivErr || !iv) {
    console.warn("[notify-interview-scheduled] interview not found", { interviewId, err: ivErr?.message });
    return new Response(JSON.stringify({ skipped: true, reason: "interview_not_found" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const reminderSent = (iv.reminder_sent as Record<string, boolean>) || {};
  // Idempotência: se já foi enviado o 24h e é INSERT, não reenvia.
  if (kind === "approved" && reminderSent["24h"]) {
    console.log("[notify-interview-scheduled] 24h já enviado — skip", { interviewId });
    return new Response(JSON.stringify({ skipped: true, reason: "already_sent" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const eventType = kind === "rescheduled" ? "interview_rescheduled" : "interview_approved";

  // Resolve template ativo
  const { data: tpl } = await supabase
    .from("notification_templates")
    .select("meta_template_name, meta_template_language, meta_variable_mapping")
    .eq("event_type", eventType)
    .eq("channel", "whatsapp")
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const ctx = {
    candidate_name: iv.candidate_name || "",
    job_title: iv.job_title || "",
    interview_datetime: iv.interview_datetime || formatInterviewDateTime(iv.scheduled_date, iv.scheduled_time),
    meeting_link: resolveAbsoluteMeetingLink(iv.meeting_link),
  };

  const fallbackMessage = kind === "rescheduled"
    ? `Sua entrevista foi reagendada para ${ctx.interview_datetime}.`
    : `Sua entrevista para ${ctx.job_title} está marcada para ${ctx.interview_datetime}.`;

  const phone = iv.recipient_phone as string | null;
  if (!phone) {
    console.warn("[notify-interview-scheduled] candidato sem telefone", { interviewId });
    return new Response(JSON.stringify({ skipped: true, reason: "no_phone" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const waPayload: Record<string, any> = { phone, message: fallbackMessage };
  if (tpl?.meta_template_name) {
    const mapping: any[] = Array.isArray(tpl.meta_variable_mapping) ? tpl.meta_variable_mapping : [];
    waPayload.template_name = String(tpl.meta_template_name).trim();
    waPayload.template_language = tpl.meta_template_language || "pt_BR";
    waPayload.template_components = [{
      type: "body",
      parameters: mapping.map((v: any) => ({
        type: "text",
        text: interpolate(String(v ?? ""), ctx) || "-",
      })),
    }];
  }

  // Pré-registra notificação
  const { data: notifRow } = await supabase.from("notifications").insert({
    event_type: eventType,
    recipient_id: iv.candidate_id,
    channel: "whatsapp",
    title: tpl?.meta_template_name || eventType,
    body: fallbackMessage,
    status: "pending",
    payload: {
      interview_id: interviewId,
      template_name: tpl?.meta_template_name ?? null,
      phone_masked: maskPhone(phone),
      kind,
    },
  }).select("id").maybeSingle();
  if (notifRow?.id) waPayload.notification_id = notifRow.id;

  // Marca 24h enviado ANTES da chamada para evitar corrida com o cron (a cada 1 min).
  // Em reagendamento, resetamos 30min/10min para que voltem a disparar.
  const newReminderSent: Record<string, boolean> = { ...reminderSent, "24h": true };
  if (kind === "rescheduled") {
    delete newReminderSent["30min"];
    delete newReminderSent["10min"];
  }
  await supabase.from("interviews")
    .update({ reminder_sent: newReminderSent })
    .eq("id", interviewId);

  // Dispara WhatsApp
  let waResult: any = {};
  try {
    const r = await fetch(`${supabaseUrl}/functions/v1/send-whatsapp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceRoleKey}`,
        "apikey": serviceRoleKey,
      },
      body: JSON.stringify(waPayload),
    });
    waResult = await r.json().catch(() => ({}));
  } catch (e) {
    console.error("[notify-interview-scheduled] send-whatsapp failed:", e);
    waResult = { success: false, error: String(e) };
  }

  if (notifRow?.id) {
    if (waResult?.success) {
      await supabase.from("notifications").update({
        status: "sent",
        payload: {
          interview_id: interviewId,
          template_name: tpl?.meta_template_name ?? null,
          phone_masked: maskPhone(phone),
          meta_message_id: waResult?.message_id ?? null,
          kind,
        },
      }).eq("id", notifRow.id);
    } else {
      await supabase.from("notifications").update({
        status: "failed",
        payload: {
          interview_id: interviewId,
          template_name: tpl?.meta_template_name ?? null,
          phone_masked: maskPhone(phone),
          error: waResult?.error ?? waResult ?? "unknown",
          kind,
        },
      }).eq("id", notifRow.id);
    }
  }

  console.log("[notify-interview-scheduled] done", {
    interviewId, kind, template: tpl?.meta_template_name, delivered: !!waResult?.success,
  });

  return new Response(
    JSON.stringify({ ok: true, kind, template: tpl?.meta_template_name ?? null, delivered: !!waResult?.success }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
