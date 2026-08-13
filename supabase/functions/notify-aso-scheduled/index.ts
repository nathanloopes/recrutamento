import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

function formatDateBR(ymd: string | null) {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const authHeader = req.headers.get("Authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  let authorized = !!bearer && bearer === SERVICE_ROLE;
  if (!authorized && bearer && bearer !== anonKey) {
    const userClient = createClient(SUPABASE_URL, anonKey, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
    });
    const { data, error } = await userClient.auth.getUser();
    authorized = !!data?.user && !error;
  }
  if (!authorized) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { applicationId } = await req.json();
    if (!applicationId) {
      return new Response(
        JSON.stringify({ error: "applicationId required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const { data: aso } = await supabase
      .from("application_aso")
      .select(
        "id, candidate_id, address, scheduled_date, scheduled_time, status",
      )
      .eq("application_id", applicationId)
      .maybeSingle();

    if (!aso || !aso.candidate_id) {
      return new Response(JSON.stringify({ ok: false, reason: "no aso" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const dateStr = formatDateBR(aso.scheduled_date);
    const timeStr = (aso.scheduled_time || "").slice(0, 5);

    const title = "Exame admissional agendado 🩺";
    const body =
      `Seu ASO foi agendado para ${dateStr} às ${timeStr}.` +
      (aso.address ? ` Local: ${aso.address}` : "");

    await supabase.from("notifications").insert({
      event_type: "aso_scheduled",
      recipient_id: aso.candidate_id,
      channel: "push",
      title,
      body,
      status: "pending",
      action_url: `/documentos/${applicationId}`,
      action_type: "action_required",
      payload: {
        application_id: applicationId,
        aso_id: aso.id,
        address: aso.address,
        scheduled_date: aso.scheduled_date,
        scheduled_time: aso.scheduled_time,
      },
    } as any);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("notify-aso-scheduled error:", e);
    return new Response(
      JSON.stringify({ error: e?.message || "internal error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
