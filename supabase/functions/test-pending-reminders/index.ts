import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { notificationsEnabled } from "../_shared/config-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Lembretes automáticos para candidatos com testes pendentes.
 *
 * Regras:
 *  - Dispara apenas para test_assignments com status pending/in_progress.
 *  - Só envia se já passaram >= 24h desde a atribuição (created_at).
 *  - Para se o deadline existir e já tiver expirado.
 *  - Anti-duplicação: só envia se last_reminder_sent_at é null OU
 *    se passaram >= 5h desde o último envio (cron roda 2x/dia: 13h e 21h UTC).
 *  - Atualiza last_reminder_sent_at + incrementa reminders_sent_count.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Método não suportado" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Autenticação ausente" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const bearer = authHeader.replace("Bearer ", "");
  if (bearer !== serviceRoleKey && bearer !== anonKey) {
    return new Response(JSON.stringify({ error: "Token inválido" }), {
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

  try {
    const nowIso = new Date().toISOString();
    const cutoff24hIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const cutoff5hIso = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();

    // Busca pendentes elegíveis
    const { data: assignments, error } = await supabase
      .from("test_assignments")
      .select(
        "id, candidate_id, application_id, deadline, last_reminder_sent_at, reminders_sent_count, test_templates!inner(title)",
      )
      .in("status", ["pending", "in_progress"])
      .lte("created_at", cutoff24hIso)
      .or(`deadline.is.null,deadline.gt.${nowIso}`)
      .or(`last_reminder_sent_at.is.null,last_reminder_sent_at.lt.${cutoff5hIso}`);

    if (error) throw error;

    for (const a of assignments || []) {
      try {
        const tplTitle = (a as any).test_templates?.title || "Avaliação";
        const deadlinePart = a.deadline
          ? ` (prazo: ${new Date(a.deadline).toLocaleDateString("pt-BR")})`
          : "";

        const title = "Você tem um teste pendente";
        const body = `Lembrete: o teste "${tplTitle}" ainda não foi concluído${deadlinePart}. Toque para começar.`;

        await supabase.from("notifications").insert({
          event_type: "test_pending_reminder",
          recipient_id: a.candidate_id,
          channel: "push",
          title,
          body,
          status: "sent",
          action_url: "/meus-testes",
          payload: {
            test_assignment_id: a.id,
            application_id: a.application_id,
          },
        });

        // Push
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
              data: { url: "/meus-testes" },
            }),
          });
        } catch (e) {
          console.error("[test-pending-reminders] push failed:", e);
        }

        await supabase
          .from("test_assignments")
          .update({
            last_reminder_sent_at: new Date().toISOString(),
            reminders_sent_count: (a.reminders_sent_count ?? 0) + 1,
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
