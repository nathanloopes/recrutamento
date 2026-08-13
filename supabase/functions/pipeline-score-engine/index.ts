// Pipeline Score Engine v6.1
// Calcula score consolidado de uma fase, aplica gate de min_score e avança/pausa o candidato.
// - Soma ponderada: Σ(weight × raw_score) / Σ(weight)  → 0..100
// - Se score >= min_score → avança current_phase para próxima fase do pipeline
// - Se score < min_score E fase é eliminatória → applications.status = 'standby'
// - Se score >= 90 → dispara onHighScore
// - Persiste tudo em pipeline_ai_logs + activity_logs (auditável)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { withAuth } from "../_shared/with-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface StepSubmission {
  step_id: string;
  raw_score: number; // 0..100
  justification?: string;
}

interface RequestBody {
  application_id: string;
  phase_id: string;
  step_submissions: StepSubmission[];
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function validate(body: unknown): { ok: true; data: RequestBody } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "body inválido" };
  const b = body as Record<string, unknown>;
  if (typeof b.application_id !== "string" || !b.application_id) return { ok: false, error: "application_id obrigatório" };
  if (typeof b.phase_id !== "string" || !b.phase_id) return { ok: false, error: "phase_id obrigatório" };
  if (!Array.isArray(b.step_submissions) || b.step_submissions.length === 0) return { ok: false, error: "step_submissions vazio" };
  for (const s of b.step_submissions as any[]) {
    if (!s || typeof s.step_id !== "string") return { ok: false, error: "step_id obrigatório em cada submission" };
    if (typeof s.raw_score !== "number" || s.raw_score < 0 || s.raw_score > 100) {
      return { ok: false, error: "raw_score deve ser número entre 0 e 100" };
    }
  }
  return { ok: true, data: b as unknown as RequestBody };
}

