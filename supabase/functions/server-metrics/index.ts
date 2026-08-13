// Edge Function: server-metrics
// Proxy autenticado para a API do Glances rodando no servidor monitorado.
// Acesso restrito a usuários com role `admin`. Lê credenciais via Secrets:
//   - MONITOR_HOST   (host/IP do servidor monitorado)
//   - MONITOR_PORT   (default: 61208)
//   - MONITOR_USER   (usuário do basic auth do Glances)
//   - MONITOR_PASS   (senha do basic auth do Glances)
//
// Retorna um JSON enxuto com CPU, memória, disco, rede, load e uptime.

// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

async function fetchGlances(path: string, base: string, authHeader: string) {
  const res = await fetch(`${base}${path}`, {
    headers: { Authorization: authHeader },
    // Glances pode demorar — limite generoso
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`Glances ${path} respondeu ${res.status}`);
  }
  return await res.json();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const MONITOR_HOST = Deno.env.get("MONITOR_HOST");
    const MONITOR_PORT = Deno.env.get("MONITOR_PORT") || "61208";
    const MONITOR_USER = Deno.env.get("MONITOR_USER");
    const MONITOR_PASS = Deno.env.get("MONITOR_PASS");

    if (!MONITOR_HOST || !MONITOR_USER || !MONITOR_PASS) {
      return json(
        { error: "Monitoração de servidor não está configurada (faltam secrets MONITOR_HOST/USER/PASS)." },
        500,
      );
    }

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "Não autenticado." }, 401);
    }

    // Cliente vinculado ao usuário para validar a sessão
    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userErr,
    } = await supabaseAuth.auth.getUser();
    if (userErr || !user) {
      return json({ error: "Sessão inválida." }, 401);
    }

    // Verifica role admin via RPC `has_role`
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
      _user_id: user.id,
      _role: "admin",
    });
    if (!isAdmin) {
      return json({ error: "Acesso restrito a administradores." }, 403);
    }

    // Monta credenciais para o Glances
    const glancesBase = `http://${MONITOR_HOST}:${MONITOR_PORT}/api/4`;
    const basicAuth = "Basic " + btoa(`${MONITOR_USER}:${MONITOR_PASS}`);

    // Coleta dados em paralelo (cada endpoint do Glances é leve)
    const [cpu, mem, memswap, fs, load, uptime, network, sensors, system] =
      await Promise.all([
        fetchGlances("/cpu", glancesBase, basicAuth).catch(() => null),
        fetchGlances("/mem", glancesBase, basicAuth).catch(() => null),
        fetchGlances("/memswap", glancesBase, basicAuth).catch(() => null),
        fetchGlances("/fs", glancesBase, basicAuth).catch(() => null),
        fetchGlances("/load", glancesBase, basicAuth).catch(() => null),
        fetchGlances("/uptime", glancesBase, basicAuth).catch(() => null),
        fetchGlances("/network", glancesBase, basicAuth).catch(() => null),
        fetchGlances("/sensors", glancesBase, basicAuth).catch(() => null),
        fetchGlances("/system", glancesBase, basicAuth).catch(() => null),
      ]);

    return json({
      ok: true,
      collected_at: new Date().toISOString(),
      host: MONITOR_HOST,
      cpu,
      mem,
      memswap,
      fs,
      load,
      uptime,
      network,
      sensors,
      system,
    });
  } catch (e: any) {
    console.error("[server-metrics] erro:", e);
    return json(
      { error: e?.message || "Erro ao consultar servidor monitorado." },
      500,
    );
  }
});
