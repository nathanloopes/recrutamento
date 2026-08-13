import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { notificationsEnabled } from "../_shared/config-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Lembretes para candidatos que iniciaram a candidatura mas não realizaram a triagem.
 *
 * Critério: applications.status='em_andamento' AND total_score=0 AND created_at <= now()-24h.
 * Debounce: 5h entre envios (cron roda 2x/dia em 13h e 21h UTC = 10h e 18h BRT).
 * onPress: action_url=/triagem/{application_id}
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Método não suportado" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  // Auth: Supabase gateway já exige apikey válida para chegar aqui.
  // Mantemos apenas a checagem de presença do Bearer para evitar 500.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Autenticação ausente" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!(await notificationsEnabled())) {
    return new Response(
      JSON.stringify({ skipped: true, reason: "notifications_enabled is false" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const results = { sent: 0, skipped: 0, errors: [] as string[] };

  // Suporta ?force=1 (ou body { force: true }) para ignorar a janela de 24h —
  // usado no disparo manual inicial.
  let force = false;
  try {
    const url = new URL(req.url);
    if (url.searchParams.get("force") === "1") force = true;
    const body = await req.clone().json().catch(() => null);
    if (body && body.force === true) force = true;
  } catch { /* ignore */ }

  try {
    const cutoff24hIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const cutoff5hIso = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();

    let q = supabase
      .from("applications")
      .select("id, candidate_id, total_score, created_at, last_triage_reminder_sent_at, triage_reminders_sent_count")
      .eq("status", "em_andamento")
      .or("total_score.is.null,total_score.eq.0")
      .or(`last_triage_reminder_sent_at.is.null,last_triage_reminder_sent_at.lt.${cutoff5hIso}`);

    if (!force) q = q.lte("created_at", cutoff24hIso);

    const { data: apps, error } = await q;
    if (error) throw error;

    for (const a of apps || []) {
      try {
        const title = "Continue sua candidatura";
        const body = "Você ainda não finalizou as perguntas iniciais. Toque para continuar.";
        const actionUrl = `/triagem/${a.id}`;

        await supabase.from("notifications").insert({
          event_type: "triage_pending_reminder",
          recipient_id: a.candidate_id,
          channel: "push",
          title,
          body,
          status: "sent",
          action_url: actionUrl,
          payload: { application_id: a.id },
        });

        try {
          await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${serviceRoleKey}`,
              "apikey": serviceRoleKey,
            },
            body: JSON.stringify({
              recipient_id: a.candidate_id,
              title,
              body,
              data: { url: actionUrl },
            }),
          });
        } catch (e) {
          console.error("[triage-pending-reminders] push failed:", e);
        }

        await supabase
          .from("applications")
          .update({
            last_triage_reminder_sent_at: new Date().toISOString(),
            triage_reminders_sent_count: (a.triage_reminders_sent_count ?? 0) + 1,
          })
          .eq("id", a.id);

        results.sent++;
      } catch (e: any) {
        results.errors.push(`${a.id}: ${e.message}`);
      }
    }
  } catch (e: any) {
    results.errors.push(e.message);
  }

  return new Response(JSON.stringify(results), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
