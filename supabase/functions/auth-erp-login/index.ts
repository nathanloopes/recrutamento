import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const INVALID_CREDENTIALS_MESSAGE = "Credenciais inválidas.";

function normalizeEmail(email?: string) {
  return String(email || "").trim().toLowerCase();
}

function normalizeCpf(cpf?: string) {
  return String(cpf || "").replace(/\D/g, "");
}

function getRequestIp(req: Request) {
  const forwardedFor = String(req.headers.get("x-forwarded-for") || "").split(",")[0]?.trim();
  return forwardedFor
    || String(req.headers.get("x-real-ip") || "").trim()
    || String(req.headers.get("cf-connecting-ip") || "").trim()
    || "unknown";
}

async function sha256Hex(value: string) {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buffer)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function maskIdentifier(cpf?: string, email?: string) {
  const cleanCpf = normalizeCpf(cpf);
  if (cleanCpf) {
    return `cpf:${cleanCpf.slice(-4).padStart(cleanCpf.length, "*")}`;
  }

  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail.includes("@")) return "unknown";

  const [localPart, domain] = normalizedEmail.split("@");
  return `email:${localPart.slice(0, 2)}***@${domain}`;
}

async function applySoftThrottle(supabase: any, req: Request, cpf?: string, email?: string) {
  const requestIp = getRequestIp(req);
  const ipHash = await sha256Hex(`${requestIp}:auth-erp-login`);
  const identifierHash = await sha256Hex(`${normalizeCpf(cpf) || normalizeEmail(email) || "unknown"}:auth-erp-login`);

  const { data: existingRow } = await supabase
    .from("auth_erp_login_throttle")
    .select("bucket_start, requests")
    .eq("ip_hash", ipHash)
    .maybeSingle();

  const nowIso = new Date().toISOString();
  let requestCount = 1;

  if (existingRow && new Date(existingRow.bucket_start).getTime() > Date.now() - 60_000) {
    requestCount = existingRow.requests + 1;

    await supabase
      .from("auth_erp_login_throttle")
      .update({
        requests: requestCount,
        last_seen_at: nowIso,
        last_identifier_hash: identifierHash,
      })
      .eq("ip_hash", ipHash);
  } else {
    await supabase
      .from("auth_erp_login_throttle")
      .upsert({
        ip_hash: ipHash,
        bucket_start: nowIso,
        requests: 1,
        last_seen_at: nowIso,
        last_identifier_hash: identifierHash,
      }, {
        onConflict: "ip_hash",
      });
  }

  const delayMs = requestCount > 40
    ? 2200 + Math.floor(Math.random() * 500)
    : requestCount > 20
      ? 900 + Math.floor(Math.random() * 300)
      : requestCount > 8
        ? 250 + Math.floor(Math.random() * 150)
        : 120 + Math.floor(Math.random() * 80);

  await new Promise((resolve) => setTimeout(resolve, delayMs));

  return { ipHash, requestCount };
}

async function logFailedAttempt(
  supabase: any,
  details: { cpf?: string; email?: string; ipHash: string; requestCount: number; reason: string },
) {
  await supabase.from("activity_logs").insert({
    user_id: null,
    action: "erp_delegated_login_failed",
    module: "auth",
    details: {
      identifier: maskIdentifier(details.cpf, details.email),
      ip_hash: details.ipHash,
      request_count: details.requestCount,
      reason: details.reason,
      source: "auth-erp-login",
    },
  });
}

async function resolveLocalUserId(supabase: any, cpf: string, email: string) {
  if (cpf) {
    const { data } = await supabase
      .from("profiles")
      .select("id")
      .eq("cpf", cpf)
      .maybeSingle();
    if (data?.id) return data.id as string;
  }

  const { data } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  return data?.id || null;
}

