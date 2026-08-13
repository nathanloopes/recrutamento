import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { withAuth } from "../_shared/with-auth.ts";

Deno.serve(withAuth(async (req) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { provider, payload, integration_id } = await req.json();

    // Helper to log and update status
    const logResult = async (success: boolean, event: string, context: Record<string, any>) => {
      if (integration_id) {
        await supabase.from("integration_logs").insert({
          integration_id,
          event,
          success,
          context,
        });
        await supabase.from("integration_settings").update({
          status: success ? "connected" : "error",
          last_health_check: new Date().toISOString(),
        }).eq("id", integration_id);
      }
    };

    if (provider === "zapi") {
      const ZAPI_INSTANCE_ID = Deno.env.get("ZAPI_INSTANCE_ID");
      const ZAPI_TOKEN = Deno.env.get("ZAPI_TOKEN");
      const ZAPI_SECURITY_TOKEN = Deno.env.get("ZAPI_SECURITY_TOKEN");

      if (!ZAPI_INSTANCE_ID || !ZAPI_TOKEN || !ZAPI_SECURITY_TOKEN) {
        await logResult(false, "status_check", { error: "Credentials not configured" });
        return new Response(
          JSON.stringify({ success: false, error: "Z-API credentials not configured" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (payload?.send_message && payload?.phone) {
        const cleanPhone = payload.phone.replace(/\D/g, "");
        const formattedPhone = cleanPhone.startsWith("55") ? cleanPhone : `55${cleanPhone}`;
        const zapiUrl = `https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}/send-text`;

        const response = await fetch(zapiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Client-Token": ZAPI_SECURITY_TOKEN },
          body: JSON.stringify({
            phone: formattedPhone,
            message: payload.message || "🔧 Teste de integração Z-API - Recruta RH",
          }),
        });

        const result = await response.json();
        await logResult(response.ok, "send_test", { phone: formattedPhone, response: result });
        return new Response(
          JSON.stringify({ success: response.ok, provider: "zapi", action: "send_message", response: result }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const statusUrl = `https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}/status`;
      const response = await fetch(statusUrl, { headers: { "Client-Token": ZAPI_SECURITY_TOKEN } });
      const result = await response.json();
      await logResult(response.ok, "status_check", result);

      return new Response(
        JSON.stringify({ success: response.ok, provider: "zapi", action: "status_check", response: { connected: response.ok, status: result.connected ? "connected" : "disconnected" } }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (provider === "brevo") {
      const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY");
      if (!BREVO_API_KEY) {
        await logResult(false, "status_check", { error: "BREVO_API_KEY not configured" });
        return new Response(
          JSON.stringify({ success: false, error: "Brevo API key not configured" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (payload?.send_email && payload?.to_email) {
        const response = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            sender: { name: "Recruta - RH", email: "rh@example.com" },
            to: [{ email: payload.to_email, name: payload.to_name || payload.to_email }],
            subject: payload.subject || "🔧 Teste de integração Brevo",
            htmlContent: payload.html_content || "<h2>Teste de Integração</h2><p>Mensagem de teste do sistema Recruta RH.</p>",
          }),
        });
        const result = await response.json();
        await logResult(response.ok, "send_test", { to_email: payload.to_email, response: result });
        return new Response(
          JSON.stringify({ success: response.ok, provider: "brevo", action: "send_email", response: result }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const response = await fetch("https://api.brevo.com/v3/account", {
        headers: { "api-key": BREVO_API_KEY, Accept: "application/json" },
      });
      const result = await response.json();
      await logResult(response.ok, "status_check", {
        companyName: result.companyName, email: result.email, plan: result.plan,
      });
      return new Response(
        JSON.stringify({
          success: response.ok, provider: "brevo", action: "account_check",
          response: { connected: response.ok },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (provider === "openai") {
      const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
      if (!OPENAI_API_KEY) {
        await logResult(false, "status_check", { error: "OPENAI_API_KEY not configured" });
        return new Response(
          JSON.stringify({ success: false, error: "OpenAI API key not configured" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (payload?.test_completion) {
        const prompt = payload.prompt || "Responda em uma frase: O que faz um bom candidato?";
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: payload.model || "gpt-4o-mini",
            temperature: 0.7,
            max_tokens: 200,
            messages: [
              { role: "system", content: "Você é um assistente de RH da rede Recruta." },
              { role: "user", content: prompt },
            ],
          }),
        });
        const result = await response.json();
        await logResult(response.ok, "send_test", {
          model: result.model, usage: result.usage,
        });
        return new Response(
          JSON.stringify({
            success: response.ok, provider: "openai", action: "chat_completion",
            response: { content: result.choices?.[0]?.message?.content, model: result.model, usage: result.usage },
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const response = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      });
      const result = await response.json();
      const relevantModels = result.data
        ?.filter((m: any) => m.id.includes("gpt") || m.id.includes("whisper"))
        ?.map((m: any) => m.id)
        ?.sort() || [];

      await logResult(response.ok, "status_check", { models_count: relevantModels.length });
      return new Response(
        JSON.stringify({
          success: response.ok, provider: "openai", action: "models_check",
          response: { available: relevantModels.length > 0, models_count: relevantModels.length },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (provider === "google") {
      const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
      const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET");

      if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
        await logResult(false, "status_check", { error: "Google Calendar credentials not configured" });
        return new Response(
          JSON.stringify({ success: false, error: "Google Calendar credentials not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      await logResult(true, "status_check", { client_id_present: true, client_secret_present: true });
      return new Response(
        JSON.stringify({ success: true, provider: "google", action: "credentials_check", response: { configured: true } }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (provider === "supabase-storage") {
      const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets();
      const success = !bucketsError;
      await logResult(success, "status_check", {
        buckets_count: buckets?.length ?? 0,
        bucket_names: buckets?.map((b: any) => b.name) ?? [],
        error: bucketsError?.message,
      });
      return new Response(
        JSON.stringify({
          success,
          provider: "supabase-storage",
          action: "buckets_list",
          response: { buckets_count: buckets?.length ?? 0, bucket_names: buckets?.map((b: any) => b.name) ?? [] },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Invalid provider. Use: zapi, brevo, openai, google, supabase-storage" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("test-integrations error:", err);
    return new Response(
      JSON.stringify({ error: "An error occurred. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}, { allowedRoles: ["admin"] }));
