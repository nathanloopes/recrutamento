import { supabase } from "@/integrations/supabase/client";

/**
 * Gate compartilhado do teste pós-entrevista (fase pipeline
 * `avaliacao_pos_entrevista`). Mesma regra usada por:
 *   - src/hooks/useApplicationStatus.ts  (botão "Realizar teste" no hub)
 *   - src/lib/testResolver.ts            (botão "Ver testes da vaga")
 *   - src/pages/candidate/Triage.tsx     (renderização do wizard)
 *
 * Liberado SOMENTE quando:
 *   1) Não há entrevista ativa pendente (confirmed / pending_approval /
 *      reschedule_requested), E
 *   2) Existe decisão aprovada de entrevista — `interview_feedback.decision`
 *      em ('aprovado','presencial').
 */
export function isPostInterviewTestUnlocked(args: {
  interviews: Array<{ status?: string | null; modality?: string | null; ai_result?: any }>;
  interviewDecision: string | null;
  appStatus: string | null | undefined;
}): boolean {
  const interviews = args.interviews || [];
  const hasActivePending = interviews.some((i) =>
    ["confirmed", "pending_approval", "reschedule_requested"].includes(String(i?.status || "")),
  );
  if (hasActivePending) return false;

  return ["aprovado", "presencial"].includes(String(args.interviewDecision || "").toLowerCase());
}

/**
 * Versão async que busca tudo a partir do applicationId. Usada quando o
 * caller não tem os dados de entrevista em mãos (ex.: testResolver).
 */
export async function fetchPostInterviewTestUnlocked(
  applicationId: string,
): Promise<boolean> {
  const [{ data: interviews }, { data: app }] = await Promise.all([
    supabase
      .from("interviews")
      .select("id, status, modality, ai_result")
      .eq("application_id", applicationId),
    supabase
      .from("applications")
      .select("status")
      .eq("id", applicationId)
      .maybeSingle(),
  ]);

  const concludedIds = (interviews || [])
    .filter((i: any) => i.status === "completed")
    .map((i: any) => i.id);

  let interviewDecision: string | null = null;
  if (concludedIds.length > 0) {
    try {
      const { data: myDec } = await (supabase as any).rpc("get_my_interview_decisions", {
        p_application_id: applicationId,
      });
      if (Array.isArray(myDec) && myDec.length > 0) {
        const match = myDec.find((d: any) => concludedIds.includes(d.interview_id));
        interviewDecision = (match?.decision as string) || null;
      }
    } catch {
      /* fallback abaixo */
    }
    if (!interviewDecision) {
      const { data: feedback } = await supabase
        .from("interview_feedback")
        .select("decision")
        .in("interview_id", concludedIds)
        .order("created_at", { ascending: false })
        .limit(1);
      interviewDecision = (feedback?.[0] as any)?.decision || null;
    }
  }

  return isPostInterviewTestUnlocked({
    interviews: (interviews || []) as any[],
    interviewDecision,
    appStatus: (app as any)?.status,
  });
}

/**
 * Libera o teste pós-entrevista quando o recrutador aprova a entrevista.
 *
 * Regras:
 *  1. Lê `unit_test_config` da unidade da aplicação. Se `enabled=false` ou
 *     inexistente → no-op (fluxo atual segue intocado).
 *  2. Busca um `test_template` ativo com `job_ids` contendo o cargo.
 *     Se não houver → no-op + log.
 *  3. Idempotente: se já existe um `test_assignment` pendente/em_andamento
 *     com `post_interview=true` para a aplicação, retorna ele.
 *  4. Caso contrário, cria um novo `test_assignment` com:
 *       - `post_interview = true`
 *       - `released_at = now()`
 *       - `modality_chosen = null` (candidato escolhe se a unidade é "ambos")
 *
 * Não cria/move `applications.status` — quem chama já fez isso.
 *
 * Retorna `{ released, modality, assignmentId }` para o caller decidir
 * notificações e UI.
 */
export type ReleaseResult =
  | { released: false; reason: string }
  | {
      released: true;
      modality: "presencial" | "online" | "ambos";
      assignmentId: string;
      isNew: boolean;
    };

