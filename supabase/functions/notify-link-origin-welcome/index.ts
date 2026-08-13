import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * notify-link-origin-welcome
 * Disparado pelo frontend logo após apply_via_link retornar verdict='applied'.
 * Insere 1 push de boas-vindas explicando que a plataforma é maior do que aquele link.
 * Dedup garantido por índice único em (recipient_id, event_type, payload->>application_id).
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // ── Auth gate ──
    const authHeader = req.headers.get("Authorization") || "";
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    let authorized = !!bearer && bearer === serviceKey;
    if (!authorized && bearer && bearer !== anonKey) {
      const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${bearer}` } } });
      const { data, error } = await userClient.auth.getUser();
      authorized = !!data?.user && !error;
    }
    if (!authorized) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { application_id } = await req.json();
    if (!application_id) {
      return new Response(JSON.stringify({ error: "application_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: app, error: appErr } = await supabase
      .from("applications")
      .select("id, candidate_id, origin_link_id, origin_channel, origin_campaign, unit_jobs(jobs(title), units(name))")
      .eq("id", application_id)
      .maybeSingle();

    if (appErr || !app) {
      return new Response(JSON.stringify({ error: "application_not_found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!app.origin_link_id) {
      return new Response(JSON.stringify({ ok: true, skipped: "not_from_link" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Insere; dedup é garantido pelo índice único (silencia 23505).
    const { error: insErr } = await supabase.from("notifications").insert({
      event_type: "link_origin_welcome",
      recipient_id: app.candidate_id,
      channel: "push",
      title: "Tudo pronto pra começar",
      body: "Você entrou por um convite direto. Caso essa oportunidade não seja a ideal, o portal tem outras vagas em diferentes unidades esperando por você.",
      status: "pending",
      action_url: "/candidaturas",
      action_type: "info",
      payload: {
        application_id: app.id,
        origin_link_id: app.origin_link_id,
        origin_channel: app.origin_channel,
        origin_campaign: app.origin_campaign,
      },
    } as any);

    if (insErr && !String(insErr.message || "").includes("duplicate")) {
      console.error("notify-link-origin-welcome insert error:", insErr);
      return new Response(JSON.stringify({ error: insErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, deduped: !!insErr }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("notify-link-origin-welcome error:", e);
    return new Response(JSON.stringify({ error: e?.message || "internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
