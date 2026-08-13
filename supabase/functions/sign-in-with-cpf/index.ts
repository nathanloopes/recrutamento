// Login por CPF sem expor o e-mail ao cliente anônimo.
// Recebe { cpf, password, captchaToken? }, resolve o e-mail server-side
// (service role), tenta primeiro a delegação ERP e cai no
// signInWithPassword do Supabase Auth se necessário. Devolve
// { session: { access_token, refresh_token } } ou um erro genérico.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

interface Body {
  cpf?: string;
  password?: string;
  captchaToken?: string;
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
    const password = String(body.password || "");
    const captchaToken = body.captchaToken;

    if (cpf.length !== 11 || password.length < 6) {
      return jsonResponse({ error: "invalid_input" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    // Rate limit por CPF e IP (anti-bruteforce). Fail-open.
    try {
      const ip = getClientIp(req);
      const cpfRes = await admin.rpc("rl_hit", {
        _bucket: "sign_in_cpf_cpf", _identifier: cpf, _limit: 10, _window_seconds: 900,
      });
      const ipRes = ip
        ? await admin.rpc("rl_hit", {
            _bucket: "sign_in_cpf_ip", _identifier: ip, _limit: 60, _window_seconds: 900,
          })
        : { data: true };
      if (cpfRes.data === false || ipRes.data === false) {
        return jsonResponse({ error: "rate_limited" }, 429);
      }
    } catch (_e) { /* fail-open */ }

    // Resolve e-mail server-side (não retorna ao cliente).
    const { data: candRow } = await admin
      .from("candidates")
      .select("id, is_active, email, candidate_profiles(email)")
      .eq("cpf", cpf)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!candRow) {
      return jsonResponse({ error: "invalid_credentials" }, 401);
    }
    if (candRow.is_active === false) {
      return jsonResponse({ error: "account_deactivated" }, 403);
    }

    const profileEmail = Array.isArray((candRow as any).candidate_profiles)
      ? (candRow as any).candidate_profiles[0]?.email
      : (candRow as any).candidate_profiles?.email;
    const email = String(profileEmail || (candRow as any).email || "").trim().toLowerCase();
    if (!email) {
      return jsonResponse({ error: "invalid_credentials" }, 401);
    }

    // 1) Tenta delegação ERP (best-effort). Usa a função interna existente.
    try {
      const gnRes = await fetch(`${supabaseUrl}/functions/v1/auth-erp-login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
        },
        body: JSON.stringify({ cpf, email, password }),
      });
      if (gnRes.ok) {
        const payload = await gnRes.json().catch(() => null);
        if (payload?.session?.access_token && payload?.session?.refresh_token) {
          return jsonResponse({
            session: {
              access_token: payload.session.access_token,
              refresh_token: payload.session.refresh_token,
            },
            path: "erp",
          });
        }
      } else if (gnRes.status === 429) {
        return jsonResponse({ error: "rate_limited" }, 429);
      }
      // 401/outros: cai para o fallback Supabase Auth.
    } catch (_e) { /* fallback */ }

    // 2) Fallback: signInWithPassword direto.
    const anon = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await anon.auth.signInWithPassword({
      email,
      password,
      options: captchaToken ? { captchaToken } : undefined,
    });

    if (error || !data?.session) {
      // Contador server-side de falhas (mesmo RPC usado pela UI antes).
      let currentFails = 0;
      try {
        const rl = await admin.rpc("record_failed_login" as any, { _email: email });
        currentFails = Number((rl as any).data ?? 0);
      } catch (_e) { /* opcional */ }

      let maxAttempts = 5;
      try {
        const { data: setting } = await admin
          .from("global_settings")
          .select("value")
          .eq("category", "security")
          .eq("key", "max_login_attempts")
          .maybeSingle();
        const parsed = parseInt(String((setting as any)?.value ?? "5"), 10);
        if (Number.isFinite(parsed) && parsed > 0) maxAttempts = parsed;
      } catch (_e) { /* opcional */ }

      const locked = currentFails >= maxAttempts;
      return jsonResponse({
        error: locked ? "locked" : "invalid_credentials",
        attempts: currentFails,
        max_attempts: maxAttempts,
      }, locked ? 423 : 401);
    }

    return jsonResponse({
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      },
      path: "supabase",
    });
  } catch (err: any) {
    console.error("[sign-in-with-cpf] error:", err?.message);
    return jsonResponse({ error: "internal_error" }, 500);
  }
});
