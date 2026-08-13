import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Latência mínima uniforme (ms) — evita timing side-channel entre
// invalid_cpf (retorno local, ~1ms) e not_found (round-trip HubDev, ~600ms).
const MIN_LATENCY_MS = 550;

// Limites: candidato legítimo bate 1x por CPF. Valores agressivos.
const CPF_LIMIT_PER_HOUR = 3;
const IP_LIMIT_PER_HOUR = 30;

interface CpfResult {
  found: boolean;
  name?: string;
  birth_date?: string;
  error_type?: "invalid_cpf" | "not_found" | "provider_unavailable" | "missing_token" | "rate_limited";
}

function jsonResponse(data: CpfResult, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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
  if (xr) return xr.trim();
  return null;
}

// Rate limiting anti-harvesting. FAIL-CLOSED: se a infra estiver
// indisponível, devolvemos "rate_limited" (o usuário legítimo pode preencher
// o nome manualmente; um atacante não consegue enumerar).
async function checkRateLimit(
  admin: ReturnType<typeof createClient> | null,
  cleanCpf: string,
  ip: string | null,
): Promise<{ allowed: boolean; reason?: string }> {
  if (!admin) return { allowed: false, reason: "no_admin" };
  try {
    const cpfRes = await admin.rpc("rl_hit", {
      _bucket: "lookup_cpf_cpf",
      _identifier: cleanCpf,
      _limit: CPF_LIMIT_PER_HOUR,
      _window_seconds: 3600,
    });
    if (cpfRes.error) return { allowed: false, reason: "cpf_rpc_error" };
    if (cpfRes.data === false) return { allowed: false, reason: "cpf_limit" };

    if (ip) {
      const ipRes = await admin.rpc("rl_hit", {
        _bucket: "lookup_cpf_ip",
        _identifier: ip,
        _limit: IP_LIMIT_PER_HOUR,
        _window_seconds: 3600,
      });
      if (ipRes.error) return { allowed: false, reason: "ip_rpc_error" };
      if (ipRes.data === false) return { allowed: false, reason: "ip_limit" };
    }
    return { allowed: true };
  } catch (_e) {
    return { allowed: false, reason: "exception" };
  }
}

// Verificação Cloudflare Turnstile (opcional). Só é exigida quando o segredo
// TURNSTILE_SECRET_KEY estiver configurado no ambiente da função — mantém o
// fluxo compatível caso o CAPTCHA ainda não esteja ativado.
async function verifyTurnstile(token: string | undefined, ip: string | null): Promise<boolean> {
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY");
  if (!secret) return true; // feature-flag off
  if (!token || typeof token !== "string" || token.length < 10) return false;
  try {
    const form = new URLSearchParams();
    form.append("secret", secret);
    form.append("response", token);
    if (ip) form.append("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
    });
    if (!res.ok) return false;
    const data = await res.json().catch(() => ({}));
    return !!data.success;
  } catch {
    return false;
  }
}

async function sleep(ms: number) {
  if (ms <= 0) return;
  await new Promise((r) => setTimeout(r, ms));
}

async function normalizeLatency(startedAt: number) {
  const elapsed = Date.now() - startedAt;
  await sleep(MIN_LATENCY_MS - elapsed);
}

function auditLog(event: string, payload: Record<string, unknown>) {
  // Log estruturado (JSON) — indexável no Supabase Logs Explorer, serve
  // como trilha de auditoria imutável.
  try {
    console.log(JSON.stringify({ fn: "lookup-cpf", event, ts: new Date().toISOString(), ...payload }));
  } catch {
    console.log(`[lookup-cpf] ${event}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startedAt = Date.now();
  const ip = getClientIp(req);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const admin = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;

  try {
    const body = await req.json().catch(() => ({}));
    const { cpf, captchaToken } = body as { cpf?: unknown; captchaToken?: unknown };

    if (!cpf || typeof cpf !== "string" || cpf.replace(/\D/g, "").length !== 11) {
      auditLog("invalid_input", { ip });
      await normalizeLatency(startedAt);
      return jsonResponse({ found: false, error_type: "invalid_cpf" });
    }

    const cleanCpf = cpf.replace(/\D/g, "");
    const maskedCpf = `${cleanCpf.slice(0, 3)}***${cleanCpf.slice(-2)}`;

    // 1) CAPTCHA (se habilitado no ambiente)
    const captchaOk = await verifyTurnstile(
      typeof captchaToken === "string" ? captchaToken : undefined,
      ip,
    );
    if (!captchaOk) {
      auditLog("captcha_failed", { ip, cpf: maskedCpf });
      await normalizeLatency(startedAt);
      return jsonResponse({ found: false, error_type: "rate_limited" });
    }

    // 2) Rate limit (fail-closed)
    const rl = await checkRateLimit(admin, cleanCpf, ip);
    if (!rl.allowed) {
      auditLog("rate_limited", { ip, cpf: maskedCpf, reason: rl.reason });
      await normalizeLatency(startedAt);
      return jsonResponse({ found: false, error_type: "rate_limited" });
    }

    const token = Deno.env.get("HUBDEV_TOKEN");
    if (!token) {
      auditLog("missing_token", { ip, cpf: maskedCpf });
      await normalizeLatency(startedAt);
      return jsonResponse({ found: false, error_type: "missing_token" });
    }

    auditLog("lookup_start", { ip, cpf: maskedCpf });

    const url = `https://ws.hubdodesenvolvedor.com.br/v2/nome_cpf/?cpf=${cleanCpf}&token=${token}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      const rawBody = await res.text();

      if (!res.ok) {
        auditLog("provider_http_error", { ip, cpf: maskedCpf, status: res.status });
        await normalizeLatency(startedAt);
        return jsonResponse({ found: false, error_type: "provider_unavailable" });
      }

      let data: any;
      try {
        data = JSON.parse(rawBody);
      } catch (parseErr) {
        auditLog("provider_parse_error", { ip, cpf: maskedCpf, err: (parseErr as Error).message });
        await normalizeLatency(startedAt);
        return jsonResponse({ found: false, error_type: "provider_unavailable" });
      }

      if (data.status === false || data.return === "NOK") {
        auditLog("not_found", { ip, cpf: maskedCpf });
        await normalizeLatency(startedAt);
        return jsonResponse({ found: false, error_type: "not_found" });
      }

      const result: CpfResult = {
        found: true,
        name: data.result?.nome || undefined,
        birth_date: data.result?.data_de_nascimento || undefined,
      };

      auditLog("found", {
        ip,
        cpf: maskedCpf,
        hasName: !!result.name,
        hasBirth: !!result.birth_date,
      });
      await normalizeLatency(startedAt);
      return jsonResponse(result);
    } catch (err) {
      clearTimeout(timeout);
      auditLog("provider_exception", { ip, cpf: maskedCpf, err: (err as Error).message });
      await normalizeLatency(startedAt);
      return jsonResponse({ found: false, error_type: "provider_unavailable" });
    }
  } catch (err) {
    auditLog("outer_error", { ip, err: (err as Error).message });
    await normalizeLatency(startedAt);
    return jsonResponse({ found: false, error_type: "provider_unavailable" });
  }
});
