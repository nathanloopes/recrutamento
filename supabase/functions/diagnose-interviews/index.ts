import { corsHeaders, createAdminClient } from "../_shared/cors.ts";
import { withAuth } from "../_shared/with-auth.ts";

Deno.serve(withAuth(async (req, ctx) => {
  try {
    const supabase = createAdminClient();
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "OpenAI not configured" }), {
        status: 500, headers: corsHeaders,
      });
    }

    const { unit_id } = await req.json();

    // Determine scope: admin/rh_franqueadora veem tudo; demais (franqueado) limitam às unidades vinculadas
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
    const { data: isRH } = await supabase.rpc("has_role", { _user_id: ctx.userId, _role: "rh_franqueadora" });
    const isGlobal = !!isAdmin || !!isRH;

    let allowedUnitIds: string[] | null = null;
    if (!isGlobal) {
      const { data: links } = await supabase
        .from("user_roles")
        .select("unit_id")
        .eq("user_id", ctx.userId)
        .not("unit_id", "is", null);
      allowedUnitIds = Array.from(new Set((links || []).map((l: any) => l.unit_id).filter(Boolean)));
      if (allowedUnitIds.length === 0) {
        return new Response(JSON.stringify({
          diagnostico: "Você não possui unidades vinculadas para análise.",
          recomendacoes: [],
          metricas: {},
        }), { status: 200, headers: corsHeaders });
      }
      // Se foi pedida uma unidade específica que não pertence ao usuário, bloqueia
      if (unit_id && !allowedUnitIds.includes(unit_id)) {
        return new Response(JSON.stringify({ error: "forbidden_unit" }), {
          status: 403, headers: corsHeaders,
        });
      }
    }

    // Fetch interview data for analysis
    let q = supabase
      .from("interviews")
      .select("id, status, scheduled_date, scheduled_time, modality, unit_id, units(name, city, state)")
      .order("scheduled_date", { ascending: false })
      .limit(500);

    if (unit_id) {
      q = q.eq("unit_id", unit_id);
    } else if (allowedUnitIds) {
      q = q.in("unit_id", allowedUnitIds);
    }

    const { data: interviews, error: intErr } = await q;
    if (intErr) throw intErr;

    if (!interviews?.length) {
      return new Response(JSON.stringify({
        diagnostico: "Sem dados suficientes para análise.",
        recomendacoes: [],
        metricas: {},
      }), { status: 200, headers: corsHeaders });
    }

    // Calculate metrics for the prompt
    const total = interviews.length;
    const concluidas = interviews.filter((i: any) => i.status === "concluida").length;
    const noShows = interviews.filter((i: any) => i.status === "no_show").length;
    const canceladas = interviews.filter((i: any) => i.status === "cancelada").length;
    const remarcadas = interviews.filter((i: any) => i.status === "remarcada").length;

    // Group by unit
    const unitMap = new Map<string, any>();
    for (const i of interviews) {
      const uid = i.unit_id;
      if (!unitMap.has(uid)) {
        unitMap.set(uid, {
          name: (i.units as any)?.name || "—",
          total: 0, noShows: 0, canceladas: 0, concluidas: 0,
        });
      }
      const u = unitMap.get(uid);
      u.total++;
      if (i.status === "no_show") u.noShows++;
      if (i.status === "cancelada") u.canceladas++;
      if (i.status === "concluida") u.concluidas++;
    }

    // Group by day of week
    const dayStats: Record<number, { total: number; noShows: number }> = {};
    for (const i of interviews) {
      const d = new Date(i.scheduled_date + "T12:00:00");
      const dow = d.getDay();
      if (!dayStats[dow]) dayStats[dow] = { total: 0, noShows: 0 };
      dayStats[dow].total++;
      if (i.status === "no_show") dayStats[dow].noShows++;
    }

    // Group by time slot
    const timeStats: Record<string, { total: number; noShows: number }> = {};
    for (const i of interviews) {
      const hour = i.scheduled_time?.slice(0, 2) || "00";
      const slot = `${hour}:00`;
      if (!timeStats[slot]) timeStats[slot] = { total: 0, noShows: 0 };
      timeStats[slot].total++;
      if (i.status === "no_show") timeStats[slot].noShows++;
    }

    const unitSummary = Array.from(unitMap.entries()).map(([id, u]) => ({
      name: u.name,
      total: u.total,
      noShowRate: u.total > 0 ? Math.round((u.noShows / u.total) * 100) : 0,
      cancelRate: u.total > 0 ? Math.round((u.canceladas / u.total) * 100) : 0,
    }));

    const days = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
    const daySummary = Object.entries(dayStats).map(([d, s]) => ({
      day: days[Number(d)],
      noShowRate: s.total > 0 ? Math.round((s.noShows / s.total) * 100) : 0,
    }));

    const timeSummary = Object.entries(timeStats)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([t, s]) => ({
        time: t,
        noShowRate: s.total > 0 ? Math.round((s.noShows / s.total) * 100) : 0,
      }));

    const prompt = `Você é o RecrutaBot, assistente de IA do sistema de recrutamento Recruta.
Analise os dados de entrevistas abaixo e forneça um diagnóstico operacional em português brasileiro.

MÉTRICAS GERAIS:
- Total de entrevistas: ${total}
- Concluídas: ${concluidas} (${Math.round((concluidas / total) * 100)}%)
- No-shows: ${noShows} (${Math.round((noShows / total) * 100)}%)
- Canceladas: ${canceladas} (${Math.round((canceladas / total) * 100)}%)
- Remarcadas: ${remarcadas} (${Math.round((remarcadas / total) * 100)}%)

POR UNIDADE:
${JSON.stringify(unitSummary, null, 2)}

POR DIA DA SEMANA:
${JSON.stringify(daySummary, null, 2)}

POR HORÁRIO:
${JSON.stringify(timeSummary, null, 2)}

Responda em JSON com esta estrutura:
{
  "diagnostico": "texto resumo geral da saúde das entrevistas",
  "padroes_identificados": ["padrão 1", "padrão 2"],
  "unidades_criticas": [{"nome": "...", "problema": "...", "sugestao": "..."}],
  "recomendacoes": ["recomendação 1", "recomendação 2", "recomendação 3"],
  "horarios_problematicos": ["horário com alto no-show"],
  "dias_problematicos": ["dia com alto no-show"],
  "score_saude": 0-100
}`;

    const startTime = Date.now();
    const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        response_format: { type: "json_object" },
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text().catch(() => "");
      console.error("[diagnose-interviews] OpenAI error", aiResponse.status, errText);
      return new Response(JSON.stringify({
        error: `OpenAI ${aiResponse.status}: ${errText.slice(0, 300)}`,
      }), { status: 500, headers: corsHeaders });
    }

    const aiResult = await aiResponse.json();
    const processingTime = Date.now() - startTime;
    const content = aiResult.choices?.[0]?.message?.content || "{}";
    let parsed;
    try { parsed = JSON.parse(content); } catch { parsed = { diagnostico: content, recomendacoes: [] }; }

    // Log AI decision
    await supabase.from("ai_decision_logs").insert({
      cpf: "sistema",
      module: "agenda_diagnostico",
      decision_type: "diagnostico_agenda",
      model_provider: "openai",
      model_version: "gpt-4o-mini",
      processing_time_ms: processingTime,
      input: { total, concluidas, noShows, canceladas, remarcadas, unit_id: unit_id || "all" },
      output: parsed,
    } as any);

    return new Response(JSON.stringify({
      ...parsed,
      metricas: { total, concluidas, noShows, canceladas, remarcadas },
      processing_time_ms: processingTime,
    }), { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error("diagnose-interviews error:", err);
    return new Response(JSON.stringify({ error: "Erro ao gerar diagnóstico." }), {
      status: 500, headers: corsHeaders,
    });
  }
}, { allowedRoles: ["admin", "rh_franqueadora", "franqueado"] }));