/** Safe role assignment: check-then-insert instead of invalid upsert */
async function safeAssignRole(
  supabase: any,
  userId: string,
  role: string,
  scopeAccess: string,
  unitId?: string | null,
) {
  const query = supabase
    .from("user_roles")
    .select("id")
    .eq("user_id", userId)
    .eq("role", role);

  if (unitId) {
    query.eq("unit_id", unitId);
  } else {
    query.is("unit_id", null);
  }

  const { data: existing } = await query.maybeSingle();
  if (existing) return; // already has this role

  const insert: Record<string, unknown> = {
    user_id: userId,
    role,
    scope_access: scopeAccess,
  };
  if (unitId) insert.unit_id = unitId;

  await supabase.from("user_roles").insert(insert).select();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const cpf = normalizeCpf(body.cpf);
    const email = normalizeEmail(body.email);
    const password = String(body.password || "");

    if (!password || (!cpf && !email)) {
      return new Response(
        JSON.stringify({ error: "CPF/email e senha são obrigatórios." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 1. Validar credenciais no ERP ──────────────────────────
    const erpUrl = Deno.env.get("ERP_BASE_URL")!;
    const erpServiceKey = Deno.env.get("ERP_SERVICE_ROLE_KEY")!;

    if (!erpUrl || !erpServiceKey) {
      return new Response(
        JSON.stringify({ error: "Configuração ERP ausente no servidor." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const erp = createClient(erpUrl, erpServiceKey);
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);
    const throttle = await applySoftThrottle(supabase, req, cpf, email);

    if (throttle.requestCount > 75) {
      await logFailedAttempt(supabase, {
        cpf,
        email,
        ipHash: throttle.ipHash,
        requestCount: throttle.requestCount,
        reason: "rate_limited",
      });

      return new Response(
        JSON.stringify({ error: "Muitas tentativas. Tente novamente em instantes." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Encontrar o email do usuário no ERP (pode vir só CPF do frontend)
    let erpEmail = email;
    let erpProfile: { id: string; full_name: string; email: string; cpf: string; phone: string } | null = null;

    if (cpf) {
      const { data: profile } = await erp
        .from("profiles")
        .select("id, full_name, email, cpf, phone")
        .eq("cpf", cpf)
        .maybeSingle();

      if (!profile) {
        await logFailedAttempt(supabase, {
          cpf,
          email,
          ipHash: throttle.ipHash,
          requestCount: throttle.requestCount,
          reason: "profile_not_found",
        });
        return new Response(
          JSON.stringify({ error: INVALID_CREDENTIALS_MESSAGE, fallback_to_local_auth: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      erpEmail = profile.email;
      erpProfile = profile;
    } else if (email) {
      const { data: profile } = await erp
        .from("profiles")
        .select("id, full_name, email, cpf, phone")
        .eq("email", email)
        .maybeSingle();

      erpProfile = profile;
    }

    if (!erpEmail) {
      await logFailedAttempt(supabase, {
        cpf,
        email,
        ipHash: throttle.ipHash,
        requestCount: throttle.requestCount,
        reason: "missing_email",
      });
      return new Response(
        JSON.stringify({ error: INVALID_CREDENTIALS_MESSAGE, fallback_to_local_auth: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Autenticar contra o Supabase do ERP
    const { error: loginError } = await erp.auth.signInWithPassword({
      email: erpEmail,
      password,
    });

    if (loginError) {
      await logFailedAttempt(supabase, {
        cpf,
        email: erpEmail,
        ipHash: throttle.ipHash,
        requestCount: throttle.requestCount,
        reason: "invalid_password",
      });
      return new Response(
        JSON.stringify({ error: INVALID_CREDENTIALS_MESSAGE, fallback_to_local_auth: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 2. Garantir shadow account local ───────────────────────────
    if (!erpProfile) {
      const { data: profile } = await erp
        .from("profiles")
        .select("id, full_name, email, cpf, phone")
        .eq("email", erpEmail)
        .maybeSingle();
      erpProfile = profile;
    }

    const cleanCpf = (erpProfile?.cpf || cpf || "").replace(/\D/g, "");

    let localUserId = await resolveLocalUserId(supabase, cleanCpf, erpEmail);

    if (!localUserId) {
      const shadowPassword = crypto.randomUUID() + crypto.randomUUID();

      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email: erpEmail,
        password: shadowPassword,
        email_confirm: true,
        user_metadata: {
          full_name: erpProfile?.full_name || "",
          cpf: cleanCpf,
          phone: erpProfile?.phone || "",
          origin: "erp_delegated_login",
        },
      });

      if (createError) {
        if ((createError.message || "").match(/already been registered|already exists/i)) {
          localUserId = await resolveLocalUserId(supabase, cleanCpf, erpEmail);
        }

        if (!localUserId) {
          console.error("[auth-erp-login] Erro ao criar shadow account:", createError);
          return new Response(
            JSON.stringify({ error: "Erro ao provisionar conta local." }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      if (!localUserId) {
        localUserId = newUser?.user?.id || null;
      }

      // Update profile with ERP data
      await supabase.from("profiles").update({
        full_name: erpProfile?.full_name || "",
        cpf: cleanCpf || null,
        phone: erpProfile?.phone || null,
      }).eq("id", localUserId);

      // Mirror ERP roles using safe assignment (with unit_id resolution)
      const { data: erpRoles } = await erp
        .from("user_roles")
        .select("role, unit_id")
        .eq("user_id", erpProfile?.id || "");

      if (erpRoles?.length) {
        const roleMappings: Record<string, string> = {
          admin: "admin",
          franqueado: "franqueado",
          rh_franqueadora: "rh_franqueadora",
          gestor_recrutamento: "gestor_recrutamento",
        };

        for (const gr of erpRoles) {
          const localRole = roleMappings[gr.role];
          if (!localRole) continue;

          let localUnitId: string | null = null;

          // Resolve unit_id for unit-scoped roles
          if (gr.unit_id && ["franqueado", "gestor_recrutamento"].includes(localRole)) {
            const { data: gnUnit } = await erp
              .from("units")
              .select("code")
              .eq("id", gr.unit_id)
              .maybeSingle();

            if (gnUnit?.code) {
              const { data: localUnit } = await supabase
                .from("units")
                .select("id")
                .eq("code", gnUnit.code)
                .maybeSingle();

              localUnitId = localUnit?.id || null;
            }
          }

          const scopeAccess = localUnitId ? "unit" : "global";
          await safeAssignRole(supabase, localUserId!, localRole, scopeAccess, localUnitId);
        }
      }

      // Log
      await supabase.from("activity_logs").insert({
        user_id: localUserId,
        action: "erp_delegated_login_new_account",
        module: "auth",
        details: {
          cpf: cleanCpf,
          email: erpEmail,
          source: "auth-erp-login",
        },
      });
    }

    // ── 3. Gerar sessão Supabase SEM senha ─────────────────────────
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email: erpEmail,
    });

    if (linkError || !linkData) {
      console.error("[auth-erp-login] Erro ao gerar link:", linkError);
      return new Response(
        JSON.stringify({ error: "Erro ao criar sessão." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: sessionData, error: otpError } = await supabase.auth.verifyOtp({
      token_hash: linkData.properties.hashed_token,
      type: "magiclink",
    });

    if (otpError || !sessionData?.session) {
      console.error("[auth-erp-login] Erro ao verificar OTP:", otpError);
      return new Response(
        JSON.stringify({ error: "Erro ao estabelecer sessão." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log de login bem-sucedido
    await supabase.from("activity_logs").insert({
      user_id: localUserId,
      action: "erp_delegated_login",
      module: "auth",
      details: {
        cpf: cleanCpf,
        email: erpEmail,
        ip_hash: throttle.ipHash,
        request_count: throttle.requestCount,
        source: "auth-erp-login",
      },
    });

    // ── 4. Retornar sessão ao frontend ─────────────────────────────
    return new Response(
      JSON.stringify({
        session: {
          access_token: sessionData.session.access_token,
          refresh_token: sessionData.session.refresh_token,
          expires_in: sessionData.session.expires_in,
          expires_at: sessionData.session.expires_at,
          token_type: sessionData.session.token_type,
        },
        user: sessionData.session.user,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[auth-erp-login] Erro inesperado:", err);
    return new Response(
      JSON.stringify({ error: "Erro interno do servidor." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
