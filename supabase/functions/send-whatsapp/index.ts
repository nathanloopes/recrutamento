import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { withAuth } from "../_shared/with-auth.ts";
import { notificationsEnabled } from "../_shared/config-guard.ts";

// WhatsApp Cloud API (Meta) — substitui Z-API.
// Mantém a mesma interface: { phone, message, notification_id, dry_run }
// Opcional: { template_name, template_language, template_components } para mensagens fora da janela de 24h.

const GRAPH_VERSION = "v21.0";

Deno.serve(withAuth(async (req) => {
  try {
    if (!(await notificationsEnabled())) {
      return new Response(
        JSON.stringify({ delivered: false, blocked: "kill_switch", reason: "notifications_enabled is false" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const PHONE_NUMBER_ID = (Deno.env.get("META_WA_PHONE_NUMBER_ID") || "").trim();
    const ACCESS_TOKEN = (Deno.env.get("META_WA_ACCESS_TOKEN") || "").trim();

    const mask = (v: string) => v ? `${v.slice(0, 4)}…${v.slice(-4)} (len=${v.length})` : "MISSING";
    console.log("Meta WA config:", { phone_number_id: mask(PHONE_NUMBER_ID), token: mask(ACCESS_TOKEN) });

    if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
      return new Response(
        JSON.stringify({
          success: false,
          reason: "meta_wa_not_configured",
          error: "Credenciais Meta ausentes (META_WA_PHONE_NUMBER_ID, META_WA_ACCESS_TOKEN).",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const {
      phone,
      message,
      notification_id,
      dry_run,
      template_name,
      template_language = "pt_BR",
      template_components,
    } = body || {};

    if (dry_run) {
      return new Response(
        JSON.stringify({ success: true, dry_run: true, provider: "meta_cloud" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!phone || (!message && !template_name)) {
      return new Response(
        JSON.stringify({ error: "phone and (message or template_name) are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Normaliza telefone: 55 + DDD + número
    const cleanPhone = String(phone).replace(/\D/g, "");
    const formattedPhone = cleanPhone.startsWith("55") ? cleanPhone : `55${cleanPhone}`;
    if (!/^55[1-9]\d{9,10}$/.test(formattedPhone)) {
      return new Response(
        JSON.stringify({ error: "Invalid phone number format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Monta payload Meta
    let payload: Record<string, any>;
    if (template_name) {
      payload = {
        messaging_product: "whatsapp",
        to: formattedPhone,
        type: "template",
        template: {
          name: template_name,
          language: { code: template_language },
          ...(template_components ? { components: template_components } : {}),
        },
      };
    } else {
      payload = {
        messaging_product: "whatsapp",
        to: formattedPhone,
        type: "text",
        text: { preview_url: false, body: String(message).slice(0, 4096) },
      };
    }

    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;
    const metaResponse = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const rawText = await metaResponse.text();
    let metaResult: any;
    try { metaResult = JSON.parse(rawText); } catch { metaResult = { raw: rawText }; }

    const messageId = metaResult?.messages?.[0]?.id;
    const delivered = metaResponse.ok && !!messageId;
    console.log("Meta WA response:", { status: metaResponse.status, body: metaResult });

    if (notification_id) {
      await supabase.from("delivery_logs").insert({
        notification_id,
        channel: "whatsapp",
        delivered,
        provider_response: metaResult,
      });
      await supabase
        .from("notifications")
        .update({ status: delivered ? "sent" : "failed" })
        .eq("id", notification_id);
    }

    if (!delivered) {
      const err = metaResult?.error || {};
      const errCode = err.code;
      const errSub = err.error_subcode;
      const errMsg = String(err.message || "").toLowerCase();

      let reason = "meta_wa_delivery_failed";
      let friendly = err.message || "Falha ao entregar mensagem via Meta Cloud API.";

      if (errCode === 190 || errMsg.includes("access token")) {
        reason = "meta_wa_token_invalid";
        friendly = "Token Meta inválido ou expirado. Atualize META_WA_ACCESS_TOKEN.";
      } else if (errCode === 100 && errMsg.includes("phone")) {
        reason = "meta_wa_phone_invalid";
        friendly = "Phone Number ID inválido. Verifique META_WA_PHONE_NUMBER_ID.";
      } else if (errCode === 131047 || errMsg.includes("24") || errMsg.includes("re-engagement")) {
        reason = "meta_wa_outside_window";
        friendly = "Janela de 24h expirada. Use um template aprovado (template_name) para reabrir a conversa.";
      } else if (errCode === 132000 || errMsg.includes("template")) {
        reason = "meta_wa_template_error";
        friendly = "Erro no template: nome/idioma/parâmetros inválidos ou template não aprovado.";
      } else if (errCode === 131026) {
        reason = "meta_wa_undeliverable";
        friendly = "Número não tem WhatsApp ou não pôde receber a mensagem.";
      }

      return new Response(
        JSON.stringify({ success: false, reason, error: friendly, provider_response: metaResult, error_code: errCode, error_subcode: errSub }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, messageId, provider: "meta_cloud" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("send-whatsapp error:", err);
    return new Response(
      JSON.stringify({ error: "An error occurred. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}, { allowedRoles: ["admin", "rh_franqueadora"] }));
