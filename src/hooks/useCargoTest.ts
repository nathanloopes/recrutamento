import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { dispatchAutomationEvent } from "@/lib/automationEngine";

/**
 * Hook para o fluxo de teste por cargo (sem application).
 * Lê o pipeline do cargo, apresenta as etapas, avalia e armazena resultado.
 */

function formatTemplateLabel(value?: string | null) {
  if (!value) return "";
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildVirtualPipelineFromTemplates(jobId: string, templates: any[]) {
  const orderedTemplates = [...templates].sort(
    (a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
  );

  const phases = orderedTemplates.map((tpl: any, tplIdx: number) => {
    // Voice template → single step with full voice experience
    if (tpl.type === "voice") {
      const questions = Array.isArray((tpl.content as any)?.questions) ? (tpl.content as any).questions : [];
      const steps = [{
        id: `${tpl.id}-voice`,
        title: tpl.title || `Avaliação por Voz ${tplIdx + 1}`,
        type: "voice",
        execution_mode: (tpl as any).execution_mode || "form",
        content: {
          questions: questions.map((q: any, qi: number) => ({
            id: q?.id || `vq_${qi}`,
            text: q?.text || q?.question || `Pergunta ${qi + 1}`,
            max_seconds: q?.max_seconds || 120,
            rubric: q?.rubric || "",
            weight: q?.weight || 1,
          })),
          allow_repeat: (tpl.content as any)?.allow_repeat ?? true,
          consent_text: (tpl.content as any)?.consent_text,
        },
        weight: 1,
        order_index: 0,
        conditions: null,
      }];

      const categoryLabel = formatTemplateLabel(tpl.category);
      const subcategoryLabel = formatTemplateLabel(tpl.subcategory);

      return {
        id: `phase-tt-${tpl.id}`,
        name: [categoryLabel, subcategoryLabel].filter(Boolean).join(" • ") || tpl.title || `Avaliação ${tplIdx + 1}`,
        order_index: tplIdx,
        min_score: 60,
        phase_kind: "avaliacao",
        weight: 1,
        pipeline_steps: steps,
      };
    }

    // Quiz/text templates → existing logic
    const questions = Array.isArray((tpl.content as any)?.questions) ? (tpl.content as any).questions : [];

    const steps = questions.map((q: any, qIdx: number) => {
      const prompt = q?.text || q?.question || `Questão ${qIdx + 1}`;

      const rawOptions = Array.isArray(q?.options) ? q.options : [];
      const normalizedOptions = rawOptions
        .map((opt: any, oi: number) => {
          if (typeof opt === "string") {
            return {
              text: opt,
              correct: typeof q?.correct === "number" ? q.correct === oi : false,
            };
          }

          return {
            text: opt?.text || "",
            correct:
              typeof opt?.correct === "boolean"
                ? opt.correct
                : typeof q?.correct === "number"
                  ? q.correct === oi
                  : false,
          };
        })
        .filter((opt: any) => Boolean(opt.text?.trim()));

      const isVoice =
        q?.type === "voice" ||
        q?.type === "voice_question";

      const isEssay =
        !isVoice && (
        q?.type === "essay" ||
        q?.type === "text" ||
        q?.type === "texto" ||
        normalizedOptions.length === 0);

      if (isVoice) {
        return {
          id: `${tpl.id}-q${qIdx}`,
          title: prompt,
          type: "voice",
          execution_mode: (tpl as any).execution_mode || "form",
          content: {
            questions: [{
              id: q?.id || `vq_${qIdx}`,
              text: prompt,
              max_seconds: q?.max_seconds || 120,
              rubric: q?.rubric || q?.block || "",
              weight: q?.weight || 1,
            }],
            allow_repeat: true,
          },
          weight: q?.weight || 1,
          order_index: qIdx,
          conditions: null,
        };
      }

      if (isEssay) {
        return {
          id: `${tpl.id}-q${qIdx}`,
          title: prompt,
          type: "texto",
          execution_mode: (tpl as any).execution_mode || "form",
          content: {
            prompt,
            rubric: q?.rubric || "",
          },
          weight: 1,
          order_index: qIdx,
          conditions: null,
        };
      }

      return {
        id: `${tpl.id}-q${qIdx}`,
        title: prompt,
        type: "quiz",
        execution_mode: (tpl as any).execution_mode || "form",
        content: {
          question: prompt,
          options: normalizedOptions,
          rubric: q?.rubric || "",
        },
        weight: 1,
        order_index: qIdx,
        conditions: null,
      };
    });

    const categoryLabel = formatTemplateLabel(tpl.category);
    const subcategoryLabel = formatTemplateLabel(tpl.subcategory);

    return {
      id: `phase-tt-${tpl.id}`,
      name: [categoryLabel, subcategoryLabel].filter(Boolean).join(" • ") || tpl.title || `Avaliação ${tplIdx + 1}`,
      order_index: tplIdx,
      min_score: 60,
        phase_kind: "avaliacao",
      weight: 1,
      pipeline_steps: steps,
    };
  });

  return {
    id: `tt-${jobId}`,
    name: orderedTemplates[0]?.title || "Teste do Cargo",
    _source: "test_template",
    pipeline_phases: phases,
  };
}

// Mapa de áreas conhecidas (compartilhado entre Etapa 2 e ordenação da Etapa 3)
export type KnownAreaKey =
  | "atendimento_vendas"
  | "avaliadora"
  | "social_media"
  | "administrativo"
  | "estoque"
  | "caixa"
  | "servicos_gerais"
  | "tecnologia";

export interface KnownArea {
  key: KnownAreaKey;
  label: string;
  /** Texto reescrito em linguagem de "gosto/atividade" (Etapa 2). */
  activityLabel: string;
  emoji: string;
  keywords: string[];
}

export const KNOWN_AREAS: KnownArea[] = [
  { key: "atendimento_vendas", label: "Atendimento / Vendas",
    activityLabel: "Gosto de conversar e atender pessoas", emoji: "🛍️",
    keywords: ["vendedor", "vendedora", "vendas", "atendente", "atendimento", "consultor"] },
  { key: "avaliadora", label: "Avaliadora",
    activityLabel: "Gosto de cuidar e avaliar com carinho", emoji: "👶",
    keywords: ["avaliador", "avaliadora", "triagem", "avaliação", "avaliacao"] },
  { key: "social_media", label: "Social Media",
    activityLabel: "Gosto de tirar foto e mexer com redes sociais", emoji: "🎥",
    keywords: ["social", "mídia", "midia", "marketing", "conteúdo", "conteudo"] },
  { key: "administrativo", label: "Administrativo",
    activityLabel: "Gosto de organizar e cuidar de processos", emoji: "🧾",
    keywords: ["administrativo", "admin", "financeiro", "recursos humanos", " rh "] },
  { key: "estoque", label: "Estoque",
    activityLabel: "Gosto de organizar produtos e mexer com estoque", emoji: "📦",
    keywords: ["estoque", "estoquista", "logística", "logistica"] },
  { key: "caixa", label: "Caixa",
    activityLabel: "Tenho facilidade com números e atenção aos detalhes", emoji: "💰",
    keywords: ["caixa", "operador de caixa"] },
  { key: "servicos_gerais", label: "Serviços Gerais",
    activityLabel: "Gosto de cuidar do ambiente e ajudar a equipe", emoji: "🧹",
    keywords: ["serviços gerais", "servicos gerais", "limpeza", "auxiliar de limpeza", "zeladoria", "zelador", "zeladora"] },
  { key: "tecnologia", label: "Tecnologia",
    activityLabel: "Gosto de tecnologia e resolver problemas", emoji: "💻",
    keywords: ["desenvolvedor", "desenvolvedora", " ti ", "tech", "ux", "designer", "engenheiro", "engenheira"] },
];

function escapeRegex(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Matching semântico por palavra inteira (não substring).
 * - Keyword simples (sem espaço): usa `\b<kw>\b` — evita casar "ux" dentro de "auxilia".
 * - Keyword composta (com espaço): usa `(^|\W)<kw>($|\W)` — casa expressão inteira
 *   respeitando pontuação nas bordas.
 */
export function hasKeyword(text: string, keyword: string): boolean {
  const normalizedText = (text || "").toLowerCase();
  const normalizedKeyword = (keyword || "").toLowerCase().trim();
  if (!normalizedKeyword) return false;

  if (normalizedKeyword.includes(" ")) {
    const regex = new RegExp(`(^|\\W)${escapeRegex(normalizedKeyword)}($|\\W)`, "i");
    return regex.test(normalizedText);
  }

  const regex = new RegExp(`\\b${escapeRegex(normalizedKeyword)}\\b`, "i");
  return regex.test(normalizedText);
}

export function classifyJobToArea(title?: string | null, description?: string | null, departmentName?: string | null): KnownArea | null {
  const titleHay = ` ${(title || "").toLowerCase()} `;
  const deptHay = ` ${(departmentName || "").toLowerCase()} `;
  const descHay = ` ${(description || "").toLowerCase()} `;

  // Pass 1: título tem prioridade máxima
  for (const area of KNOWN_AREAS) {
    if (area.keywords.some((k) => hasKeyword(titleHay, k))) return area;
  }
  // Pass 2: departamento
  for (const area of KNOWN_AREAS) {
    if (area.keywords.some((k) => hasKeyword(deptHay, k))) return area;
  }
  // Pass 3: descrição (fallback — só dispara se título e departamento falharem)
  for (const area of KNOWN_AREAS) {
    if (area.keywords.some((k) => hasKeyword(descHay, k))) return area;
  }
  return null;
}

export interface OpenArea {
  key: string;
  label: string;
  /** Texto reescrito em linguagem de "gosto/atividade" para a Etapa 2. */
  activityLabel: string;
  emoji: string;
  count: number;
  keywords: string[]; // usado para ordenação na Etapa 3
  isKnown: boolean;
}

// Hook: deriva áreas dinamicamente a partir dos CARGOS realmente visíveis
// ao candidato (mesma regra de visibilidade de useAvailableRoles), garantindo
// que a contagem por área = número de cargos exibidos na Etapa 3.
export function useOpenAreasFromJobs() {
  return useQuery({
    queryKey: ["open_areas_from_jobs"],
    queryFn: async () => {
      // 1) unit_jobs em aberto (apenas para descobrir job_ids candidatos)
      const { data: openUnitJobs, error: ujError } = await supabase
        .from("unit_jobs")
        .select("job_id")
        .eq("status", "aberta" as any);
      if (ujError) throw ujError;

      const jobIdsWithOpenVagas = [...new Set((openUnitJobs || []).map((uj: any) => uj.job_id))];
      if (jobIdsWithOpenVagas.length === 0) {
        return { areas: [] as OpenArea[], totalOpenJobs: 0 };
      }

      // 2) cargos com pipeline ativo
      const { data: activePipelines, error: pipelineError } = await supabase
        .from("job_pipelines")
        .select("job_id")
        .eq("is_active", true)
        .in("job_id", jobIdsWithOpenVagas);
      if (pipelineError) throw pipelineError;

      // 3) Visibilidade restrita: SOMENTE cargos com pipeline ativo aparecem.
      // Templates antigos continuam funcionando como fallback dentro do pipeline,
      // mas o cargo só aparece ao candidato se houver pipeline ativo vinculado.
      const jobsWithPipeline = new Set((activePipelines || []).map((p: any) => p.job_id));
      const jobsWithConfiguredTest = [...jobsWithPipeline];
      if (jobsWithConfiguredTest.length === 0) {
        return { areas: [] as OpenArea[], totalOpenJobs: 0 };
      }

      // 4) carrega cargos visíveis (ativos + com vaga aberta + com teste configurado)
      const { data: visibleJobs, error: jobsError } = await supabase
        .from("jobs")
        .select("id, title, description, departments(name)")
        .eq("is_active", true)
        .in("id", jobIdsWithOpenVagas)
        .in("id", jobsWithConfiguredTest);
      if (jobsError) throw jobsError;

      // 5) classifica cada CARGO (não unit_job) em uma área
      const buckets = new Map<string, OpenArea>();
      let totalOpenJobs = 0;

      for (const job of (visibleJobs || []) as any[]) {
        totalOpenJobs += 1;
        const deptName: string | null = job?.departments?.name ?? null;
        const matched = classifyJobToArea(job?.title, job?.description, deptName);

        if (matched) {
          const cur = buckets.get(matched.key);
          if (cur) cur.count += 1;
          else buckets.set(matched.key, {
            key: matched.key, label: matched.label, activityLabel: matched.activityLabel, emoji: matched.emoji,
            count: 1, keywords: matched.keywords, isKnown: true,
          });
          continue;
        }

        const fallbackLabel = deptName?.trim() || "Outras áreas";
        const fallbackKey = `dyn:${fallbackLabel.toLowerCase()}`;
        const cur = buckets.get(fallbackKey);
        if (cur) cur.count += 1;
        else buckets.set(fallbackKey, {
          key: fallbackKey, label: fallbackLabel, activityLabel: fallbackLabel, emoji: "💼",
          count: 1, keywords: [fallbackLabel.toLowerCase()], isKnown: false,
        });
      }

      const areas = Array.from(buckets.values()).sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.label.localeCompare(b.label);
      });

      return { areas, totalOpenJobs };
    },
  });
}

// Busca cargos ativos disponíveis para teste
export function useAvailableRoles() {
  return useQuery({
    queryKey: ["available_roles"],
    queryFn: async () => {
      // Only return jobs that have at least one open unit_job
      const { data: openUnitJobs, error: ujError } = await supabase
        .from("unit_jobs")
        .select("job_id, closes_at")
        .eq("status", "aberta" as any);
      if (ujError) throw ujError;

      const jobIdsWithOpenVagas = [...new Set((openUnitJobs || []).map((uj: any) => uj.job_id))];
      if (jobIdsWithOpenVagas.length === 0) return [];

      // Compute the nearest future closes_at per job_id
      const nowMs = Date.now();
      const nextClosingByJob = new Map<string, string>();
      for (const uj of openUnitJobs || []) {
        const ca = (uj as any).closes_at as string | null;
        if (!ca) continue;
        const t = new Date(ca).getTime();
        if (isNaN(t) || t < nowMs) continue;
        const current = nextClosingByJob.get((uj as any).job_id);
        if (!current || new Date(current).getTime() > t) {
          nextClosingByJob.set((uj as any).job_id, ca);
        }
      }

      // Jobs com pipeline ativo
      const { data: activePipelines, error: pipelineError } = await supabase
        .from("job_pipelines")
        .select("job_id")
        .eq("is_active", true)
        .in("job_id", jobIdsWithOpenVagas);
      if (pipelineError) throw pipelineError;

      // Visibilidade restrita: SOMENTE cargos com pipeline ativo aparecem.
      const jobsWithPipeline = new Set((activePipelines || []).map((p: any) => p.job_id));
      const jobsWithConfiguredTest = [...jobsWithPipeline];
      if (jobsWithConfiguredTest.length === 0) return [];

      const { data, error } = await supabase
        .from("jobs")
        .select("id, title, description, requires_ai_interview, requires_human_interview, discovery_invite, discovery_traits, discovery_highlights, departments(name)")
        .eq("is_active", true)
        .in("id", jobIdsWithOpenVagas)
        .in("id", jobsWithConfiguredTest)
        .order("title");
      if (error) throw error;
      return (data || []).map((j: any) => ({
        ...j,
        next_closing_at: nextClosingByJob.get(j.id) ?? null,
      }));
    },
  });
}

// Busca o pipeline ativo de um cargo para apresentar o teste
// Prioriza test_templates vinculados ao cargo (com categoria/subcategoria)
// e usa pipeline tradicional como fallback
export function useCargoTestPipeline(jobId: string | undefined) {
  return useQuery({
    queryKey: ["cargo_test_pipeline", jobId],
    enabled: !!jobId,
    queryFn: async () => {
      // 1) PRIORIDADE: pipeline operacional unificado (mescla todos os
      // pipelines ativos do cargo). Garante que qualquer fase configurada
      // pelo admin — em qualquer pipeline ativo — seja executada.
      const { loadOperationalPipeline } = await import("@/lib/operationalPipeline");
      const op = await loadOperationalPipeline(jobId!);

      if (op) {
        const phasesWithSteps = (op.pipeline_phases || []);
        const hasRealSteps = phasesWithSteps.some(
          (ph: any) => Array.isArray(ph.pipeline_steps) && ph.pipeline_steps.length > 0
        );
        if (hasRealSteps) {
          return {
            id: op.id,
            name: op.name,
            pipeline_phases: phasesWithSteps,
          } as any;
        }
      }

      // 2) FALLBACK: pipeline real não existe ou está vazio → usa test_templates legados.
      const { data: templatesAll, error: ttError } = await supabase
        .from("test_templates")
        .select("id, title, type, category, subcategory, content, job_ids, created_at, execution_mode")
        .eq("is_active", true);

      if (ttError) throw ttError;

      const templatesForJob = (templatesAll || []).filter((tpl: any) => {
        const tplJobIds = Array.isArray(tpl.job_ids) ? tpl.job_ids : [];
        const matchesJob = tplJobIds.length === 0 || tplJobIds.includes(jobId!);
        if (!matchesJob) return false;
        const questions = Array.isArray((tpl.content as any)?.questions) ? (tpl.content as any).questions : [];
        return questions.length > 0;
      });

      if (templatesForJob.length > 0) {
        const virtualPipeline = buildVirtualPipelineFromTemplates(jobId!, templatesForJob);
        const hasSteps = virtualPipeline.pipeline_phases.some(
          (ph: any) => ph.pipeline_steps && ph.pipeline_steps.length > 0
        );
        if (hasSteps) return virtualPipeline;
      }

      return null;
    },
  });
}

// Verifica se candidato já fez o teste para um cargo
export function useCandidateTestStatus(jobId: string | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["candidate_test_status", user?.id, jobId],
    enabled: !!user && !!jobId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("talent_pool_entries")
        .select("*")
        .eq("candidate_id", user!.id)
        .maybeSingle();
      if (error) throw error;

      if (!data) return { hasEntry: false, isApproved: false, hasTested: false, score: null };

      // Threshold = min_score do CARGO da vaga (jobs.min_score). Sem fallback hardcoded.
      const { data: jobRow } = await supabase
        .from("jobs")
        .select("min_score")
        .eq("id", jobId)
        .maybeSingle();
      const threshold = jobRow?.min_score ?? null;

      const hasTested = data.last_job_id === jobId && data.test_completed_at != null;
      const isApprovedForJob =
        hasTested &&
        data.test_score != null &&
        threshold != null &&
        data.test_score >= threshold;

      // Se o registro antigo está desatualizado (score >= threshold mas approved_job_id null), corrigir
      if (isApprovedForJob && data.approved_job_id !== jobId) {
        await supabase
          .from("talent_pool_entries")
          .update({ approved_job_id: jobId, status: "active" })
          .eq("id", data.id);
      }

      return {
        hasEntry: true,
        isApproved: isApprovedForJob,
        hasTested,
        score: data.test_score,
        completedAt: data.test_completed_at,
        details: data.test_details,
        entryId: data.id,
        status: data.status,
      };
    },
  });
}

