import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  SENDER_EMAIL,
  SENDER_NAME,
  REPLY_TO_EMAIL,
  buildDeliverabilityHeaders,
  ensureFooterHtml,
  institutionalFooterText,
} from "../_shared/email-footer.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const allowedRedirectOrigins = new Set([
  "https://recrutamento.example.com",
  "http://localhost",
  "http://localhost:3000",
  "http://localhost:5173",
]);

function resolveAllowedOrigin(req: Request) {
  const requestOrigin = String(req.headers.get("origin") || "").trim();
  if (allowedRedirectOrigins.has(requestOrigin)) {
    return requestOrigin;
  }

  return "https://recrutamento.example.com";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email } = await req.json();

    if (!email || !email.includes("@")) {
      return new Response(
        JSON.stringify({ error: "E-mail inválido." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY");

    if (!BREVO_API_KEY) {
      console.error("BREVO_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "Serviço de e-mail não configurado." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const redirectOrigin = resolveAllowedOrigin(req);

    // Generate recovery link using admin API.
    // A duração é controlada pelo painel Auth (Email OTP Expiration).
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: "recovery",
      email,
      options: {
        redirectTo: `${redirectOrigin}/reset-password`,
      },
    });

    if (linkError) {
      console.error("generateLink error:", linkError);
      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // IMPORTANTE: SOMENTE `hashed_token` (token_hash) — nunca usamos action_link.
    // Motivo: o action_link passa por /verify do Supabase, que ESTABELECE SESSÃO
    // automaticamente; clientes de e-mail/antivírus fazem prefetch e consomem
    // o token antes do usuário clicar, gerando "link inválido/expirado".
    // Com token_hash, o token só é consumido quando /reset-password chama
    // verifyOtp explicitamente.
    const hashedToken = linkData?.properties?.hashed_token;

    if (!hashedToken) {
      console.error("send-reset-email: hashed_token ausente, abortando envio para evitar action_link contaminado.");
      // Resposta genérica de sucesso (anti-enumeração de e-mails).
      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const recoveryLink = `${redirectOrigin}/reset-password?token_hash=${encodeURIComponent(hashedToken)}&type=recovery`;
    console.log("send-reset-email: link gerado para origin", redirectOrigin, "(token omitido)");

    // Send email via Brevo
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #3D2B1F; font-size: 24px; margin: 0;">Recruta</h1>
          <p style="color: #3D2B1F99; font-size: 14px;">Recrutamento</p>
        </div>
        <div style="background: #FFFBEB; border-radius: 12px; padding: 30px; text-align: center;">
          <h2 style="color: #3D2B1F; font-size: 20px; margin-bottom: 16px;">Redefinição de Senha</h2>
          <p style="color: #3D2B1F99; font-size: 14px; line-height: 1.6; margin-bottom: 24px;">
            Recebemos uma solicitação para redefinir sua senha. Clique no botão abaixo para criar uma nova senha.
          </p>
          <a href="${recoveryLink}" 
             style="display: inline-block; background: #F59E0B; color: #FFFFFF; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
            Redefinir minha senha
          </a>
          <p style="color: #3D2B1FAA; font-size: 12px; margin-top: 24px; word-break: break-all;">
            Caso o botão não funcione, copie e cole este link no navegador:<br/>
            <span style="color:#3D2B1F;">${recoveryLink}</span>
          </p>
          <p style="color: #3D2B1FAA; font-size: 12px; margin-top: 16px;">
            Se você não solicitou essa alteração, ignore este e-mail. O link é de uso único e tem validade limitada.
          </p>
        </div>
        <p style="color: #3D2B1F66; font-size: 11px; text-align: center; margin-top: 20px;">
          © Recruta — Todos os direitos reservados
        </p>
      </div>
    `;

    const htmlWithFooter = ensureFooterHtml(htmlContent, email);
    const textContent = [
      "Redefinição de Senha — Recruta",
      "",
      "Recebemos uma solicitação para redefinir sua senha.",
      "Clique no link abaixo (ou cole no navegador) para criar uma nova senha:",
      recoveryLink,
      "",
      "Se você não solicitou essa alteração, ignore este e-mail. O link é de uso único e tem validade limitada.",
      institutionalFooterText(email),
    ].join("\n");

    const brevoResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": BREVO_API_KEY,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        sender: { name: SENDER_NAME, email: SENDER_EMAIL },
        replyTo: { email: REPLY_TO_EMAIL, name: SENDER_NAME },
        to: [{ email, name: email }],
        subject: "Redefinição de Senha — Recruta",
        htmlContent: htmlWithFooter,
        textContent,
        headers: buildDeliverabilityHeaders(email, `reset-${Date.now()}`),
      }),
    });

    const brevoResult = await brevoResponse.json().catch(() => ({}));

    console.log(
      "send-reset-email: brevo response status=", brevoResponse.status,
      "messageId=", brevoResult?.messageId ?? null,
      "code=", brevoResult?.code ?? null,
      "message=", brevoResult?.message ?? null,
      "recipient_domain=", email.split("@")[1],
      "sender=", SENDER_EMAIL,
    );

    if (!brevoResponse.ok) {
      console.error("Brevo error body:", JSON.stringify(brevoResult));
      return new Response(
        JSON.stringify({ error: "Erro ao enviar e-mail." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("send-reset-email error:", err);
    return new Response(
      JSON.stringify({ error: "Erro interno. Tente novamente." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
