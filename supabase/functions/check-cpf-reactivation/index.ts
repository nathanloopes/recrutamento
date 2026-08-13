// Reativa contas previamente desativadas (self_deactivated) quando o mesmo CPF
// se cadastra novamente. Atualiza email/senha em auth.users e dados em
// candidate_profiles. Retorna { reactivated: true, userId, email } quando bem
// sucedido; { reactivated: false } caso contrário.
//
// IMPORTANTE: função pública (sem JWT do usuário) porque é chamada antes do
// signUp. Não vaza dados — só retorna se houve reativação.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

interface Body {
  cpf?: string;
  email?: string;
  password?: string;
  profile?: {
    full_name?: string;
    phone?: string;
    cep?: string;
    city?: string;
    state?: string;
    birth_date?: string;
    gender?: string;
    address_json?: Record<string, unknown>;
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as Body;
    const cpf = (body.cpf || "").replace(/\D/g, "");
    const email = (body.email || "").trim().toLowerCase();
    const password = body.password || "";

    if (cpf.length !== 11 || !email || !password) {
      return new Response(JSON.stringify({ reactivated: false, error: "invalid_input" }), {
        status: 400, headers: corsHeaders,
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    // Rate limiting anti-brute force (por CPF e por IP). Fail-open.
    try {
      const cf = req.headers.get("cf-connecting-ip");
      const xff = req.headers.get("x-forwarded-for");
      const ip = (cf || xff?.split(",")[0] || req.headers.get("x-real-ip") || "").trim() || null;
      const cpfRes = await admin.rpc("rl_hit", { _bucket: "cpf_reactivation_cpf", _identifier: cpf, _limit: 5, _window_seconds: 3600 });
      const ipRes = ip
        ? await admin.rpc("rl_hit", { _bucket: "cpf_reactivation_ip", _identifier: ip, _limit: 15, _window_seconds: 3600 })
        : { data: true };
      if (cpfRes.data === false || ipRes.data === false) {
        return new Response(JSON.stringify({ reactivated: false, error: "rate_limited" }), {
          status: 200, headers: corsHeaders,
        });
      }
    } catch (_e) { /* fail-open */ }

    // Busca candidate por CPF
    const { data: cand, error: candErr } = await admin
      .from("candidates")
      .select("id, is_active, user_status, status_reason")
      .eq("cpf", cpf)
      .maybeSingle();

    if (candErr) {
      console.error("[check-cpf-reactivation] lookup error:", candErr.message);
      return new Response(JSON.stringify({ reactivated: false }), { status: 200, headers: corsHeaders });
    }

    if (!cand) {
      return new Response(JSON.stringify({ reactivated: false }), { status: 200, headers: corsHeaders });
    }

    if (cand.is_active !== false) {
      // Conta ativa: deixar o signUp normal seguir e retornar "já cadastrado".
      return new Response(JSON.stringify({ reactivated: false, already_active: true }), {
        status: 200, headers: corsHeaders,
      });
    }

    const userId = cand.id;

    // ── Segurança (anti-takeover) ──────────────────────────────────────
    // Só reativa se o e-mail informado for EXATAMENTE o mesmo e-mail original
    // da conta. Impede que alguém que conheça apenas o CPF (semipúblico) assuma
    // uma conta desativada definindo um novo e-mail/senha. O soft-delete mantém
    // o e-mail original em auth.users, então a correspondência é confiável.
    const { data: userInfo, error: getUserErr } = await admin.auth.admin.getUserById(userId);
    if (getUserErr || !userInfo?.user) {
      console.error("[check-cpf-reactivation] getUserById error:", getUserErr?.message);
      return new Response(JSON.stringify({ reactivated: false }), { status: 200, headers: corsHeaders });
    }
    const originalEmail = (userInfo.user.email || "").trim().toLowerCase();
    if (!originalEmail || originalEmail !== email) {
      console.warn("[check-cpf-reactivation] email mismatch — reactivation denied");
      return new Response(JSON.stringify({ reactivated: false, error: "email_mismatch" }), {
        status: 200, headers: corsHeaders,
      });
    }

    // Atualiza auth.users (email + senha) — confirma email para login imediato.
    const { error: authUpdErr } = await admin.auth.admin.updateUserById(userId, {
      email,
      password,
      email_confirm: true,
      user_metadata: {
        cpf,
        full_name: body.profile?.full_name,
        phone: body.profile?.phone,
        cep: body.profile?.cep,
        city: body.profile?.city,
        state: body.profile?.state,
        birth_date: body.profile?.birth_date,
        gender: body.profile?.gender,
        status: "registered",
      },
    });

    if (authUpdErr) {
      console.error("[check-cpf-reactivation] auth update error:", authUpdErr.message);
      return new Response(JSON.stringify({ reactivated: false, error: "auth_update_failed", detail: authUpdErr.message }), {
        status: 500, headers: corsHeaders,
      });
    }

    // Reativa candidate
    const { error: actErr } = await admin
      .from("candidates")
      .update({
        is_active: true,
        user_status: "ativo",
        status_reason: "reactivated_by_signup",
        status_changed_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (actErr) {
      console.error("[check-cpf-reactivation] reactivate error:", actErr.message);
      return new Response(JSON.stringify({ reactivated: false, error: "reactivate_failed", detail: actErr.message }), {
        status: 500, headers: corsHeaders,
      });
    }

    // Atualiza candidate_profiles com os dados novos do formulário
    const p = body.profile || {};
    const profilePayload: Record<string, unknown> = {
      full_name: p.full_name ?? undefined,
      email,
      phone: p.phone ?? undefined,
      cep: p.cep ?? undefined,
      city: p.city ?? undefined,
      state: p.state ?? undefined,
      birth_date: p.birth_date ?? undefined,
      gender: p.gender ?? undefined,
      address_json: p.address_json ?? undefined,
    };
    // remove undefined
    for (const k of Object.keys(profilePayload)) {
      if (profilePayload[k] === undefined) delete profilePayload[k];
    }

    if (Object.keys(profilePayload).length > 0) {
      const { error: cpErr } = await admin
        .from("candidate_profiles")
        .update(profilePayload as any)
        .eq("candidate_id", userId);
      if (cpErr) console.warn("[check-cpf-reactivation] candidate_profiles update warn:", cpErr.message);
    }

    // Log
    try {
      await admin.from("activity_logs").insert({
        user_id: userId,
        action: "account_reactivated_by_signup",
        entity_type: "candidate",
        entity_id: userId,
        metadata: { new_email: email },
      } as any);
    } catch (e: any) {
      console.warn("[check-cpf-reactivation] activity_logs warn:", e?.message);
    }

    console.log(`[check-cpf-reactivation] reactivated user=${userId} cpf=***${cpf.slice(-4)}`);
    return new Response(JSON.stringify({ reactivated: true, userId, email }), {
      status: 200, headers: corsHeaders,
    });
  } catch (error: any) {
    console.error("[check-cpf-reactivation] error:", error);
    return new Response(JSON.stringify({ reactivated: false, error: error?.message || "internal_error" }), {
      status: 500, headers: corsHeaders,
    });
  }
});
