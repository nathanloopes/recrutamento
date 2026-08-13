import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withAuth } from "../_shared/with-auth.ts";
import { guardFeatureFlag } from "../_shared/feature-flag-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const log = (step: string, details: Record<string, unknown> = {}) => {
  console.log(JSON.stringify({
    function: "match-talents",
    step,
    at: new Date().toISOString(),
    ...details,
  }));
};

Deno.serve(withAuth(async (req, ctx) => {
  const startedAt = Date.now();
  log("start", { user_id: ctx.userId });

  const flagBlock = await guardFeatureFlag("talent_pool");
  if (flagBlock) {
    log("blocked_by_feature_flag");
    return flagBlock;
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { unit_job_id } = await req.json();
    if (!unit_job_id) {
      return new Response(JSON.stringify({ error: "unit_job_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Auto-invite setting
    const { data: autoSetting } = await supabase
      .from("global_settings")
      .select("value")
      .eq("category", "talent_pool")
      .eq("key", "auto_invite_enabled")
      .single();

    if (autoSetting && autoSetting.value === false) {
      log("auto_invite_disabled", { unit_job_id });
      return new Response(
        JSON.stringify({ message: "Auto invite disabled", invited: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Run matching RPC
    log("calling_rpc", { unit_job_id });
    const { data: matches, error: matchError } = await supabase.rpc(
      "match_talents",
      { _unit_job_id: unit_job_id }
    );
    if (matchError) throw matchError;

    log("rpc_result", {
      unit_job_id,
      matches_count: matches?.length ?? 0,
      elapsed_ms: Date.now() - startedAt,
    });

    if (!matches || matches.length === 0) {
      return new Response(
        JSON.stringify({ message: "Nenhum talento compatível encontrado", invited: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Job info for notification body
    const { data: ujData } = await supabase
      .from("unit_jobs")
      .select("job_id, unit_id, jobs:job_id(title), units:unit_id(name)")
      .eq("id", unit_job_id)
      .single();
    const jobTitle = (ujData as any)?.jobs?.title || "vaga";
    const unitName = (ujData as any)?.units?.name || "unidade";

    const candidateIds: string[] = matches.map((m: any) => m.candidate_id);

    // Bulk check for existing invites
    const { data: existingInvites } = await supabase
      .from("talent_invites")
      .select("candidate_id")
      .eq("unit_job_id", unit_job_id)
      .in("status", ["pending", "accepted"])
      .in("candidate_id", candidateIds);

    const existingSet = new Set<string>(
      (existingInvites ?? []).map((row: any) => row.candidate_id)
    );

    const newCandidateIds = candidateIds.filter((id) => !existingSet.has(id));
    log("filtered_candidates", {
      unit_job_id,
      total: candidateIds.length,
      already_invited: existingSet.size,
      to_invite: newCandidateIds.length,
    });

    let invitedCount = 0;
    let notificationsCreated = 0;

    if (newCandidateIds.length > 0) {
      // Bulk insert invites
      const invitesPayload = newCandidateIds.map((candidate_id) => ({
        candidate_id,
        unit_job_id,
        status: "pending",
        channel: "email",
        message:
          "Uma nova oportunidade compatível com seu perfil foi aberta. Deseja participar?",
      }));

      const { data: insertedInvites, error: invitesError } = await supabase
        .from("talent_invites")
        .insert(invitesPayload)
        .select("candidate_id");

      if (invitesError) {
        log("invites_bulk_insert_failed", { error: invitesError.message });
        throw invitesError;
      }
      invitedCount = insertedInvites?.length ?? 0;

      // Bulk insert notifications (status pending; envio fica a cargo do motor de notificações)
      const notificationsPayload = (insertedInvites ?? []).map((row: any) => ({
        event_type: "talent_invite_sent",
        recipient_id: row.candidate_id,
        channel: "push",
        title: "Convite para Processo Seletivo",
        body: `Você foi convidado(a) para o processo seletivo de ${jobTitle} na ${unitName}. Acesse o Banco de Talentos para responder.`,
        status: "pending",
        action_url: "/banco-de-talentos",
        action_type: "action_required",
        payload: { unit_job_id, job_title: jobTitle, unit_name: unitName },
        dedup_key: `talent_invite_sent:${row.candidate_id}:${unit_job_id}`,
      }));

      const { error: notifError, count: notifCount } = await supabase
        .from("notifications")
        .insert(notificationsPayload, { count: "exact" });

      if (notifError) {
        // dedup_key collisions ou outros erros não devem derrubar o matching
        log("notifications_bulk_insert_warning", { error: notifError.message });
      } else {
        notificationsCreated = notifCount ?? notificationsPayload.length;
      }
    }

    // Activity log
    await supabase.from("activity_logs").insert({
      user_id: ctx.userId,
      action: "talent_matching_dispatched",
      module: "talent_pool",
      details: {
        unit_job_id,
        matches: candidateIds.length,
        invited: invitedCount,
        already_invited: existingSet.size,
        notifications_created: notificationsCreated,
      },
    });

    log("done", {
      unit_job_id,
      matches: candidateIds.length,
      invited: invitedCount,
      already_invited: existingSet.size,
      notifications_created: notificationsCreated,
      elapsed_ms: Date.now() - startedAt,
    });

    return new Response(
      JSON.stringify({
        message:
          invitedCount > 0
            ? `${invitedCount} talento(s) convidado(s). O envio das notificações será processado em segundo plano.`
            : "Nenhum novo convite gerado (todos já haviam sido convidados).",
        matches: candidateIds.length,
        invited: invitedCount,
        already_invited: existingSet.size,
        notifications_created: notificationsCreated,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("match-talents error:", err);
    log("fatal_error", {
      error: err instanceof Error ? err.message : String(err),
      elapsed_ms: Date.now() - startedAt,
    });
    return new Response(
      JSON.stringify({ error: "Falha ao executar o matching. Tente novamente." }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
}, { allowedRoles: ["admin", "rh_franqueadora", "franqueado", "gerente_unidade"] }));
