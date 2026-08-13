import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { notificationsEnabled, getSetting } from "../_shared/config-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Método não suportado" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  // Auth check: accept system tokens (service_role/anon) from this Supabase project.
  // verify_jwt=false no platform — validamos aqui de forma tolerante a rotação de chaves
  // (anon JWT legado vs publishable key sb_*) decodificando o payload do JWT.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "Autenticação ausente" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
  const bearerToken = authHeader.replace("Bearer ", "").trim();
  const projectRef = (supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/) || [])[1];
  let authorized = bearerToken === serviceRoleKey || bearerToken === anonKey;
  if (!authorized) {
    try {
      const parts = bearerToken.split(".");
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
        if (payload?.ref === projectRef && (payload?.role === "anon" || payload?.role === "service_role")) {
          authorized = true;
        }
      }
    } catch (_) { /* ignore */ }
  }
  if (!authorized) {
    console.warn("[interview-reminders] auth rejected — bearer não corresponde a service_role/anon do projeto", { projectRef });
    return new Response(
      JSON.stringify({ error: "Token inválido" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
  console.log("[interview-reminders] auth ok — iniciando ciclo");

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Kill switch global (Fase 2 — configGuard)
  if (!(await notificationsEnabled())) {
    return new Response(
      JSON.stringify({ skipped: true, reason: "notifications_enabled is false" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const payload = await req.clone().json();
    const requestedAt = payload?.time ? new Date(payload.time) : null;
    if (requestedAt && Number.isNaN(requestedAt.getTime())) {
      return new Response(
        JSON.stringify({ error: "Payload inválido" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch {
    return new Response(
      JSON.stringify({ error: "Payload inválido" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Lê calendar/reminder_hours_before — lista de horas antes da entrevista.
  // Default: [24, 0.5, 0.1667] (24h, 30min, 10min) — alinhado aos 3 templates
  // Meta ativos: lembrete_entrevista_24h_v2, _30min_v2, _10min.
  const reminderHoursRaw = await getSetting<unknown>(
    "calendar",
    "reminder_hours_before",
    [24, 0.5, 0.1667],
  );
  const reminderHours: number[] = Array.isArray(reminderHoursRaw)
    ? (reminderHoursRaw as unknown[])
        .map((v) => Number(v))
        .filter((n) => Number.isFinite(n) && n > 0)
    : [24, 0.5, 0.1667];
  if (reminderHours.length === 0) reminderHours.push(24, 0.5, 0.1667);

  // Janela de tolerância: marcos disparam quando |diffMin - alvo| <= tolerância.
  // Para alvos longos (>=2h) usamos 60min de tolerância; para curtos, 3min.
  const matchesWindow = (diffMin: number, targetHours: number): boolean => {
    const targetMin = targetHours * 60;
    const tol = targetHours >= 2 ? 60 : 3;
    return Math.abs(diffMin - targetMin) <= tol;
  };

  const now = new Date();
  const results = { reminded_24h: 0, reminded_2h: 0, reminded_1h: 0, reminded_30min: 0, reminded_10min: 0, whatsapp_sent: 0, errors: [] as string[] };



  // Helper: send push notification
  const sendPush = async (recipientId: string, title: string, body: string) => {
    try {
      await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceRoleKey}`,
          "apikey": serviceRoleKey,
        },
        body: JSON.stringify({
          recipient_id: recipientId,
          title,
          body,
          data: { url: "/candidaturas" },
        }),
      });
    } catch (e) {
      console.error("[PUSH] reminder push failed:", e);
    }
  };

  // Helper: send WhatsApp reminder via send-whatsapp edge function.
  // Prefere Meta HSM (template aprovado) quando há template ativo para o event_type.
  // Faz fallback para texto livre apenas se não houver HSM configurado.
  const interpolate = (tpl: string, vars: Record<string, any>) => {
    const s = String(tpl ?? "");
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

  const maskPhone = (p: string) => {
    const digits = (p || "").replace(/\D/g, "");
    if (digits.length < 4) return "****";
    return `****${digits.slice(-4)}`;
  };

  const sendWhatsApp = async (
    candidateId: string,
    fallbackMessage: string,
    eventType: string,
    context: Record<string, any> = {},
    interviewId?: string,
  ) => {
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("phone, full_name")
        .eq("id", candidateId)
        .single();

      if (!profile?.phone) return;

      const { data: tpl } = await supabase
        .from("notification_templates")
        .select("meta_template_name, meta_template_language, meta_variable_mapping")
        .eq("event_type", eventType)
        .eq("channel", "whatsapp")
        .eq("is_active", true)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();

      const ctx = { candidate_name: profile.full_name || "", ...context };
      const waPayload: Record<string, any> = {
        phone: profile.phone,
        message: fallbackMessage,
      };

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

      // Pré-registra a notificação WhatsApp em `notifications` para auditoria.
      // Insere ANTES da chamada para garantir rastro mesmo se send-whatsapp falhar.
      const { data: notifRow } = await supabase
        .from("notifications")
        .insert({
          event_type: eventType,
          recipient_id: candidateId,
          channel: "whatsapp",
          title: tpl?.meta_template_name || eventType,
          body: fallbackMessage,
          status: "pending",
          payload: {
            interview_id: interviewId ?? null,
            template_name: tpl?.meta_template_name ?? null,
            phone_masked: maskPhone(profile.phone),
          },
        })
        .select("id")
        .maybeSingle();

      const notificationId = notifRow?.id ?? null;
      if (notificationId) waPayload.notification_id = notificationId;

      const r = await fetch(`${supabaseUrl}/functions/v1/send-whatsapp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceRoleKey}`,
          "apikey": serviceRoleKey,
        },
        body: JSON.stringify(waPayload),
      });
      const j = await r.json().catch(() => ({}));
      if (j?.success) {
        results.whatsapp_sent++;
        if (notificationId) {
          await supabase
            .from("notifications")
            .update({
              status: "sent",
              payload: {
                interview_id: interviewId ?? null,
                template_name: tpl?.meta_template_name ?? null,
                phone_masked: maskPhone(profile.phone),
                meta_message_id: j?.message_id ?? null,
              },
            })
            .eq("id", notificationId);
        }
      } else {
        console.error("[WHATSAPP] reminder not delivered:", { eventType, candidateId, response: j });
        if (notificationId) {
          await supabase
            .from("notifications")
            .update({
              status: "failed",
              payload: {
                interview_id: interviewId ?? null,
                template_name: tpl?.meta_template_name ?? null,
                phone_masked: maskPhone(profile.phone),
                error: j?.error ?? j ?? "unknown",
              },
            })
            .eq("id", notificationId);
        }
      }
    } catch (e) {
      console.error("[WHATSAPP] reminder failed:", e);
    }
  };


  // URL pública da aplicação — usada para prefixar links LiveKit (caminho relativo no banco)
  // antes de enviá-los por WhatsApp/HSM, onde só URLs absolutas funcionam.
  const APP_PUBLIC_URL = (Deno.env.get("APP_PUBLIC_URL") || "https://recrutamento.example.com").replace(/\/+$/, "");

  // Resolve meeting_link para URL absoluta:
  // - LiveKit (path "/entrevista-online/:id") → prefixa com APP_PUBLIC_URL
  // - Externo (http/https) → mantém como está
  // - Vazio → ""
  const resolveAbsoluteMeetingLink = (raw: string | null | undefined): string => {
    const v = (raw || "").trim();
    if (!v) return "";
    if (/^https?:\/\//i.test(v)) return v;
    if (v.startsWith("/")) return `${APP_PUBLIC_URL}${v}`;
    return v;
  };

  // Formata "YYYY-MM-DD" + "HH:mm[:ss]" como "DD/MM/YYYY às HH:mm" (sem TZ shift,
  // sem rótulos relativos como "amanhã/hoje" — exigido nos templates Meta).
  const formatInterviewDateTime = (dateStr: string, timeStr: string): string => {
    const d = (dateStr || "").slice(0, 10);
    const dm = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const t = (timeStr || "").slice(0, 5);
    if (!dm) return t;
    return `${dm[3]}/${dm[2]}/${dm[1]} às ${t}`;
  };

  // Carrega contexto extra (job_title, interview_datetime) para os params HSM.
  // Os campos já vêm pré-resolvidos da view interviews_for_whatsapp_notifications
  // (JOIN com candidates + applications + unit_jobs + jobs) — não precisamos mais
  // fazer SELECT extra em applications/jobs aqui.
  const getInterviewContext = (interview: any): Record<string, any> => ({
    meeting_link: resolveAbsoluteMeetingLink(interview.meeting_link),
    job_title: interview.job_title || "",
    interview_datetime: interview.interview_datetime
      || formatInterviewDateTime(interview.scheduled_date, interview.scheduled_time),
    candidate_name: interview.candidate_name || "",
  });

  try {
    // Get upcoming interviews (next 25 hours to cover 24h reminder window)
    // Fonte única: view interviews_for_whatsapp_notifications (já traz candidate_name,
    // job_title, interview_datetime resolvidos via JOIN).
    const twentyFiveHoursLater = new Date(now.getTime() + 25 * 60 * 60 * 1000);
    const todayStr = now.toISOString().split("T")[0];
    const futureDate = twentyFiveHoursLater.toISOString().split("T")[0];

    const { data: interviews, error } = await supabase
      .from("interviews_for_whatsapp_notifications")
      .select("interview_id, candidate_id, application_id, unit_id, modality, status, scheduled_date, scheduled_time, meeting_link, reminder_sent, candidate_name, job_title, interview_datetime")
      .eq("status", "confirmed")
      .gte("scheduled_date", todayStr)
      .lte("scheduled_date", futureDate);


    if (error) throw error;

    console.log("[interview-reminders] now=", now.toISOString(), "reminderHours=", reminderHours, "interviews_found=", interviews?.length ?? 0);

    for (const interview of interviews || []) {
      // Guarda anti-corrida: confirma status atual antes de enviar
      if (interview.status !== "confirmed") continue;
      // ⚠️ scheduled_date/_time são BRT — concatenar `-03:00` para parse correto.
      const interviewDateTimeBRT = new Date(`${interview.scheduled_date}T${interview.scheduled_time}-03:00`);
      const diffMinBRT = (interviewDateTimeBRT.getTime() - now.getTime()) / (1000 * 60);

      const reminderSent = (interview.reminder_sent as Record<string, boolean>) || {};
      const waCtx = getInterviewContext(interview);

      console.log("[interview-reminders] iv=", interview.interview_id,
        "date=", interview.scheduled_date, "time=", interview.scheduled_time,
        "diffMinBRT=", diffMinBRT.toFixed(2),
        "reminder_sent=", reminderSent,
      );



      // 24h reminder — DESATIVADO no cron. Agora é enviado pelo trigger
      // `notify-interview-scheduled` no momento em que a entrevista é criada
      // ou reagendada. O cron NÃO deve mais tocar nesse marco para evitar duplicidade.


      // 2h reminder — disparado se 2 ∈ reminder_hours_before (janela mantida)
      if (reminderHours.includes(2) && matchesWindow(diffMinBRT, 2) && !reminderSent["2h"]) {
        const title2h = "Entrevista em 2 horas";
        const body2h = `Sua entrevista está marcada para ${interview.scheduled_time.slice(0, 5)}. Prepare-se!`;


        await supabase.from("notifications").insert({
          event_type: "interview_reminder_2h",
          recipient_id: interview.candidate_id,
          channel: "push",
          title: title2h,
          body: body2h,
          status: "sent",
          payload: { interview_id: interview.interview_id, time: interview.scheduled_time },
        });

        await sendPush(interview.candidate_id, title2h, body2h);
        await sendWhatsApp(interview.candidate_id, body2h, "interview_reminder_2h", waCtx, interview.interview_id);

        await supabase.from("interviews")
          .update({ reminder_sent: { ...reminderSent, "2h": true } })
          .eq("id", interview.interview_id);

        results.reminded_2h++;
      }

      // 1h reminder — disparado se 1 ∈ reminder_hours_before (janela mantida)
      if (reminderHours.includes(1) && matchesWindow(diffMinBRT, 1) && !reminderSent["1h"]) {
        const title1h = "Sua entrevista começa em 1 hora";
        const body1h = `Sua entrevista está marcada para ${interview.scheduled_time.slice(0, 5)}. Prepare-se!`;

        await supabase.from("notifications").insert({
          event_type: "interview_reminder_1h",
          recipient_id: interview.candidate_id,
          channel: "push",
          title: title1h,
          body: body1h,
          status: "sent",
          payload: { interview_id: interview.interview_id, time: interview.scheduled_time },
        });

        await sendPush(interview.candidate_id, title1h, body1h);
        await sendWhatsApp(interview.candidate_id, body1h, "interview_reminder_1h", waCtx, interview.interview_id);

        if (interview.application_id) {
          await supabase.rpc("sara_post_event", {
            _application_id: interview.application_id,
            _kind: "interview_reminder_1h",
            _payload: { ref: interview.interview_id, time_str: interview.scheduled_time.slice(0, 5) },
          });
        }

        await supabase.from("interviews")
          .update({ reminder_sent: { ...reminderSent, "1h": true } })
          .eq("id", interview.interview_id);

        results.reminded_1h++;
      }


      // 30min reminder — semântica de LIMIAR (não janela):
      // dispara se diff <= 30 e ainda não enviado. Garante envio mesmo para
      // entrevistas marcadas em cima da hora (ex.: 25min de antecedência).
      if (reminderHours.some((h) => Math.abs(h - 0.5) < 0.02)
          && diffMinBRT <= 30 && diffMinBRT >= -1
          && !reminderSent["30min"]) {
        const title30 = "Entrevista em 30 minutos";
        const body30 = `Sua entrevista começa em 30 minutos às ${interview.scheduled_time.slice(0, 5)}.`;

        await supabase.from("notifications").insert({
          event_type: "interview_reminder_30min",
          recipient_id: interview.candidate_id,
          channel: "push",
          title: title30,
          body: body30,
          status: "sent",
          payload: { interview_id: interview.interview_id, time: interview.scheduled_time },
        });

        await sendPush(interview.candidate_id, title30, body30);
        await sendWhatsApp(interview.candidate_id, body30, "interview_reminder_30min", waCtx, interview.interview_id);

        await supabase.from("interviews")
          .update({ reminder_sent: { ...reminderSent, "30min": true } })
          .eq("id", interview.interview_id);

        results.reminded_30min++;
      }


      // 10min reminder — semântica de LIMIAR (não janela)
      if (reminderHours.some((h) => Math.abs(h - 0.1667) < 0.02)
          && diffMinBRT <= 10 && diffMinBRT >= -1
          && !reminderSent["10min"]) {
        const title10 = "Entrevista em 10 minutos!";
        const body10 = interview.modality === "online" && interview.meeting_link
          ? `Sua entrevista começa em 10 minutos! Link: ${interview.meeting_link}`
          : `Sua entrevista começa em 10 minutos às ${interview.scheduled_time.slice(0, 5)}!`;

        await supabase.from("notifications").insert({
          event_type: "interview_reminder_10min",
          recipient_id: interview.candidate_id,
          channel: "push",
          title: title10,
          body: body10,
          status: "sent",
          payload: { interview_id: interview.interview_id, time: interview.scheduled_time },
        });

        await sendPush(interview.candidate_id, title10, body10);
        // HSM lembrete_entrevista_10min exige meeting_link ({{3}}).
        // Para online: usa link real. Para presencial: usa texto descritivo
        // (Meta aceita qualquer texto na variável, desde que preenchida).
        const waCtx10 = {
          ...waCtx,
          meeting_link: interview.modality === "online" && waCtx.meeting_link
            ? waCtx.meeting_link
            : `Presencial às ${interview.scheduled_time.slice(0, 5)}`,
        };
        await sendWhatsApp(interview.candidate_id, body10, "interview_reminder_10min", waCtx10, interview.interview_id);

        await supabase.from("interviews")
          .update({ reminder_sent: { ...reminderSent, "10min": true } })
          .eq("id", interview.interview_id);

        results.reminded_10min++;
      }

    }



    // ─── Lembretes de CONFIRMAÇÃO de presença ───
    // Envia push se candidato não confirmou presença ainda (confirmed_at IS NULL)
    // Marcos: 2h e 24h após criação da entrevista. Apenas para entrevistas
    // ativas (status 'confirmed' ou 'rescheduled') e ainda no futuro.
    const { data: unconfirmedInterviews } = await supabase
      .from("interviews")
      .select("id, candidate_id, scheduled_date, scheduled_time, reminder_sent, status, created_at, confirmed_at, modality")
      .in("status", ["confirmed", "rescheduled"])
      .is("confirmed_at", null)
      .gte("scheduled_date", now.toISOString().split("T")[0]);

    for (const itv of unconfirmedInterviews || []) {
      if (itv.confirmed_at) continue;
      if (itv.modality === "ai_interview") continue; // IA não precisa confirmação humana
      const itvDt = new Date(`${itv.scheduled_date}T${itv.scheduled_time}-03:00`);
      if (itvDt.getTime() <= now.getTime()) continue; // já passou
      const createdAt = new Date((itv as any).created_at);
      const hoursSinceCreated = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
      const rs = (itv.reminder_sent as Record<string, boolean>) || {};

      // Marco 1 — 2h após criação (tolerância 1h)
      if (hoursSinceCreated >= 2 && hoursSinceCreated < 24 && !rs["confirm_2h"]) {
        const title = "Confirme sua entrevista 👀";
        const body = "Percebemos que você ainda não confirmou sua entrevista. Confirme sua participação ou reagende o horário para garantir sua vaga.";
        await supabase.from("notifications").insert({
          event_type: "interview_confirm_reminder_2h",
          recipient_id: itv.candidate_id,
          channel: "push",
          title,
          body,
          status: "sent",
          payload: { interview_id: itv.id, url: "/candidaturas" },
        });
        await sendPush(itv.candidate_id, title, body);
        await supabase.from("interviews")
          .update({ reminder_sent: { ...rs, "confirm_2h": true } })
          .eq("id", itv.id);
      }

      // Marco 2 — 24h após criação
      if (hoursSinceCreated >= 24 && !rs["confirm_24h"]) {
        const title = "Sua entrevista ainda aguarda confirmação ⚠️";
        const body = "Caso não consiga participar nesse horário, é possível reagendar rapidamente. Evite perder sua oportunidade no processo seletivo.";
        await supabase.from("notifications").insert({
          event_type: "interview_confirm_reminder_24h",
          recipient_id: itv.candidate_id,
          channel: "push",
          title,
          body,
          status: "sent",
          payload: { interview_id: itv.id, url: "/candidaturas" },
        });
        await sendPush(itv.candidate_id, title, body);
        await supabase.from("interviews")
          .update({ reminder_sent: { ...rs, "confirm_24h": true } })
          .eq("id", itv.id);
      }
    }

  } catch (e: any) {
    results.errors.push(e.message);
  }

  return new Response(JSON.stringify(results), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
