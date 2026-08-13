import { corsHeaders, createAdminClient } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createAdminClient();

    // Call the existing DB function that detects stalled onboardings
    const { data, error } = await supabase.rpc("detect_onboarding_abandonment");

    if (error) {
      console.error("[detect-stalled-onboardings] RPC error:", error.message);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: corsHeaders }
      );
    }

    console.log("[detect-stalled-onboardings] Result:", JSON.stringify(data));

    return new Response(
      JSON.stringify({ success: true, result: data }),
      { status: 200, headers: corsHeaders }
    );
  } catch (err) {
    console.error("[detect-stalled-onboardings] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Erro interno" }),
      { status: 500, headers: corsHeaders }
    );
  }
});
