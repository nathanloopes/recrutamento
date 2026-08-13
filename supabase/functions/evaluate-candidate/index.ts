import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withAuth } from "../_shared/with-auth.ts";
import { shouldLogAIDecision } from "../_shared/ai-log-guard.ts";
import { guardFeatureFlag } from "../_shared/feature-flag-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface EvalRequest {
  step_response_id: string;
  application_id: string;
  prompt_version_id?: string; // optional: force specific prompt version for re-evaluation
}

interface CriteriaWeight {
  key: string;
  weight: number;
}

interface GovernanceConfig {
  ai_model_default: string;
  require_human_validation: boolean;
  ai_elimination_allowed: boolean;
  escalation_score_margin: number;
  escalation_on_inconsistency: boolean;
  escalation_on_risk_keywords: boolean;
  ai_max_autonomy: string;
}

// Risk keywords for escalation (configurable via CrossConfig in the future)
const DEFAULT_RISK_KEYWORDS = [
  "ameaça", "ameaca", "processo", "advogado", "denúncia", "denuncia",
  "violência", "violencia", "agressão", "agressao", "racismo",
  "assédio", "assedio", "discriminação", "discriminacao",
  "suicídio", "suicidio", "morte", "matar",
  "droga", "tráfico", "trafico", "arma",
  "fraude", "roubo", "furto",
];