// Lista testes de cargo já concluídos pelo candidato logado
export function useMyCompletedCargoTests() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my_completed_cargo_tests", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data: entry, error } = await supabase
        .from("talent_pool_entries")
        .select("id, test_score, test_completed_at, last_job_id, test_details")
        .eq("candidate_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      if (!entry || !entry.test_completed_at || !entry.last_job_id) return [];

      const { data: job } = await supabase
        .from("jobs")
        .select("id, title")
        .eq("id", entry.last_job_id)
        .maybeSingle();

      return [{
        id: `cargo-${entry.id}`,
        source: "cargo_test" as const,
        status: "corrigido",
        score: entry.test_score,
        completed_at: entry.test_completed_at,
        deadline: null,
        job_title: job?.title || "Cargo",
        test_templates: { title: `Teste do cargo ${job?.title || ""}`.trim() },
      }];
    },
  });
}

// Submete resultado do teste e atualiza talent_pool_entries
export function useSubmitCargoTestResult() {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      jobId,
      score,
      details,
    }: {
      jobId: string;
      score: number;
      details: Record<string, any>;
    }) => {
      if (!user) throw new Error("Não autenticado");

      console.log("[CargoTest] Submit started", { jobId, score, detailKeys: Object.keys(details) });

      // Parallelize independent fetches
      const [jobDataRes, existingRes] = await Promise.all([
        supabase
          .from("jobs")
          .select("title, min_score")
          .eq("id", jobId)
          .maybeSingle(),
        supabase
          .from("talent_pool_entries")
          .select("id")
          .eq("candidate_id", user.id)
          .maybeSingle(),
      ]);

      const threshold = jobDataRes.data?.min_score;
      if (threshold == null) {
        throw new Error("Cargo sem score mínimo configurado. Avise o RH.");
      }
      const isApproved = score >= threshold;
      const jobTitle = jobDataRes.data?.title || "Cargo";
      const existing = existingRes.data;

      console.log("[CargoTest] Threshold:", threshold, "Score:", score, "Approved:", isApproved);

      // Upsert talent_pool_entries
      const entryData: any = {
        candidate_id: user.id,
        approved_job_id: isApproved ? jobId : null,
        test_score: score,
        test_completed_at: new Date().toISOString(),
        test_details: details,
        status: isApproved ? "active" : "on_hold",
        entry_origin: "cargo_test",
        last_interaction: new Date().toISOString(),
        last_job_id: jobId,
      };

      if (existing) {
        const { error } = await supabase
          .from("talent_pool_entries")
          .update(entryData)
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        entryData.global_score = 0;
        const { error } = await supabase
          .from("talent_pool_entries")
          .insert(entryData);
        if (error) throw error;
      }

      console.log("[CargoTest] talent_pool_entries saved");

      // Parallelize score event + activity log
      await Promise.all([
        supabase.rpc("insert_score_event", {
          p_candidate_id: user.id,
          p_event_type: "test_completed",
          p_process_stage: "teste",
          p_related_job_id: jobId,
          p_score_delta: score,
          p_reason: `Teste concluído — ${jobTitle}`,
          p_metadata: { test_details: details, threshold, approved: isApproved },
        }),
        supabase.from("activity_logs").insert({
          user_id: user.id,
          action: "teste_cargo_concluido",
          module: "cargo_test",
          details: { job_id: jobId, score, approved: isApproved, threshold },
        }),
      ]);

      console.log("[CargoTest] Score event + activity log saved");

      // Fire-and-forget: push notifications + automation events
      if (isApproved) {
        (async () => {
          try {
            const { data: pendingNotifs } = await supabase
              .from("notifications")
              .select("id, recipient_id, title, body, action_url")
              .eq("event_type", "candidato_apto_no_raio")
              .eq("status", "pending")
              .contains("payload", { candidate_id: user.id, job_id: jobId });

            if (pendingNotifs?.length) {
              for (const notif of pendingNotifs) {
                supabase.functions.invoke("send-push-notification", {
                  body: {
                    recipient_id: notif.recipient_id,
                    title: notif.title,
                    body: notif.body,
                    notification_id: notif.id,
                    data: { url: notif.action_url },
                  },
                }).catch((err) => console.warn("[CargoTest] Push for notif failed:", err));
              }
            }
          } catch (e) {
            console.error("[CargoTest] Push notification dispatch failed:", e);
          }
        })();

        dispatchAutomationEvent("candidate_approved", {
          candidate_id: user.id, job_id: jobId, score, threshold,
        }).catch((err) => console.error("[Automation] candidate_approved dispatch failed:", err));
      } else {
        dispatchAutomationEvent("score_below_minimum", {
          candidate_id: user.id, job_id: jobId, score, threshold,
        }).catch((err) => console.error("[Automation] score_below_minimum dispatch failed:", err));
      }

      console.log("[CargoTest] Submit complete, returning result");
      return { score, isApproved, threshold };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["candidate_test_status"] });
      qc.invalidateQueries({ queryKey: ["talent_pool_entry"] });
      qc.invalidateQueries({ queryKey: ["score_events"] });
    },
  });
}
