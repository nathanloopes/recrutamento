import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withAuth } from "../_shared/with-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY not configured");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { prompt_text, candidate_response, weights } = await req.json();

    if (!prompt_text || !candidate_response) {
      return new Response(
        JSON.stringify({ error: "prompt_text and candidate_response are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Load governance settings
    const { data: govSettings } = await supabase
      .from("global_settings")
      .select("key, value")
      .eq("category", "ai_governance");

    const getGov = (key: string, fallback: any) => {
      const s = govSettings?.find((s: any) => s.key === key);
      return s ? parseGovValue(s.value, fallback) : fallback;
    };

    const aiModel = getGov("ai_model_default", "gpt-4o-mini");
    const requireHumanValidation = getGov("require_human_validation", false);
    const aiEliminationAllowed = getGov("ai_elimination_allowed", true);
    const escalationScoreMargin = Number(getGov("escalation_score_margin", 10));
    const escalationOnInconsistency = getGov("escalation_on_inconsistency", true);
    const aiMaxAutonomy = getGov("ai_max_autonomy", "suggest");

    const criteriaWeights = weights || {
      communication: 25,
      clarity: 25,
      coherence: 25,
      role_fit: 25,
    };

    const startTime = Date.now();

    // Call OpenAI with dynamic model
    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: aiModel,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: prompt_text + "\n\nResponda APENAS em formato JSON." },
          {
            role: "user",
            content: `Resposta do candidato (SIMULAÇÃO):\n${candidate_response}\n\nRetorne sua avaliação em JSON.`,
          },
        ],
      }),
    });

    if (!openaiResponse.ok) {
      const errBody = await openaiResponse.text();
      console.error("OpenAI API error:", errBody);
      throw new Error(`OpenAI API error [${openaiResponse.status}]`);
    }

    const openaiResult = await openaiResponse.json();
    const rawContent = openaiResult.choices?.[0]?.message?.content;
    if (!rawContent) throw new Error("AI returned empty response");
    const aiContent = JSON.parse(rawContent);

    // Calculate weighted score
    const criteriaScores: Record<string, number> = {};
    let weightedSum = 0;
    let totalWeight = 0;

    for (const [key, weight] of Object.entries(criteriaWeights)) {
      const score = Math.max(0, Math.min(100, Number(aiContent.scores?.[key] ?? 50)));
      criteriaScores[key] = score;
      weightedSum += score * Number(weight);
      totalWeight += Number(weight);
    }

    const finalScore = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;

    // Load thresholds from config
    const { data: aiSettings } = await supabase
      .from("global_settings")
      .select("key, value")
      .eq("category", "ai");

    const getConfig = (key: string, fallback: number) => {
      const s = aiSettings?.find((s: any) => s.key === key);
      return s ? Number(s.value) : fallback;
    };

    const approveThreshold = getConfig("auto_approve_threshold", 85);
    const rejectThreshold = getConfig("auto_reject_threshold", 40);

    // Base decision
    let decision: string;
    if (finalScore >= approveThreshold) {
      decision = "approved_next_stage";
    } else if (finalScore <= rejectThreshold) {
      decision = "rejected";
    } else if (finalScore >= (approveThreshold + rejectThreshold) / 2) {
      decision = "escalate_human";
    } else {
      decision = "repeat_stage";
    }

    // Apply governance overrides (same as evaluate-candidate)
    const governanceOverrides: string[] = [];

    if (aiMaxAutonomy === "suggest" && decision !== "escalate_human") {
      governanceOverrides.push(`autonomy_mode_suggest: ${decision} -> escalate_human`);
      decision = "escalate_human";
    }

    if (requireHumanValidation && (decision === "approved_next_stage" || decision === "rejected")) {
      governanceOverrides.push(`require_human_validation: ${decision} -> escalate_human`);
      decision = "escalate_human";
    }

    if (!aiEliminationAllowed && decision === "rejected") {
      governanceOverrides.push(`ai_elimination_blocked: rejected -> escalate_human`);
      decision = "escalate_human";
    }

    if (escalationScoreMargin > 0) {
      const nearApprove = Math.abs(finalScore - approveThreshold) <= escalationScoreMargin && finalScore < approveThreshold;
      const nearReject = Math.abs(finalScore - rejectThreshold) <= escalationScoreMargin && finalScore > rejectThreshold;
      if ((nearApprove || nearReject) && decision !== "escalate_human") {
        governanceOverrides.push(`score_margin_${escalationScoreMargin}pts: ${decision} -> escalate_human`);
        decision = "escalate_human";
      }
    }

    if (escalationOnInconsistency) {
      const scores = Object.values(criteriaScores);
      const maxScore = Math.max(...scores);
      const minScore = Math.min(...scores);
      if (maxScore - minScore > 30 && decision !== "escalate_human") {
        governanceOverrides.push(`inconsistency_detected: spread=${maxScore - minScore}pts`);
        decision = "escalate_human";
      }
    }

    const processingTime = Date.now() - startTime;

    // Log simulation in activity_logs (no real data persisted)
    await supabase.from("activity_logs").insert({
      user_id: ctx.userId,
      action: "simulacao_ia",
      module: "ia_governanca",
      details: {
        final_score: finalScore,
        decision,
        processing_time_ms: processingTime,
        model_used: aiModel,
        governance_overrides: governanceOverrides,
      },
    });

    return new Response(
      JSON.stringify({
        final_score: finalScore,
        decision,
        criteria_scores: criteriaScores,
        strengths: aiContent.strengths || [],
        risks: aiContent.risks || [],
        explanation: aiContent.explanation || "",
        processing_time_ms: processingTime,
        tokens_used: openaiResult.usage?.total_tokens || 0,
        model_used: aiModel,
        governance_overrides: governanceOverrides.length > 0 ? governanceOverrides : undefined,
        sandbox: true,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("simulate-evaluation error:", err);
    return new Response(JSON.stringify({ error: "An error occurred. Please try again." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}, { allowedRoles: ["admin", "rh_franqueadora"] }));
