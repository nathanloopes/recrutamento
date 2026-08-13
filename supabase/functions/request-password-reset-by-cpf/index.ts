// Reset de senha por CPF sem expor o e-mail ao cliente anônimo.
// Recebe { cpf, email, captchaToken? }. Resolve o e-mail cadastrado
// server-side, compara com o informado e — se bater — dispara o
// resetPasswordForEmail via admin. Sempre responde { ok: true } para não
// virar oráculo de correspondência CPF↔e-mail.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

interface Body {
  cpf?: string;
  email?: string;
  captchaToken?: string;
  redirectTo?: string;
}

function getClientIp(req: Request): string | null {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const xr = req.headers.get("x-real-ip");
  return xr ? xr.trim() : null;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const cpf = String(body.cpf || "").replace(/\D/g, "");
    const email = String(body.email || "").trim().toLowerCase();
    const captchaToken = body.captchaToken;
    const redirectTo = String(body.redirectTo || "");

    if (cpf.length !== 11 || !email.includes("@")) {
      // Ainda assim, respondemos genérico para não vazar formato.
      return jsonResponse({ ok: true });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    // Rate limit (fail-open). Só usa cf/xff.
    try {
      const ip = getClientIp(req);
      const cpfRes = await admin.rpc("rl_hit", {
        _bucket: "pwd_reset_cpf_cpf", _identifier: cpf, _limit: 5, _window_seconds: 3600,
      });
      const ipRes = ip
        ? await admin.rpc("rl_hit", {
            _bucket: "pwd_reset_cpf_ip", _identifier: ip, _limit: 20, _window_seconds: 3600,
          })
        : { data: true };
      if (cpfRes.data === false || ipRes.data === false) {
        // Mesma resposta genérica — não sinaliza correspondência.
        return jsonResponse({ ok: true });
      }
    } catch (_e) { /* fail-open */ }

    const { data: candRow } = await admin
      .from("candidates")
      .select("id, is_active, email, candidate_profiles(email)")
      .eq("cpf", cpf)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!candRow || (candRow as any).is_active === false) {
      return jsonResponse({ ok: true });
    }

    const profileEmail = Array.isArray((candRow as any).candidate_profiles)
      ? (candRow as any).candidate_profiles[0]?.email
      : (candRow as any).candidate_profiles?.email;
    const registered = String(profileEmail || (candRow as any).email || "").trim().toLowerCase();
    if (!registered || registered !== email) {
      return jsonResponse({ ok: true });
    }

    try {
      // Usa o cliente admin: dispara o e-mail sem depender da sessão do cliente.
      await admin.auth.resetPasswordForEmail(email, {
        redirectTo: redirectTo || undefined,
        ...(captchaToken ? ({ captchaToken } as any) : {}),
      });
    } catch (err: any) {
      console.warn("[request-password-reset-by-cpf] resetPasswordForEmail warn:", err?.message);
    }

    return jsonResponse({ ok: true });
  } catch (err: any) {
    console.error("[request-password-reset-by-cpf] error:", err?.message);
    // Nunca revela — sempre ok.
    return jsonResponse({ ok: true });
  }
});