Deno.serve(withAuth(async (req, _ctx) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const raw = await req.json().catch(() => null);
    const v = validate(raw);
    if (!v.ok) return json({ error: v.error }, 400);
    const { application_id, phase_id, step_submissions } = v.data;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Carrega fase e suas etapas (inclui type para hybrid scoring v6.2)
    const { data: phase, error: phaseErr } = await supabase
      .from("pipeline_phases")
      .select("id, pipeline_id, name, min_score, phase_type, phase_kind, order_index, pipeline_steps(id, weight, title, type)")
      .eq("id", phase_id)
      .single();
    if (phaseErr || !phase) return json({ error: "fase não encontrada" }, 404);

    const steps: Array<{ id: string; weight: number; title: string; type?: string }> =
      (phase as any).pipeline_steps || [];

    // Verifica que todas as submissões correspondem a etapas válidas da fase
    const stepIds = new Set(steps.map((s) => s.id));
    for (const sub of step_submissions) {
      if (!stepIds.has(sub.step_id)) {
        return json({ error: `step_id ${sub.step_id} não pertence à fase` }, 400);
      }
    }

    // Hybrid scoring v6.2:
    // - Quiz: peso por ALTERNATIVA já está embutido no raw_score (cliente normalizou
    //   peso da resposta escolhida para 0..100 via (weight/3)*100). step.weight = 1 forçado.
    // - Essay/voice/text/imagem/video/audio: mantém peso por PERGUNTA via step.weight.
    let weightedSum = 0;
    let totalWeight = 0;
    for (const sub of step_submissions) {
      const step = steps.find((s) => s.id === sub.step_id)!;
      const stepTypeLower = (step.type || "").toLowerCase();
      const isQuiz = stepTypeLower === "quiz" || stepTypeLower === "true_false";
      const w = isQuiz ? 1 : Number(step.weight || 1);
      weightedSum += (sub.raw_score * w);
      totalWeight += w;
    }
    const consolidatedScore = totalWeight > 0
      ? Math.round((weightedSum / totalWeight) * 100) / 100
      : 0;

    const minScore = Number((phase as any).min_score || 0);
    const passed = consolidatedScore >= minScore;
    const phaseKindLower = String((phase as any).phase_kind || "").toLowerCase();
    // Triagem é SEMPRE eliminatória — reprovação move para standby automaticamente,
    // independente de phase_type estar configurado como 'eliminatoria'.
    const isTriagem = phaseKindLower === "triagem";
    const isEliminatory =
      isTriagem || ((phase as any).phase_type || "eliminatoria") === "eliminatoria";
    const isHighScore = consolidatedScore >= 90;

    // Carrega application + candidate_id
    const { data: app, error: appErr } = await supabase
      .from("applications")
      .select("id, candidate_id, status, current_phase, unit_job_id")
      .eq("id", application_id)
      .single();
    if (appErr || !app) return json({ error: "application não encontrada" }, 404);

    // Próxima fase do mesmo pipeline (se passou)
    let nextPhaseId: string | null = null;
    if (passed) {
      const { data: nextPhase } = await supabase
        .from("pipeline_phases")
        .select("id, order_index")
        .eq("pipeline_id", (phase as any).pipeline_id)
        .gt("order_index", (phase as any).order_index)
        .order("order_index", { ascending: true })
        .limit(1)
        .maybeSingle();
      nextPhaseId = nextPhase?.id || null;
    }

    // Aplica decisão na application
    let newStatus = (app as any).status;
    let newCurrentPhase = (app as any).current_phase;
    let decision: "advanced" | "completed" | "standby" | "stayed" = "stayed";
    let autoApprovedByScore = false;
    let standbyReason: string | null = null;

    if (passed) {
      if (nextPhaseId) {
        newCurrentPhase = nextPhaseId;
        decision = "advanced";
      } else {
        // não há próxima fase → pipeline completo
        decision = "completed";
      }
    } else if (isEliminatory) {
      newStatus = "standby";
      decision = "standby";
      standbyReason = isTriagem
        ? `Score ${consolidatedScore} abaixo do mínimo ${minScore} na triagem`
        : `Score ${consolidatedScore} abaixo do mínimo ${minScore} na fase "${(phase as any).name}"`;
    }

    // Auto-aprovação por score: quando a fase avaliada é teste/avaliação,
    // o setting `pipelines.auto_approve_test_if_not_exists` está ligado
    // e o candidato atingiu o min_score, marcamos status='aprovado'
    // dispensando o clique manual do recrutador.
    //
    // Para TRIAGEM aprovada, a regra é:
    //  - flag ligada                     → status='aprovado' (auto-aprovação total; candidato pode auto-agendar entrevista)
    //  - flag desligada                  → status='em_avaliacao' (recrutador decide manualmente)
    // `current_phase` continua avançando para a próxima fase, se existir.
    let autoTriagePromoted = false;
    if (passed) {
      const isTestPhase =
        phaseKindLower === "avaliacao" || phaseKindLower === "teste" || phaseKindLower === "test";

      if (isTestPhase || isTriagem) {
        const { data: setting } = await supabase
          .from("global_settings")
          .select("value")
          .eq("category", "pipelines")
          .eq("key", "auto_approve_test_if_not_exists")
          .maybeSingle();
        const raw = (setting as any)?.value;
        const enabled = raw === true || raw === "true";

        if (isTestPhase && enabled) {
          newStatus = "aprovado";
          autoApprovedByScore = true;
        } else if (isTriagem) {
          if (enabled) {
            newStatus = "aprovado";
            autoApprovedByScore = true;
          } else if ((app as any).status === "em_andamento" || (app as any).status === "pendente") {
            newStatus = "em_avaliacao";
            autoTriagePromoted = true;
          }
        }
      }
    }

    // Sempre persistir total_score quando vier da triagem, para o card do
    // recrutador refletir a avaliação automática (mesmo reprovado).
    const shouldPersistScore = isTriagem;

    if (decision !== "stayed" || autoApprovedByScore || autoTriagePromoted || shouldPersistScore) {
      const updates: Record<string, unknown> = {};
      if (newCurrentPhase !== (app as any).current_phase) updates.current_phase = newCurrentPhase;
      if (newStatus !== (app as any).status) updates.status = newStatus;
      if (shouldPersistScore) updates.total_score = consolidatedScore;
      if (standbyReason) updates.standby_reason = standbyReason;
      if (Object.keys(updates).length > 0) {
        const { error: updErr } = await supabase
          .from("applications")
          .update(updates)
          .eq("id", application_id);
        if (updErr) console.error("[score-engine] update application error:", updErr);
      }
    }

    if (autoApprovedByScore) {
      await supabase.from("activity_logs").insert({
        user_id: (app as any).candidate_id,
        action: isTriagem ? "auto_triage_approval" : "auto_test_approval",
        module: "pipelines",
        details: {
          application_id,
          phase_id,
          score: consolidatedScore,
          min_score: minScore,
          reason: "score_meets_min",
          triggered_by: "score_engine",
        },
      } as any);
    } else if (autoTriagePromoted) {
      await supabase.from("activity_logs").insert({
        user_id: (app as any).candidate_id,
        action: "auto_triage_promotion",
        module: "pipelines",
        details: {
          application_id,
          phase_id,
          score: consolidatedScore,
          min_score: minScore,
          new_status: "em_avaliacao",
          reason: "triage_passed",
          triggered_by: "score_engine",
        },
      } as any);
    }

    // Auditoria — pipeline_ai_logs (mesmo motor para humano/IA)
    await supabase.from("pipeline_ai_logs").insert({
      pipeline_id: (phase as any).pipeline_id,
      phase_id: phase_id,
      step_id: null,
      candidate_id: (app as any).candidate_id,
      ai_action: "score_engine_evaluation",
      ai_result: {
        consolidated_score: consolidatedScore,
        min_score: minScore,
        passed,
        decision,
        is_eliminatory: isEliminatory,
        is_high_score: isHighScore,
        step_submissions,
        weighted_sum: weightedSum,
        total_weight: totalWeight,
        next_phase_id: nextPhaseId,
      },
    } as any);

    // Activity log
    await supabase.from("activity_logs").insert({
      user_id: (app as any).candidate_id,
      action: "pipeline_phase_evaluated",
      module: "pipelines",
      details: {
        application_id,
        phase_id,
        phase_name: (phase as any).name,
        score: consolidatedScore,
        min_score: minScore,
        passed,
        decision,
      },
    } as any);

    // Notificações (best-effort, não bloqueia)
    try {
      const eventMap: Record<string, string> = {
        advanced: "pipeline_phase_completed",
        completed: "pipeline_phase_completed",
        standby: "pipeline_phase_failed",
        stayed: "pipeline_phase_evaluated",
      };
      const titleMap: Record<string, string> = {
        advanced: "Etapa concluída",
        completed: "Processo concluído",
        standby: "Candidatura em análise",
        stayed: "Resposta registrada",
      };
      const bodyMap: Record<string, string> = {
        advanced: `Você avançou para a próxima etapa do processo.`,
        completed: `Você concluiu todas as etapas do processo seletivo.`,
        standby: `Sua candidatura está em análise. Em breve a unidade retorna com mais informações.`,
        stayed: `Sua resposta foi registrada. Aguarde a análise da unidade.`,
      };
      await supabase.from("notifications").insert({
        event_type: eventMap[decision],
        recipient_id: (app as any).candidate_id,
        channel: "push",
        title: titleMap[decision],
        body: bodyMap[decision],
        status: "pending",
        payload: { application_id, phase_id, score: consolidatedScore, decision },
      } as any);

      // Destaque por score alto é uso interno (admin/recrutador) — não notifica candidato.
    } catch (e) {
      console.error("[score-engine] notification error:", e);
    }


    return json({
      ok: true,
      consolidated_score: consolidatedScore,
      min_score: minScore,
      passed,
      is_eliminatory: isEliminatory,
      is_high_score: isHighScore,
      decision,
      next_phase_id: nextPhaseId,
    });
  } catch (e) {
    console.error("[score-engine] fatal:", e);
    return json({ error: e instanceof Error ? e.message : "erro interno" }, 500);
  }
}, { allowedRoles: [] }));
