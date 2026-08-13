import { withAuth } from "../_shared/with-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";

/**
 * Edge Function: audit-ai-analysis
 * Item 24 — AI audit functions (risk detection, prod alerts, monthly report)
 *
 * Supports 3 analysis types:
 * - "risk_detection": Analyzes recent activity/audit logs for anomalies
 * - "prod_alert": Checks for critical production issues
 * - "monthly_report": Generates monthly compliance/activity report
 */

interface AuditAIRequest {
  analysis_type: "risk_detection" | "prod_alert" | "monthly_report";
  date_from?: string;
  date_to?: string;
}

Deno.serve(withAuth(async (req, ctx) => {
  const startTime = Date.now();

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY not configured" }), {
        status: 500, headers: corsHeaders,
      });
    }

    const { analysis_type, date_from, date_to }: AuditAIRequest = await req.json();
    if (!analysis_type) {
      return new Response(JSON.stringify({ error: "analysis_type required" }), {
        status: 400, headers: corsHeaders,
      });
    }

    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const fromDate = date_from || defaultFrom;
    const toDate = date_to || now.toISOString();

    let systemPrompt = "";
    let contextData: any = {};

    if (analysis_type === "risk_detection") {
      // Fetch recent audit trail entries with unusual patterns
      const { data: auditLogs } = await ctx.admin
        .from("audit_trail")
        .select("action, actor_id, target_type, context, created_at, ip_address")
        .gte("created_at", fromDate)
        .lte("created_at", toDate)
        .order("created_at", { ascending: false })
        .limit(500);

      // Fetch config changes
      const { data: configChanges } = await ctx.admin
        .from("config_audit_logs")
        .select("category, key, old_value, new_value, changed_by, changed_at, reason")
        .gte("changed_at", fromDate)
        .lte("changed_at", toDate)
        .order("changed_at", { ascending: false })
        .limit(200);

      // Fetch failed automation logs
      const { data: failedAutomations } = await ctx.admin
        .from("automation_logs")
        .select("event_name, action_type, action_result, error_message, executed_at")
        .eq("action_result", "falha")
        .gte("executed_at", fromDate)
        .lte("executed_at", toDate)
        .limit(100);

      contextData = {
        audit_logs_count: (auditLogs || []).length,
        audit_logs_sample: (auditLogs || []).slice(0, 50),
        config_changes: configChanges || [],
        failed_automations: failedAutomations || [],
      };

      systemPrompt = `Você é um analista de segurança para um sistema de recrutamento corporativo.
Analise os logs de auditoria e identifique riscos. Responda em JSON:
{
  "risk_level": "low" | "medium" | "high" | "critical",
  "anomalies": [{ "type": "string", "description": "string", "severity": "string", "evidence": "string" }],
  "suspicious_actors": [{ "actor_id": "string", "reason": "string", "action_count": number }],
  "config_risks": [{ "change": "string", "risk": "string" }],
  "automation_failures": { "count": number, "patterns": ["string"] },
  "recommendations": ["string"],
  "summary": "resumo executivo em 2-3 frases"
}`;

    } else if (analysis_type === "prod_alert") {
      // Check for critical issues in the last 24 hours
      const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

      const { data: recentErrors } = await ctx.admin
        .from("automation_logs")
        .select("*")
        .eq("action_result", "falha")
        .gte("executed_at", last24h)
        .limit(50);

      const { data: recentAudit } = await ctx.admin
        .from("audit_trail")
        .select("action, actor_id, context, created_at")
        .gte("created_at", last24h)
        .order("created_at", { ascending: false })
        .limit(100);

      // Check stuck candidates
      const { data: stuckApps } = await ctx.admin
        .from("applications")
        .select("id, status, updated_at")
        .in("status", ["em_analise", "pendente"])
        .lt("updated_at", new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .limit(50);

      contextData = {
        recent_errors: recentErrors || [],
        recent_audit_count: (recentAudit || []).length,
        recent_audit_sample: (recentAudit || []).slice(0, 20),
        stuck_applications: (stuckApps || []).length,
      };

      systemPrompt = `Você é um monitor de produção para um sistema de recrutamento.
Analise os dados das últimas 24h e identifique problemas críticos. Responda em JSON:
{
  "status": "healthy" | "warning" | "critical",
  "alerts": [{ "severity": "warning" | "critical", "title": "string", "description": "string", "action_required": "string" }],
  "error_patterns": [{ "pattern": "string", "count": number, "impact": "string" }],
  "stuck_processes": { "count": number, "recommendation": "string" },
  "system_health_score": 0-100,
  "summary": "resumo em 1-2 frases"
}`;

    } else if (analysis_type === "monthly_report") {
      // Gather monthly stats
      const { data: totalApps } = await ctx.admin
        .from("applications")
        .select("id, status, created_at")
        .gte("created_at", fromDate)
        .lte("created_at", toDate);

      const { data: totalInterviews } = await ctx.admin
        .from("interviews")
        .select("id, status, created_at")
        .gte("created_at", fromDate)
        .lte("created_at", toDate);

      const { data: aiEvals } = await ctx.admin
        .from("ai_evaluations")
        .select("final_score, decision, created_at")
        .gte("created_at", fromDate)
        .lte("created_at", toDate);

      const { data: automationRuns } = await ctx.admin
        .from("automation_logs")
        .select("action_result, executed_at")
        .gte("executed_at", fromDate)
        .lte("executed_at", toDate);

      const { data: configChanges } = await ctx.admin
        .from("config_audit_logs")
        .select("category, key, changed_at")
        .gte("changed_at", fromDate)
        .lte("changed_at", toDate);

      const statusBreakdown: Record<string, number> = {};
      (totalApps || []).forEach((a: any) => {
        statusBreakdown[a.status] = (statusBreakdown[a.status] || 0) + 1;
      });

      const automationSuccess = (automationRuns || []).filter((r: any) => r.action_result === "sucesso").length;
      const automationFail = (automationRuns || []).filter((r: any) => r.action_result === "falha").length;

      contextData = {
        period: { from: fromDate, to: toDate },
        applications: { total: (totalApps || []).length, by_status: statusBreakdown },
        interviews: { total: (totalInterviews || []).length },
        ai_evaluations: {
          total: (aiEvals || []).length,
          avg_score: (aiEvals || []).length > 0
            ? Math.round((aiEvals || []).reduce((s: number, e: any) => s + (e.final_score || 0), 0) / (aiEvals || []).length)
            : 0,
        },
        automations: { total: (automationRuns || []).length, success: automationSuccess, failures: automationFail },
        config_changes: (configChanges || []).length,
      };

      systemPrompt = `Você é um analista de dados de RH gerando um relatório mensal de conformidade.
Analise os dados do período e gere um relatório estruturado em JSON:
{
  "periodo": "string",
  "resumo_executivo": "3-4 frases resumindo o mês",
  "kpis": {
    "candidaturas_total": number,
    "taxa_aprovacao": "X%",
    "entrevistas_realizadas": number,
    "score_ia_medio": number,
    "automacoes_sucesso_rate": "X%",
    "alteracoes_config": number
  },
  "tendencias": ["lista de tendências observadas"],
  "riscos_identificados": ["lista de riscos"],
  "recomendacoes": ["lista de recomendações"],
  "compliance_score": 0-100,
  "destaques": ["3 destaques positivos do período"]
}`;
    } else {
      return new Response(JSON.stringify({ error: "Invalid analysis_type" }), {
        status: 400, headers: corsHeaders,
      });
    }

    // Call OpenAI
    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        max_tokens: 2000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt + "\n\nResponda APENAS em JSON válido." },
          { role: "user", content: `Dados para análise:\n${JSON.stringify(contextData, null, 2)}` },
        ],
      }),
    });

    if (!openaiResponse.ok) {
      const errBody = await openaiResponse.text();
      console.error("[audit-ai-analysis] OpenAI error:", errBody);
      throw new Error("AI audit service unavailable");
    }

    const aiResult = await openaiResponse.json();
    const rawContent = aiResult.choices?.[0]?.message?.content;
    if (!rawContent) throw new Error("AI returned empty response");
    const analysis = JSON.parse(rawContent);

    const processingTime = Date.now() - startTime;

    // Log the analysis
    await ctx.admin.from("activity_logs").insert({
      user_id: ctx.userId,
      action: `ai_audit_${analysis_type}`,
      module: "auditoria",
      details: {
        analysis_type,
        date_range: { from: fromDate, to: toDate },
        result_summary: analysis.summary || analysis.resumo_executivo || "Analysis completed",
        processing_time_ms: processingTime,
      },
    });

    // For critical risk detection or prod alerts, create notifications for admins
    if (
      (analysis_type === "risk_detection" && analysis.risk_level === "critical") ||
      (analysis_type === "prod_alert" && analysis.status === "critical")
    ) {
      const { data: adminRoles } = await ctx.admin
        .from("user_roles")
        .select("user_id")
        .eq("role", "admin")
        .limit(10);

      for (const ar of (adminRoles || []) as any[]) {
        await ctx.admin.from("notifications").insert({
          event_type: "ai_audit_critical",
          recipient_id: ar.user_id,
          channel: "push",
          title: analysis_type === "risk_detection" ? "⚠️ Risco Crítico Detectado" : "🚨 Alerta de Produção",
          body: analysis.summary || analysis.resumo_executivo || "Análise de IA detectou problema crítico",
          status: "pending",
          action_url: "/admin/auditoria",
          action_type: "alert",
        });
      }
    }

    return new Response(JSON.stringify({
      analysis_type,
      analysis,
      processing_time_ms: processingTime,
    }), {
      status: 200, headers: corsHeaders,
    });
  } catch (err) {
    console.error("[audit-ai-analysis] Error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message || "Internal error" }), {
      status: 500, headers: corsHeaders,
    });
  }
}, { allowedRoles: ["admin", "rh_franqueadora"] }));
