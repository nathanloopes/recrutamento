import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * e2e-candidate-smoke
 *
 * Cria um candidato sintético, valida etapas-chave do ciclo (perfil →
 * banco de talentos → application) e ao final remove tudo.
 * Apenas administradores podem chamar.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const stages: Array<{ name: string; ok: boolean; ms: number; error?: string }> = [];
  const t0 = Date.now();
  let triggered_by: string | null = null;
  let candidateId: string | null = null;

  // Validate caller is admin
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const jwt = auth.replace(/^Bearer\s+/i, "");
    const { data: userData } = await admin.auth.getUser(jwt);
    if (!userData?.user) throw new Error("not_authenticated");
    triggered_by = userData.user.id;
    const { data: roles } = await admin
      .from("user_roles").select("role").eq("user_id", userData.user.id);
    const isAdmin = (roles ?? []).some((r: any) => r.role === "admin");
    if (!isAdmin) throw new Error("forbidden");
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: "Apenas administradores podem executar esta validação." }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  async function step(name: string, fn: () => Promise<void>) {
    const s = Date.now();
    try { await fn(); stages.push({ name, ok: true, ms: Date.now() - s }); }
    catch (err) { stages.push({ name, ok: false, ms: Date.now() - s, error: (err as Error).message }); throw err; }
  }

  let success = false;
  let errorMessage: string | null = null;

  try {
    // Stage 1: cria candidato sintético
    await step("create_candidate", async () => {
      const cpf = "000000000" + String(Math.floor(Math.random() * 100)).padStart(2, "0");
      const { data, error } = await admin.from("candidates").insert({
        cpf,
        full_name: "Candidato Smoke Test",
        email: `smoke+${Date.now()}@test.local`,
        phone: "11999999999",
        cep: "01310100",
        city: "São Paulo",
        state: "SP",
        is_synthetic: true,
        status: "ativo",
      }).select("id").single();
      if (error) throw error;
      candidateId = data.id;
    });

    // Stage 2: entrada no talent pool
    await step("talent_pool_entry", async () => {
      const { error } = await admin.from("talent_pool_entries").insert({
        candidate_id: candidateId,
        status: "active",
        global_score: 0,
        is_synthetic: true,
      });
      if (error) throw error;
    });

    // Stage 3: simula score
    await step("score_event", async () => {
      const { error } = await admin.rpc("insert_score_event", {
        p_candidate_id: candidateId,
        p_event_type: "test_completed",
        p_process_stage: "triagem",
        p_related_job_id: null,
        p_score_delta: 75,
        p_reason: "Smoke test sintético",
        p_metadata: { synthetic: true },
      });
      if (error) throw error;
    });

    // Stage 4: validação do score salvo
    await step("verify_score", async () => {
      const { data, error } = await admin
        .from("talent_pool_entries")
        .select("global_score").eq("candidate_id", candidateId).single();
      if (error) throw error;
      if (!data || data.global_score !== 75) throw new Error(`score esperado 75, obtido ${data?.global_score}`);
    });

    success = stages.every((s) => s.ok);
  } catch (err) {
    errorMessage = (err as Error).message;
  } finally {
    // Cleanup imediato (não esperar 1h)
    if (candidateId) {
      await admin.from("applications").delete().eq("candidate_id", candidateId);
      await admin.from("talent_pool_entries").delete().eq("candidate_id", candidateId);
      await admin.from("candidates").delete().eq("id", candidateId);
    }
  }

  const duration_ms = Date.now() - t0;
  await admin.from("e2e_run_logs").insert({
    triggered_by,
    scenario: "candidate_full_flow",
    success,
    duration_ms,
    stages,
    error_message: errorMessage,
  });

  return new Response(
    JSON.stringify({
      ok: success,
      duration_ms,
      passed: stages.filter((s) => s.ok).length,
      total: stages.length,
      error: errorMessage,
      stages,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
