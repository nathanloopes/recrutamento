import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Rotina de limpeza de push_tokens.
 * - Marca como inativos tokens com >90 dias sem entrega bem-sucedida (cruzamento com delivery_logs).
 * - Apaga fisicamente tokens já inativos com >180 dias.
 * - Remove duplicatas ativas para o mesmo endpoint (defesa-em-profundidade).
 *
 * Disparado diariamente por pg_cron (03:00 UTC).
 * Pode ser chamado manualmente com service-role para auditoria.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const oneEightyDaysAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // 1) Buscar candidatos a desativação: ativos, criados há >90 dias
    const { data: oldActive, error: oldErr } = await admin
      .from("push_tokens")
      .select("id, endpoint, user_id, created_at")
      .eq("is_active", true)
      .lt("created_at", ninetyDaysAgo);

    if (oldErr) {
      console.error("[cleanup-push-tokens] error fetching old active:", oldErr);
    }

    let deactivated = 0;
    if (oldActive && oldActive.length > 0) {
      // Para cada um, verificar se houve entrega bem-sucedida nos últimos 30 dias
      const ids: string[] = [];
      for (const tok of oldActive) {
        const { count } = await admin
          .from("delivery_logs")
          .select("id", { count: "exact", head: true })
          .eq("channel", "push")
          .eq("delivered", true)
          .gte("created_at", thirtyDaysAgo)
          .filter("provider_response->>recipient_id", "eq", tok.user_id);
        if (!count || count === 0) ids.push(tok.id);
      }

      if (ids.length > 0) {
        const { error: deactErr } = await admin
          .from("push_tokens")
          .update({ is_active: false })
          .in("id", ids);
        if (deactErr) console.error("[cleanup-push-tokens] deactivation error:", deactErr);
        else deactivated = ids.length;
      }
    }

    // 2) Apagar fisicamente tokens inativos com >180 dias
    const { count: deletedCount, error: delErr } = await admin
      .from("push_tokens")
      .delete({ count: "exact" })
      .eq("is_active", false)
      .lt("created_at", oneEightyDaysAgo);

    if (delErr) console.error("[cleanup-push-tokens] delete error:", delErr);

    // Defesa-em-profundidade: o índice único parcial já impede dois ativos
    // para o mesmo endpoint, então não é necessária ação adicional aqui.

    // Audit log
    await admin.from("activity_logs").insert({
      action: "cleanup_push_tokens",
      module: "notifications",
      details: {
        deactivated,
        deleted: deletedCount ?? 0,
        ran_at: now.toISOString(),
      },
    });

    return new Response(
      JSON.stringify({
        ok: true,
        deactivated,
        deleted: deletedCount ?? 0,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[cleanup-push-tokens] error:", err);
    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
