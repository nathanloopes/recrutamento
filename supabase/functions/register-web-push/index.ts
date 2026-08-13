import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
    const p256dh = typeof body?.keys?.p256dh === "string" ? body.keys.p256dh : "";
    const auth = typeof body?.keys?.auth === "string" ? body.keys.auth : "";
    const user_agent = typeof body?.user_agent === "string" ? body.user_agent.slice(0, 500) : null;

    if (!endpoint || !p256dh || !auth) {
      return new Response(
        JSON.stringify({ error: "endpoint, keys.p256dh and keys.auth are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // Regra "1 device token = 1 usuário ativo":
    // Antes do upsert, desativar QUALQUER outro registro com o mesmo endpoint
    // que pertença a outro user_id. Isso evita que notificações continuem indo
    // para o usuário antigo após troca de login no mesmo dispositivo.
    const { error: dedupError } = await admin
      .from("push_tokens")
      .update({ is_active: false })
      .eq("endpoint", endpoint)
      .neq("user_id", user.id);

    if (dedupError) {
      console.warn("[register-web-push] dedup error (continuing):", dedupError);
    }

    // Upsert por endpoint (índice único)
    const { error: upsertError } = await admin
      .from("push_tokens")
      .upsert(
        {
          user_id: user.id,
          endpoint,
          p256dh,
          auth,
          is_active: true,
          user_agent,
        },
        { onConflict: "endpoint" },
      );

    if (upsertError) {
      console.error("[register-web-push] upsert error:", upsertError);
      return new Response(JSON.stringify({ error: "db_error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[register-web-push] error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