export async function releasePostInterviewTest(
  applicationId: string,
): Promise<ReleaseResult> {
  // Helper: marca explicitamente o campo na candidatura (true|false).
  const markAssigned = async (value: boolean) => {
    try {
      await (supabase as any)
        .from("applications")
        .update({ post_interview_test_assigned: value })
        .eq("id", applicationId);
    } catch (e) {
      console.error("[releasePostInterviewTest] mark assigned failed", e);
    }
  };

  // 1) Carrega applicação + unidade + cargo
  const { data: app, error: appErr } = await supabase
    .from("applications")
    .select(
      "id, candidate_id, unit_job_id, unit_jobs!inner(unit_id, job_id)",
    )
    .eq("id", applicationId)
    .maybeSingle();

  if (appErr || !app) {
    return { released: false, reason: "application_not_found" };
  }

  const unitId = (app as any).unit_jobs?.unit_id as string | undefined;
  const jobId = (app as any).unit_jobs?.job_id as string | undefined;
  const candidateId = (app as any).candidate_id as string | undefined;

  if (!unitId || !jobId || !candidateId) {
    return { released: false, reason: "missing_unit_or_job" };
  }

  // 1.1) PRIORIDADE: se o pipeline ATIVO do cargo tem fase
  // `avaliacao_pos_entrevista`, avança `current_phase` para essa fase e
  // marca a aplicação como pronta para o teste pós-entrevista.
  //
  // Regra de modalidade (restaurada):
  //   - Se `unit_test_config.modality = 'ambos'`, seguimos para as etapas
  //     2–5 para CRIAR um `test_assignment` (post_interview=true) com
  //     `modality_chosen=null`. Isso reativa a UI de escolha de modalidade
  //     no `PostInterviewTestCard` do candidato e o enriquecimento do
  //     `TestBookingsTab` no admin.
  //   - Se `modality` for `'online'` ou `'presencial'` puros, o pipeline
  //     conduz o teste sozinho (rota /triagem/:applicationId) e não há
  //     escolha a fazer — retornamos `pipeline_phase_handles_test`.
  let pipelineHandlesTest = false;
  try {
    const { data: activePipeline } = await (supabase as any)
      .from("job_pipelines")
      .select("id, pipeline_phases(id, phase_kind, order_index)")
      .eq("job_id", jobId)
      .eq("is_active", true)
      .maybeSingle();

    const postPhase = (activePipeline?.pipeline_phases || [])
      .filter((p: any) => p.phase_kind === "avaliacao_pos_entrevista")
      .sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0))[0];

    if (postPhase?.id) {
      await supabase
        .from("applications")
        .update({
          current_phase: postPhase.id,
          status: "em_andamento",
          post_interview_test_assigned: true,
        } as any)
        .eq("id", applicationId);
      pipelineHandlesTest = true;
    }
  } catch (e) {
    console.error("[releasePostInterviewTest] pipeline check failed", e);
  }

  // Se o pipeline cuida do teste, encerramos aqui — a UI do candidato
  // (PostInterviewModalityCard) já resolve escolha de modalidade e
  // agendamento presencial via test_bookings, sem depender de
  // test_assignment/test_template. Presencial não requer template.
  if (pipelineHandlesTest) {
    return { released: false, reason: "pipeline_phase_handles_test" };
  }

  // 2) Lê config de teste da unidade
  const { data: cfg } = await (supabase as any)
    .from("unit_test_config")
    .select("enabled, modality")
    .eq("unit_id", unitId)
    .maybeSingle();

  if (!cfg || !cfg.enabled) {
    await markAssigned(false);
    return { released: false, reason: "unit_test_disabled" };
  }

  const configuredModality = String(cfg.modality || "");
  if (!["presencial", "online", "ambos"].includes(configuredModality)) {
    await markAssigned(false);
    return { released: false, reason: "invalid_unit_test_modality" };
  }

  const modality = configuredModality as "presencial" | "online" | "ambos";

  // 3) Idempotência: já existe assignment pendente?
  const { data: existing } = await (supabase as any)
    .from("test_assignments")
    .select("id")
    .eq("application_id", applicationId)
    .eq("post_interview", true)
    .in("status", ["pendente", "em_andamento"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    await markAssigned(true);
    return {
      released: true,
      modality,
      assignmentId: existing.id,
      isNew: false,
    };
  }

  // 4) Busca template vinculado ao cargo (preferir ativos; se não houver, usar
  //    o mais recente inativo como fallback para não bloquear a aprovação
  //    quando o admin esqueceu de ativar o teste no Construtor).
  const { data: templates } = await (supabase as any)
    .from("test_templates")
    .select("id, job_ids, is_active, created_at")
    .order("created_at", { ascending: false });

  const matchesJob = (t: any) =>
    Array.isArray(t.job_ids) && t.job_ids.includes(jobId);
  const matched =
    (templates || []).find((t: any) => t.is_active && matchesJob(t)) ||
    (templates || []).find(matchesJob);

  if (!matched) {
    await markAssigned(false);
    return { released: false, reason: "no_template_for_job" };
  }
  if (!matched.is_active) {
    console.warn(
      "[releasePostInterviewTest] usando template inativo como fallback",
      { jobId, templateId: matched.id },
    );
  }

  // 5) Cria assignment
  const { data: created, error: insErr } = await (supabase as any)
    .from("test_assignments")
    .insert({
      test_template_id: matched.id,
      application_id: applicationId,
      candidate_id: candidateId,
      assigned_by: null,
      status: "pendente",
      is_mandatory: true,
      post_interview: true,
      released_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();

  if (insErr || !created?.id) {
    console.error("[releasePostInterviewTest] insert failed", insErr);
    return { released: false, reason: "insert_failed" };
  }

  await markAssigned(true);
  return {
    released: true,
    modality,
    assignmentId: created.id,
    isNew: true,
  };
}
