import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * notify-link-opportunity-passed
 * Disparado pelo frontend quando o candidato autenticado reabre um link de
 * vaga onde já passou (verdict=redirect_discovery, reason=already_attempted_this_job).
 * Insere 1 push de aviso. Dedup por índice único (recipient_id, event_type, payload->>application_id).
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { token } = await req.json();
    if (!token) {
      return new Response(JSON.stringify({ error: "token required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: userData } = await userClient.auth.getUser();
    const user = userData?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Resolve link -> unit_job_id
    const { data: link } = await admin
      .from("recruitment_links")
      .select("id, job_id, unit_id, channel, campaign")
      .eq("token", token)
      .maybeSingle();
    if (!link) {
      return new Response(JSON.stringify({ ok: true, skipped: "link_not_found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: uj } = await admin
      .from("unit_jobs")
      .select("id")
      .eq("job_id", link.job_id)
      .eq("unit_id", link.unit_id)
      .maybeSingle();
    if (!uj) {
      return new Response(JSON.stringify({ ok: true, skipped: "unit_job_not_found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: app } = await admin
      .from("applications")
      .select("id")
      .eq("candidate_id", user.id)
      .eq("unit_job_id", uj.id)
      .in("status", ["reprovado", "desistente", "desligado", "contratado"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!app) {
      return new Response(JSON.stringify({ ok: true, skipped: "no_past_application" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: insErr } = await admin.from("notifications").insert({
      event_type: "link_opportunity_passed",
      recipient_id: user.id,
      channel: "push",
      title: "Essa oportunidade já passou",
      body: "Você já participou desse processo. O portal tem outras vagas em diferentes unidades — vamos dar uma olhada juntos?",
      status: "pending",
      action_url: "/oportunidades",
      action_type: "info",
      payload: {
        application_id: app.id,
        unit_job_id: uj.id,
        origin_link_id: link.id,
        origin_channel: link.channel,
        origin_campaign: link.campaign,
      },
    } as any);

    if (insErr && !String(insErr.message || "").includes("duplicate")) {
      console.error("notify-link-opportunity-passed insert error:", insErr);
      return new Response(JSON.stringify({ error: insErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, deduped: !!insErr }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("notify-link-opportunity-passed error:", e);
    return new Response(JSON.stringify({ error: e?.message || "internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