function parseGovValue(val: any, fallback: any): any {
  if (val === null || val === undefined) return fallback;
  if (typeof val === "string") {
    if (val === "true") return true;
    if (val === "false") return false;
    return val.replace(/"/g, "");
  }
  return val;
}

Deno.serve(withAuth(async (req, ctx) => {
  // Feature flag guard: automated_evaluation
  const flagBlock = await guardFeatureFlag("automated_evaluation");
  if (flagBlock) return flagBlock;

  const startTime = Date.now();

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY not configured");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { step_response_id, application_id, prompt_version_id }: EvalRequest = await req.json();
    if (!step_response_id || !application_id) {
      return new Response(
        JSON.stringify({ error: "step_response_id and application_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Load step response
    const { data: stepResponse, error: srErr } = await supabase
      .from("step_responses")
      .select("*, pipeline_steps(*)")
      .eq("id", step_response_id)
      .single();
    if (srErr || !stepResponse) {
      return new Response(JSON.stringify({ error: "Step response not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load AI settings
    const { data: aiSettings } = await supabase
      .from("global_settings")
      .select("key, value")
      .eq("category", "ai");

    // Load default_tone and default_language from CrossConfig
    const { data: toneLanguageSettings } = await supabase
      .from("global_settings")
      .select("key, value")
      .eq("category", "units")
      .in("key", ["default_tone", "default_language"]);
    const tlMap: Record<string, any> = {};
    (toneLanguageSettings || []).forEach((s: any) => { tlMap[s.key] = s.value; });
    const defaultTone = typeof tlMap.default_tone === "string" ? tlMap.default_tone.replace(/"/g, "") : "formal";
    const defaultLanguage = typeof tlMap.default_language === "string" ? tlMap.default_language.replace(/"/g, "") : "pt-BR";

    // Load governance settings
    const { data: govSettings } = await supabase
      .from("global_settings")
      .select("key, value")
      .eq("category", "ai_governance");

    // Load scoring settings
    const { data: scoringSettings } = await supabase
      .from("global_settings")
      .select("key, value")
      .eq("category", "scoring");

    // Load pipeline settings
    const { data: pipelineSettings } = await supabase
      .from("global_settings")
      .select("key, value")
      .eq("category", "pipelines");

    const getConfig = (key: string, fallback: number | string) => {
      const s = aiSettings?.find((s: any) => s.key === key);
      return s ? s.value : fallback;
    };

    const getGov = (key: string, fallback: any) => {
      const s = govSettings?.find((s: any) => s.key === key);
      return s ? parseGovValue(s.value, fallback) : fallback;
    };

    const getScoring = (key: string, fallback: any) => {
      const s = scoringSettings?.find((s: any) => s.key === key);
      if (!s) return fallback;
      const v = s.value;
      if (typeof v === "string") {
        if (v === "true") return true;
        if (v === "false") return false;
        const n = Number(v);
        if (!isNaN(n)) return n;
        return v.replace(/"/g, "");
      }
      return v;
    };

    const getPipeline = (key: string, fallback: any) => {
      const s = pipelineSettings?.find((s: any) => s.key === key);
      if (!s) return fallback;
      const v = s.value;
      if (typeof v === "string") { if (v === "true") return true; if (v === "false") return false; }
      return v;
    };

    // ===== FIX #1: Check ai_enabled from ai_governance =====
    const aiEnabled = getGov("ai_enabled", true);
    if (aiEnabled === false) {
      // Log the blocked attempt
      await supabase.from("activity_logs").insert({
        action: "ai_evaluation_blocked_disabled",
        module: "ia",
        details: { reason: "ai_enabled=false in ai_governance", application_id, step_response_id },
      });

      return new Response(JSON.stringify({
        skipped: true,
        reason: "AI evaluation is disabled via CrossConfig (ai_governance.ai_enabled = false). Decision escalated to human.",
        decision: "escalate_human",
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if AI evaluation is enabled in pipeline CrossConfig (legacy check)
    const aiEvaluationEnabled = getPipeline("ai_evaluation_enabled", true);
    if (aiEvaluationEnabled === false) {
      return new Response(JSON.stringify({
        skipped: true,
        reason: "AI evaluation is disabled via CrossConfig (pipelines.ai_evaluation_enabled = false)",
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Governance config
    const governance: GovernanceConfig = {
      ai_model_default: getGov("ai_model_default", "gpt-4o-mini"),
      require_human_validation: getGov("require_human_validation", false),
      ai_elimination_allowed: getGov("ai_elimination_allowed", true),
      escalation_score_margin: Number(getGov("escalation_score_margin", 10)),
      escalation_on_inconsistency: getGov("escalation_on_inconsistency", true),
      escalation_on_risk_keywords: getGov("escalation_on_risk_keywords", true),
      ai_max_autonomy: getGov("ai_max_autonomy", "suggest"),
    };

    // Scoring thresholds
    const minScoreIaInterview = Number(getScoring("min_score_ia_interview", 70));
    const scoreRounding = String(getScoring("score_rounding", "floor"));

    const weights: CriteriaWeight[] = [
      { key: "communication", weight: Number(getConfig("weight_communication", 25)) },
      { key: "clarity", weight: Number(getConfig("weight_clarity", 25)) },
      { key: "coherence", weight: Number(getConfig("weight_coherence", 25)) },
      { key: "role_fit", weight: Number(getConfig("weight_role_fit", 25)) },
    ];
    const approveThreshold = Number(getConfig("auto_approve_threshold", 85));
    const rejectThreshold = Number(getConfig("auto_reject_threshold", 40));
    const basePrompt = String(getConfig("base_prompt", ""));

    // Load prompt version — specific ID (for re-evaluation) or active version
    let promptVersion: any = null;
    if (prompt_version_id) {
      const { data } = await supabase
        .from("ai_prompt_versions")
        .select("prompt_text, version, id")
        .eq("id", prompt_version_id)
        .single();
      promptVersion = data;
    } else {
      const { data } = await supabase
        .from("ai_prompt_versions")
        .select("prompt_text, version, id")
        .eq("is_active", true)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      promptVersion = data;
    }

    const systemPrompt = promptVersion?.prompt_text || basePrompt || `Você é um avaliador profissional de entrevistas corporativas para a rede Recruta.

NUNCA avalie por igualdade textual. Avalie por entendimento semântico.

REGRAS DE AVALIAÇÃO:
1. O candidato NÃO precisa usar as mesmas palavras.
2. Sinônimos e explicações próprias são válidas.
3. Considere erros pequenos de transcrição de voz.
4. Avalie INTENÇÃO, não frase literal.
5. Se o conceito estiver implícito, considere correto.
6. Penalize apenas quando houver entendimento errado.

Avalie a resposta do candidato nos seguintes critérios, dando uma nota de 0 a 100 para cada:
- communication: Qualidade da comunicação
- clarity: Clareza e objetividade
- coherence: Coerência e consistência
- role_fit: Adequação ao perfil do cargo

Responda APENAS em JSON válido com este formato exato:
{
  "scores": { "communication": 80, "clarity": 75, "coherence": 85, "role_fit": 70 },
  "strengths": ["ponto forte 1", "ponto forte 2"],
  "risks": ["risco 1"],
  "explanation": "Explicação geral da avaliação",
  "nivel_entendimento": "baixo | medio | alto"
}`;

    // Append tone/language instructions from CrossConfig
    const toneInstruction = defaultTone === "informal"
      ? "\n\nUse um tom descontraído na explicação."
      : defaultTone === "técnico"
        ? "\n\nUse um tom técnico e preciso na explicação."
        : "\n\nUse um tom profissional e respeitoso na explicação.";
    const langInstruction = defaultLanguage !== "pt-BR" ? `\n\nResponda no idioma: ${defaultLanguage}.` : "";
    const finalSystemPrompt = systemPrompt + toneInstruction + langInstruction;

    const candidateResponse = JSON.stringify(stepResponse.response);
    const stepTitle = (stepResponse as any).pipeline_steps?.title || "Etapa";

    // Call OpenAI with dynamic model
    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: governance.ai_model_default,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: finalSystemPrompt + "\n\nResponda APENAS em formato JSON." },
          {
            role: "user",
            content: `Etapa: ${stepTitle}\n\nResposta do candidato:\n${candidateResponse}\n\nRetorne sua avaliação em JSON.`,
          },
        ],
      }),
    });

    if (!openaiResponse.ok) {
      const errBody = await openaiResponse.text();
      console.error("OpenAI API error:", errBody);
      throw new Error("AI evaluation service unavailable");
    }

    const openaiResult = await openaiResponse.json();
    const rawContent = openaiResult.choices?.[0]?.message?.content;
    if (!rawContent) throw new Error("AI returned empty response");
    const aiContent = JSON.parse(rawContent);

    // Extract scores
    const criteriaScores: Record<string, number> = {};
    let weightedSum = 0;
    let totalWeight = 0;

    for (const w of weights) {
      const score = Math.max(0, Math.min(100, Number(aiContent.scores?.[w.key] ?? 50)));
      criteriaScores[w.key] = score;
      weightedSum += score * w.weight;
      totalWeight += w.weight;
    }

    const finalScore = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;

    // Base decision
    let decision: string;
    let nextAction: string;

    if (finalScore >= approveThreshold) {
      decision = "approved_next_stage";
      nextAction = "advance_phase";
    } else if (finalScore <= rejectThreshold) {
      decision = "rejected";
      nextAction = "end_process";
    } else if (finalScore >= (approveThreshold + rejectThreshold) / 2) {
      decision = "escalate_human";
      nextAction = "notify_admin";
    } else {
      decision = "repeat_stage";
      nextAction = "send_educational_content";
    }

    // Apply governance overrides
    const governanceOverrides: string[] = [];

    // 1. If autonomy is "suggest", always escalate
    if (governance.ai_max_autonomy === "suggest" && decision !== "escalate_human") {
      governanceOverrides.push(`autonomy_mode_suggest: ${decision} -> escalate_human`);
      decision = "escalate_human";
      nextAction = "notify_admin";
    }

    // 2. If require_human_validation, force escalation on approve/reject
    if (governance.require_human_validation && (decision === "approved_next_stage" || decision === "rejected")) {
      governanceOverrides.push(`require_human_validation: ${decision} -> escalate_human`);
      decision = "escalate_human";
      nextAction = "notify_admin";
    }

    // 3. If IA cannot reject and decision is rejected
    if (!governance.ai_elimination_allowed && decision === "rejected") {
      governanceOverrides.push(`ai_elimination_blocked: rejected -> escalate_human`);
      decision = "escalate_human";
      nextAction = "notify_admin";

      // ===== FIX #5: Generate ai_decision_blocked security alert =====
      const { data: adminUsers } = await supabase
        .from("user_roles")
        .select("user_id")
        .in("role", ["admin", "rh_franqueadora"]);

      if (adminUsers) {
        for (const admin of adminUsers) {
          await supabase.from("notifications").insert({
            event_type: "ai_decision_blocked",
            recipient_id: admin.user_id,
            channel: "push",
            title: "IA bloqueada: tentativa de eliminação",
            body: `A IA tentou eliminar um candidato (score ${finalScore}), mas foi bloqueada pela regra ai_elimination_allowed=false. Decisão escalada para revisão humana.`,
            status: "pending",
            action_url: "/admin/ia",
            action_type: "action_required",
            payload: { application_id, score: finalScore, step_response_id },
          });
        }
      }
    }

    // 4. Score margin escalation
    const margin = governance.escalation_score_margin;
    if (margin > 0) {
      const nearApprove = Math.abs(finalScore - approveThreshold) <= margin && finalScore < approveThreshold;
      const nearReject = Math.abs(finalScore - rejectThreshold) <= margin && finalScore > rejectThreshold;
      if ((nearApprove || nearReject) && decision !== "escalate_human") {
        governanceOverrides.push(`score_margin_${margin}pts: ${decision} -> escalate_human (score=${finalScore})`);
        decision = "escalate_human";
        nextAction = "notify_admin";
      }
    }

    // 5. Inconsistency check
    if (governance.escalation_on_inconsistency) {
      const scores = Object.values(criteriaScores);
      const maxScore = Math.max(...scores);
      const minScore = Math.min(...scores);
      if (maxScore - minScore > 30 && decision !== "escalate_human") {
        governanceOverrides.push(`inconsistency_detected: spread=${maxScore - minScore}pts, ${decision} -> escalate_human`);
        decision = "escalate_human";
        nextAction = "notify_admin";
      }
    }

    // ===== FIX #3: Risk keywords detection =====
    if (governance.escalation_on_risk_keywords) {
      const responseText = candidateResponse.toLowerCase();
      const detectedKeywords: string[] = [];
      for (const kw of DEFAULT_RISK_KEYWORDS) {
        if (responseText.includes(kw.toLowerCase())) {
          detectedKeywords.push(kw);
        }
      }
      if (detectedKeywords.length > 0 && decision !== "escalate_human") {
        governanceOverrides.push(`risk_keywords_detected: [${detectedKeywords.join(", ")}], ${decision} -> escalate_human`);
        decision = "escalate_human";
        nextAction = "notify_admin";
      }
    }

    // ai_force_human — force human escalation when enabled (canonical source: ai_governance)
    const aiForceHuman = getGov("ai_force_human", false) || getConfig("ai_force_human", false);
    if ((aiForceHuman === true || aiForceHuman === "true") && decision !== "escalate_human") {
      governanceOverrides.push(`ai_force_human: ${decision} -> escalate_human`);
      decision = "escalate_human";
      nextAction = "notify_admin";
    }

    // ===== FIX #4: Notify admins on ANY governance override =====
    if (governanceOverrides.length > 0) {
      const { data: adminUsers } = await supabase
        .from("user_roles")
        .select("user_id")
        .in("role", ["admin", "rh_franqueadora"]);

      if (adminUsers) {
        for (const admin of adminUsers) {
          await supabase.from("notifications").insert({
            event_type: "ai_threshold_crossed",
            recipient_id: admin.user_id,
            channel: "push",
            title: "Governança IA: decisão escalada",
            body: `A IA teve sua decisão modificada por ${governanceOverrides.length} regra(s) de governança. Score: ${finalScore}. Overrides: ${governanceOverrides[0]}`,
            status: "pending",
            action_url: "/admin/ia",
            action_type: "action_required",
            payload: {
              application_id,
              score: finalScore,
              overrides: governanceOverrides,
              step_response_id,
            },
          });
        }
      }
    }

    // ai_weight_percent — ponderate AI score (ai_governance.ai_default_weight é fonte primária)
    const aiWeightPercent = Math.max(0, Math.min(100, Number(getGov("ai_default_weight", null) ?? getConfig("ai_weight_percent", 100))));
    const weightedFinalScore = aiWeightPercent < 100
      ? Math.round(finalScore * (aiWeightPercent / 100))
      : finalScore;

    const strengths = aiContent.strengths || [];
    const risks = aiContent.risks || [];
    const explanation = aiContent.explanation ||
      `Score ${weightedFinalScore}. ${decision === "approved_next_stage" ? "Apto." : decision === "rejected" ? "Reprovado." : "Avaliação intermediária."}`;

    const processingTime = Date.now() - startTime;
    const tokensUsed = openaiResult.usage?.total_tokens || 0;

    // Save evaluation with weighted score
    const { data: evaluation, error: evalErr } = await supabase
      .from("ai_evaluations")
      .insert({
        step_response_id,
        application_id,
        criteria_scores: criteriaScores,
        final_score: weightedFinalScore,
        decision,
        strengths,
        risks,
        explanation: aiWeightPercent < 100
          ? `${explanation} [Score IA ponderado: ${aiWeightPercent}% de ${finalScore} = ${weightedFinalScore}]`
          : explanation,
        prompt_version: promptVersion ? `v${promptVersion.version}` : "default",
        model_provider: "openai",
        model_version: governance.ai_model_default,
        processing_time_ms: processingTime,
      })
      .select()
      .single();

    if (evalErr) {
      return new Response(JSON.stringify({ error: "Failed to save evaluation" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update step_response score with weighted value
    await supabase
      .from("step_responses")
      .update({ score: weightedFinalScore, evaluated_at: new Date().toISOString() })
      .eq("id", step_response_id);

    // Get candidate CPF for audit logs
    const { data: appData } = await supabase
      .from("applications")
      .select("candidate_id, profiles:candidate_id(cpf)")
      .eq("id", application_id)
      .single();

    const candidateCpf = (appData as any)?.profiles?.cpf;

    if (candidateCpf) {
      // Check if AI decision logging is enabled
      const shouldLog = await shouldLogAIDecision();
      if (shouldLog) {
        await supabase.from("ai_decision_logs").insert({
          cpf: candidateCpf,
          module: "recrutamento",
          input: {
            system_prompt: systemPrompt.slice(0, 500),
            candidate_response: candidateResponse.slice(0, 500),
            step_title: stepTitle,
          },
          output: {
            ...aiContent,
            governance_overrides: governanceOverrides.length > 0 ? governanceOverrides : undefined,
            final_decision: decision,
            original_scores: criteriaScores,
            ai_weight_percent: aiWeightPercent,
          },
          decision_type: decision === "rejected" ? "bloqueio" : decision === "approved_next_stage" ? "recomendacao" : "analise",
          model_provider: "openai",
          model_version: governance.ai_model_default,
          application_id,
          evaluation_id: evaluation.id,
          actor_id: ctx.userId,
          processing_time_ms: processingTime,
        });
      }

      // Insert cpf_history
      await supabase.from("cpf_history").insert({
        cpf: candidateCpf,
        event: "avaliacao_ia",
        source_module: "recrutamento",
        metadata: {
          score: finalScore,
          decision,
          step: stepTitle,
          evaluation_id: evaluation.id,
          governance_overrides: governanceOverrides,
        },
        actor_id: ctx.userId,
      });

      // Insert candidate_progress_logs
      await supabase.from("candidate_progress_logs").insert({
        candidate_id: (appData as any)?.candidate_id,
        application_id,
        phase: stepTitle,
        score: finalScore,
        decision: decision === "approved_next_stage" ? "aprovado" : decision === "rejected" ? "standby" : "escalar",
        rule_applied: `ai_evaluation:approve=${approveThreshold},reject=${rejectThreshold},min_ia=${minScoreIaInterview}`,
        metadata: {
          governance_overrides: governanceOverrides,
          criteria_scores: criteriaScores,
          evaluation_id: evaluation.id,
        },
      });
    }

    return new Response(
      JSON.stringify({
        final_score: weightedFinalScore,
        raw_ai_score: finalScore,
        ai_weight_percent: aiWeightPercent,
        decision,
        strengths,
        risks,
        next_action: nextAction,
        explanation,
        criteria_scores: criteriaScores,
        evaluation_id: evaluation.id,
        tokens_used: tokensUsed,
        governance_overrides: governanceOverrides.length > 0 ? governanceOverrides : undefined,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("evaluate-candidate error:", err);
    return new Response(JSON.stringify({ error: "An error occurred. Please try again." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}, { allowedRoles: ["admin", "rh_franqueadora"] }));
