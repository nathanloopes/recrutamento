import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { findPipelineTestPhase } from "@/lib/pipelinePhaseDetector";
import { loadOperationalPipeline } from "@/lib/operationalPipeline";
import { toDocNames, isAsoDocName } from "@/lib/docNames";
import { autoApproveTestByScore } from "@/lib/pipelineProgression";

export interface PendingItem {
  type: "triagem" | "teste" | "documentos" | "entrevista_agendar" | "entrevista_feedback" | "avaliacao_ia" | "teste_modalidade" | "teste_agendar";
  label: string;
  responsible: "candidato" | "recrutador" | "gestor" | "sistema";
  actionUrl?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export interface PostInterviewTestState {
  stage: "choose" | "schedule" | "scheduled";
  unitId: string;
  modality: "online" | "presencial" | "ambos";
  booking?: { id: string; scheduled_date: string; scheduled_time: string; end_time?: string | null } | null;
}

export interface PhaseStatus {
  id: string;
  name: string;
  orderIndex: number;
  status: "completed" | "current" | "future" | "rejected";
}

export interface InterviewInfo {
  id: string;
  scheduled_date: string;
  scheduled_time: string;
  status: string;
  modality?: string;
  meeting_link?: string | null;
  meeting_provider?: string | null;
}

export interface ApplicationStatusData {
  phases: PhaseStatus[];
  currentPhaseIndex: number;
  pendingItems: PendingItem[];
  lastUpdate: string;
  totalSteps: number;
  answeredSteps: number;
  interviewInfo?: InterviewInfo[];
  /** Raw application status from DB (e.g. "aprovado", "em_andamento") */
  appStatus: string;
  /** Number of pending documents (0 = all docs OK or no docs requested) */
  docPendingCount: number;
  /** Number of documents already sent (pending or approved, not rejected) */
  docSentCount: number;
  /** Total number of documents requested */
  docTotalCount: number;
  /** Parallel pending action that does NOT change the current pipeline stage */
  pendingAction: "documents" | null;
  /** Aggregated tests state (consumed by stepperState) */
  testsAggregate: { has: boolean; allDone: boolean };
  /** Aggregated interviews state (consumed by stepperState) */
  interviewsAggregate: { has: boolean; allDone: boolean; decisionRejected: boolean; hadCancelled: boolean; hasApprovedDecision: boolean };
  /** restart_mode of the active application_cycles row, if any */
  currentRestartMode?: "triagem" | "teste" | "entrevista" | "documentacao" | "last_valid" | null;
  /** Estado da escolha de modalidade do teste pós-entrevista (pipeline) */
  postInterviewTest?: PostInterviewTestState | null;
  /** Data/hora de início do trabalhador (ISO), definida na contratação. */
  workStartAt?: string | null;
}

export function useApplicationStatus(applicationId: string, jobId?: string) {
  const query = useQuery({
    queryKey: ["application_status", applicationId],
    enabled: !!applicationId && !!jobId,
    refetchOnMount: "always",
    staleTime: 0,
    queryFn: async (): Promise<ApplicationStatusData> => {
      // 1. Pipeline operacional unificado (mescla todos os pipelines ativos do cargo).
      // Usa `loadOperationalPipeline` para garantir que a fase de "Avaliação/Teste"
      // seja detectada mesmo quando estiver em um SEGUNDO pipeline ativo.
      const op = await loadOperationalPipeline(jobId!);

      const allPhases = (op?.pipeline_phases || []);
      // phase_kind por fase (default "avaliacao") usado para rótulos de pendência
      const phaseKindById: Record<string, string> = {};
      for (const p of allPhases) {
        phaseKindById[(p as any).id] = (p as any).phase_kind || "avaliacao";
      }

      // 2. Application data
      const { data: app } = await supabase
        .from("applications")
        .select("current_phase, updated_at, status, candidate_id, origin_link_id, post_interview_test_assigned, post_interview_modality, work_start_at, unit_jobs(unit_id)")
        .eq("id", applicationId)
        .single();

      // Auto-correção idêntica à de useApplicationTriage:
      // se a candidatura ainda aponta para uma fase de triagem (já cumprida
      // em /teste-cargo) e existe uma fase pós-triagem real, avança a
      // candidatura. Isso libera "Realizar teste" no card sem exigir uma
      // nova interação do candidato.
      //
      // EXCEÇÃO: link direto (/v/:token) — a triagem NÃO foi cumprida em
      // /teste-cargo. O candidato precisa fazê-la na própria candidatura.
      // Quando há origin_link_id, não pular triagem.
      if (app && allPhases.length > 0) {
        const currentPhaseObj = allPhases.find((ph: any) => ph.id === app.current_phase);
        const currentKind = (currentPhaseObj as any)?.phase_kind || "avaliacao";
        const blocked = ["aprovado", "contratado", "reprovado", "standby", "desistente"];
        const cameFromDirectLink = !!(app as any).origin_link_id;
        if (currentKind === "triagem" && !blocked.includes((app as any).status) && !cameFromDirectLink) {
          const firstPostTriage = allPhases.find(
            (ph: any) => ((ph as any).phase_kind || "avaliacao") !== "triagem"
          );
          if (firstPostTriage && firstPostTriage.id !== app.current_phase) {
            await supabase
              .from("applications")
              .update({ current_phase: firstPostTriage.id, status: "em_andamento" } as any)
              .eq("id", applicationId);
            (app as any).current_phase = firstPostTriage.id;
            (app as any).status = "em_andamento";
          }
        }
      }

      // Safety net: se a candidatura já tem score de teste/cargo suficiente
      // e o flag pipelines.auto_approve_test_if_not_exists está ligado,
      // aprova automaticamente sem deixar o candidato preso em avaliação.
      if (app && ["pendente", "em_andamento", "em_avaliacao"].includes((app as any).status)) {
        const scoreApproval = await autoApproveTestByScore(applicationId);
        if (scoreApproval.approved) {
          (app as any).status = "aprovado";
          (app as any).updated_at = new Date().toISOString();
        }
      }

      // Auto-correção: aplicações marcadas como "aprovado" automaticamente pelo
      // teste do pipeline (sem decisão humana do recrutador). Reverte para
      // "em_avaliacao" para alinhar ao módulo Testes — só recrutador aprova.
      // Detecção: status=aprovado + último log com rule_applied automático
      // (min_score_hiring) e decision não-humana.
      if (app && (app as any).status === "aprovado") {
        try {
          const { data: lastLog } = await supabase
            .from("candidate_progress_logs")
            .select("decision, rule_applied, created_at")
            .eq("application_id", applicationId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          const rule = (lastLog as any)?.rule_applied as string | undefined;
          const decision = (lastLog as any)?.decision as string | undefined;
          const wasAutoApproved =
            !!rule && rule.startsWith("min_score_hiring:") && decision === "aprovado";
          if (wasAutoApproved) {
            await supabase
              .from("applications")
              .update({ status: "em_avaliacao" } as any)
              .eq("id", applicationId);
            (app as any).status = "em_avaliacao";
            await supabase.from("candidate_progress_logs").insert({
              candidate_id: (app as any).candidate_id,
              application_id: applicationId,
              phase: "auto_correction",
              score: null,
              decision: "em_avaliacao",
              rule_applied: "auto_correction:revert_pipeline_auto_approval",
              metadata: { previous_rule: rule } as any,
            });
          }
        } catch (e) {
          console.error("[useApplicationStatus] auto-correction error:", e);
        }
      }

      // 3. Step responses
      const { data: responses } = await supabase
        .from("step_responses")
        .select("step_id")
        .eq("application_id", applicationId);

      const respondedStepIds = new Set((responses || []).map((r: any) => r.step_id));

      // 4. Document requests + uploads (SOURCE OF TRUTH for doc pendencies)
      // Fetch requests for this application + orphan requests (no application_id) for this candidate
      let docRequests: any[] = [];
      {
        const { data: byApp } = await supabase
          .from("document_requests")
          .select("id, documents_list, custom_documents, status, application_id")
          .eq("application_id", applicationId);
        docRequests = byApp || [];
        // Also include orphan requests (candidate_id match, no application_id)
        if (app?.candidate_id) {
          const { data: orphans } = await supabase
            .from("document_requests")
            .select("id, documents_list, custom_documents, status, application_id")
            .eq("candidate_id", app.candidate_id)
            .is("application_id", null);
          const existingIds = new Set(docRequests.map((r: any) => r.id));
          for (const o of (orphans || [])) {
            if (!existingIds.has(o.id)) docRequests.push(o);
          }
        }
      }

      // Merge all requests into a single logical set (dedup doc names) preservando required.
      // Custom docs default to required=true. documents_list pode vir como string[] (legado)
      // ou {name, required}[] — toDocNames lida com ambos para nomes; aqui precisamos do flag.
      const docMetaByName = new Map<string, { required: boolean }>();
      const ingestDocs = (arr: any) => {
        if (!Array.isArray(arr)) return;
        for (const item of arr) {
          if (!item) continue;
          // ASO tem fluxo próprio (application_aso): não conta como documento
          // anexável pelo candidato nem como pendência de documentação.
          if (isAsoDocName(item)) continue;
          if (typeof item === "string") {
            if (!docMetaByName.has(item)) docMetaByName.set(item, { required: true });
          } else if (typeof item === "object" && item.name) {
            const name = String(item.name);
            const required = "required" in item ? item.required !== false : true;
            const prev = docMetaByName.get(name);
            // Se algum request marca como obrigatório, prevalece obrigatório.
            docMetaByName.set(name, { required: prev ? (prev.required || required) : required });
          }
        }
      };
      const allRequestIds: string[] = [];
      let hasOpenRequest = false;
      let docRequestForStatusCheck: any = null;
      for (const req of (docRequests || [])) {
        if ((req as any).status !== "cancelled") {
          allRequestIds.push(req.id);
          docRequestForStatusCheck = req;
          if ((req as any).status !== "completed") hasOpenRequest = true;
          ingestDocs((req as any).documents_list);
          ingestDocs((req as any).custom_documents);
        }
      }
      const docRequest = docRequestForStatusCheck;
      const allDocs = Array.from(docMetaByName.keys());
      const requiredDocs = allDocs.filter((n) => docMetaByName.get(n)?.required !== false);

      let docPendingCount = 0;
      let docMissingCount = 0; // só obrigatórios — drives stepper + aviso
      let docSentCount = 0;    // display geral (inclui opcionais enviados)
      let docTotalCount = 0;   // display geral
      let uploadsByType: Record<string, string[]> = {};
      // Conta sempre que houver request não cancelado, mesmo após auto-complete.
      if (docRequest && allDocs.length > 0) {
        docTotalCount = allDocs.length;

        const { data: uploads } = await supabase
          .from("document_uploads")
          .select("document_type, status")
          .in("request_id", allRequestIds)
          .order("uploaded_at", { ascending: true });

        uploadsByType = {};
        (uploads || []).forEach((u: any) => {
          if (!uploadsByType[u.document_type]) uploadsByType[u.document_type] = [];
          uploadsByType[u.document_type].push(u.status);
        });

        // Display: total enviado considera qualquer doc (obrigatório ou opcional).
        allDocs.forEach((docName: string) => {
          const statuses = uploadsByType[docName];
          if (statuses && statuses.length > 0) docSentCount++;
        });

        // Lógica: missing/pending considera APENAS obrigatórios.
        // Opcionais não bloqueiam o stepper nem geram aviso de pendência.
        requiredDocs.forEach((docName: string) => {
          const statuses = uploadsByType[docName];
          if (!statuses || !statuses.includes("approved")) {
            docMissingCount++;
          }
        });
        docPendingCount = docMissingCount;

        // Auto-complete: se todos os obrigatórios aprovados, fecha requests abertos.
        if (docMissingCount === 0 && hasOpenRequest) {
          const openIds = docRequests
            .filter((r: any) => r.status !== "completed" && r.status !== "cancelled")
            .map((r: any) => r.id);
          if (openIds.length > 0) {
            await supabase
              .from("document_requests")
              .update({ status: "completed" } as any)
              .in("id", openIds);
            hasOpenRequest = false;
          }
        }
      }


      // 5. Test assignments
      const { data: testAssignments } = await supabase
        .from("test_assignments")
        .select("id, status, test_templates(title)")
        .eq("application_id", applicationId)
        .in("status", ["pendente", "em_andamento"])
        .neq("status", "cancelled");

      // 6. Interviews
      const { data: interviews } = await supabase
        .from("interviews")
        .select("id, scheduled_date, scheduled_time, status")
        .eq("application_id", applicationId)
        .in("status", ["confirmed", "rescheduled"])
        .limit(1);

      // 7. Job info for interview requirement
      const { data: job } = await supabase
        .from("jobs")
        .select("requires_human_interview")
        .eq("id", jobId!)
        .single();

      // Fetch ALL test assignments (not just pending) to determine evaluation stage
      const { data: allTestAssignments } = await supabase
        .from("test_assignments")
        .select("id, status")
        .eq("application_id", applicationId);

      // Fetch ALL interviews (not just active) to determine interview stage
      const { data: allInterviews } = await supabase
        .from("interviews")
        .select("id, status, scheduled_date, scheduled_time, modality, meeting_link, meeting_provider, ai_result")
        .eq("application_id", applicationId);

      // Fetch interview feedback decisions (to determine if rejected at interview)
      const concludedIds = (allInterviews || [])
        .filter((i: any) => i.status === "completed")
        .map((i: any) => i.id);
      let interviewDecision: string | null = null;
      if (concludedIds.length > 0) {
        // Tenta primeiro a RPC segura (candidato lê só as próprias decisões — sem expor notas).
        try {
          const { data: myDec } = await (supabase as any).rpc("get_my_interview_decisions", {
            p_application_id: applicationId,
          });
          if (Array.isArray(myDec) && myDec.length > 0) {
            const match = myDec.find((d: any) => concludedIds.includes(d.interview_id));
            interviewDecision = (match?.decision as string) || null;
          }
        } catch (_) { /* ignore — fallback abaixo */ }
        // Fallback (admin/recrutador): leitura direta da tabela.
        if (!interviewDecision) {
          const { data: feedback } = await supabase
            .from("interview_feedback")
            .select("decision")
            .in("interview_id", concludedIds)
            .order("created_at", { ascending: false })
            .limit(1);
          interviewDecision = feedback?.[0]?.decision || null;
        }
      }

      // Fallback / safety net: derive AI rejection straight from interviews.ai_result
      // (covers race conditions where interview_feedback hasn't been written yet).
      const aiRejected = (allInterviews || []).some((i: any) => {
        if (i.modality !== "ai_interview" || i.status !== "completed") return false;
        const r = i.ai_result;
        const parsed = typeof r === "string" ? (() => { try { return JSON.parse(r); } catch { return null; } })() : r;
        const dec = parsed?.decision;
        return dec === "REJECTED" || dec === "TALENT_POOL";
      });

      let totalSteps = 0;
      let answeredSteps = 0;
      let phases: PhaseStatus[];

      if (allPhases.length > 0) {
        // Normal pipeline-based flow
        const currentPhaseId = app?.current_phase;
        let currentPhaseIndex = allPhases.findIndex((p: any) => p.id === currentPhaseId);
        if (currentPhaseIndex === -1) currentPhaseIndex = 0;

        const isFinalStatus = app?.status === "contratado" || app?.status === "reprovado" || app?.status === "standby";
        // 'aprovado' / 'apto_para_vaga' indicam que toda a fase de avaliação técnica
        // foi concluída com sucesso. As fases do pipeline (triagem/avaliação) devem
        // aparecer como concluídas, mesmo que current_phase ainda aponte para a
        // última fase de avaliação (caso comum quando o pipeline não tem fase
        // posterior à triagem). As etapas seguintes (Entrevista, Documentação,
        // Resultado) continuam sendo derivadas das tabelas reais em mapToGenericStages.
        const evaluationCompleted = app?.status === "aprovado" || app?.status === "apto_para_vaga";

        phases = allPhases.map((phase: any, idx: number) => {
          const stepIds: string[] = (phase.pipeline_steps || []).map((s: any) => s.id);
          totalSteps += stepIds.length;
          answeredSteps += stepIds.filter((id) => respondedStepIds.has(id)).length;

          let status: PhaseStatus["status"] = "future";
          if (isFinalStatus) {
            // All pipeline phases are done when candidate reached a final status
            status = (app?.status === "reprovado" || app?.status === "standby") ? "rejected" : "completed";
          } else if (evaluationCompleted) {
            // Avaliação concluída: todas as fases do pipeline são consideradas completas
            status = "completed";
          } else if (idx < currentPhaseIndex) {
            status = "completed";
          } else if (idx === currentPhaseIndex) {
            status = "current";
          }

          return { id: phase.id, name: phase.name, orderIndex: phase.order_index, status };
        });
      } else {
        // Synthetic phases — infer from real data
        const appStatus = app?.status || "em_andamento";

        const hasTests = (allTestAssignments || []).length > 0;
        const pendingTests = (allTestAssignments || []).filter(
          (t: any) => t.status === "pendente" || t.status === "em_andamento"
        );
        const allTestsDone = hasTests && pendingTests.length === 0;

        const hasInterviews = (allInterviews || []).length > 0;
        const activeInterviews = (allInterviews || []).filter(
          (i: any) => i.status === "confirmed" || i.status === "reschedule_requested" || i.status === "pending_approval"
        );
        const allInterviewsDone = hasInterviews && activeInterviews.length === 0;

        const hasDocs = allRequestIds.length > 0;
        const allDocsApproved = hasDocs && (!hasOpenRequest || docPendingCount === 0);

        const isStandbyOrRejected = appStatus === "reprovado" || appStatus === "standby";
        const isContratado = appStatus === "contratado";
        const isAprovado = appStatus === "aprovado";
        const isEmAvaliacao = appStatus === "em_avaliacao";
        const isAptoParaVaga = appStatus === "apto_para_vaga";
        const isFinal = isContratado || isStandbyOrRejected;
        const isRejectedAtInterview = isStandbyOrRejected && hasInterviews && interviewDecision === "encerrado";
        const isRejectedAtEvaluation = isStandbyOrRejected && !hasInterviews && !hasDocs;

        // Determine status for each synthetic stage
        type SyntheticStage = { name: string; status: PhaseStatus["status"] };
        const syntheticStages: SyntheticStage[] = [
          { name: "Perguntas iniciais", status: "completed" },
          { name: "Escolha da unidade", status: "completed" },
          {
            name: "Teste",
            status: isRejectedAtEvaluation
              ? "rejected"
              : (isAprovado || isContratado || isEmAvaliacao || isAptoParaVaga)
                ? "completed"
                : hasTests
                  ? allTestsDone ? "completed" : "current"
                  : "future",
          },
          {
            name: "Aguardando avaliação",
            status: (isRejectedAtInterview || isRejectedAtEvaluation)
              ? "rejected"
              : isEmAvaliacao ? "current"
              : (isAprovado || isContratado) ? "completed"
              : (hasTests && allTestsDone) ? "current"
              : "future",
          },
          {
            name: "Aprovado pelo recrutador",
            status: (isRejectedAtInterview || isRejectedAtEvaluation)
              ? "rejected"
              : (isAprovado && !hasInterviews) ? "current"
              : (isAprovado || isContratado) ? "completed"
              : "future",
          },
          {
            name: "Entrevista",
            status: (isRejectedAtInterview || isRejectedAtEvaluation)
              ? "rejected"
              : hasInterviews
                ? allInterviewsDone ? "completed" : "current"
                : "future",
          },
          {
            name: "Documentação",
            status: (isRejectedAtInterview || isRejectedAtEvaluation)
              ? "rejected"
              : hasDocs
                ? allDocsApproved ? "completed" : "current"
                : "future",
          },
          {
            name: "Resultado",
            status: (isRejectedAtInterview || isRejectedAtEvaluation)
              ? "rejected"
              : isContratado ? "completed"
              : isAprovado ? "future"
              : isFinal ? "completed" : "future",
          },
        ];

        // Sequential consistency: stages before a "current" one must be "completed"
        let foundCurrent = false;
        for (let i = syntheticStages.length - 1; i >= 0; i--) {
          if (syntheticStages[i].status === "current") foundCurrent = true;
        }
        if (foundCurrent) {
          let reachedCurrent = false;
          for (let i = 0; i < syntheticStages.length; i++) {
            if (syntheticStages[i].status === "current") {
              reachedCurrent = true;
              break;
            }
            if (syntheticStages[i].status === "future") {
              syntheticStages[i].status = "completed";
            }
          }
        }

        // If no stage is "current" and not final, find the first "future" stage that has activity and mark it
        if (!syntheticStages.some(s => s.status === "current") && !isFinal) {
          const firstFuture = syntheticStages.find(s => s.status === "future");
          if (firstFuture && firstFuture.name !== "Resultado") {
            firstFuture.status = "current";
            // Mark all before it as completed
            for (const s of syntheticStages) {
              if (s === firstFuture) break;
              if (s.status === "future") s.status = "completed";
            }
          }
        }

        phases = syntheticStages.map((s, idx) => ({
          id: `synthetic-${idx}`,
          name: s.name,
          orderIndex: idx,
          status: s.status,
        }));
      }

      // Build pending items
      const pendingItems: PendingItem[] = [];

      // Detecta fase de teste no pipeline (Regra 1: pipeline tem prioridade total).
      // Se houver, suprime "Fazer Teste" vindo de test_assignments para evitar duplicar.
      // Fonte única: pipelinePhaseDetector — reconhece quiz, dissertativa, voz,
      // mídia, etc., tanto no modelo novo (content.questions[]) quanto no legado.
      const pipelineTestPhase = findPipelineTestPhase(allPhases || []);
      const hasPipelineTest = !!pipelineTestPhase;

      // Modalidade do teste pós-entrevista: fonte única é unit_test_config.modality.
      const hasPostInterviewPhase = (allPhases || []).some(
        (p: any) => ((p as any).phase_kind || "") === "avaliacao_pos_entrevista",
      );
      // unit_jobs pode vir como objeto ou array dependendo da resolução do FK.
      const ujRaw = (app as any)?.unit_jobs;
      let postUnitId: string | undefined =
        (Array.isArray(ujRaw) ? ujRaw[0]?.unit_id : ujRaw?.unit_id) || undefined;
      // Fallback: se o embed não resolveu, buscar direto via unit_jobs pelo id.
      if (!postUnitId && hasPostInterviewPhase) {
        try {
          const { data: appUj } = await (supabase as any)
            .from("applications")
            .select("unit_jobs:unit_job_id(unit_id)")
            .eq("id", applicationId)
            .maybeSingle();
          const uj2 = appUj?.unit_jobs;
          postUnitId = (Array.isArray(uj2) ? uj2[0]?.unit_id : uj2?.unit_id) || undefined;
        } catch (_) { /* mantém undefined */ }
      }
      let unitTestModality: "online" | "presencial" | "ambos" | null = null;
      let pipelineTestBooking: PostInterviewTestState["booking"] = null;
      if (hasPostInterviewPhase && postUnitId) {
        try {
          const [{ data: utc }, { data: bk }] = await Promise.all([
            (supabase as any)
              .from("unit_test_config")
              .select("enabled, modality")
              .eq("unit_id", postUnitId)
              .maybeSingle(),
            (supabase as any)
              .from("test_bookings")
              .select("id, scheduled_date, scheduled_time, end_time, status")
              .eq("application_id", applicationId)
              .eq("status", "agendado")
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle(),
          ]);

          const configuredModality = String(utc?.modality || "");
          unitTestModality = utc?.enabled === true && ["online", "presencial", "ambos"].includes(configuredModality)
            ? (configuredModality as "online" | "presencial" | "ambos")
            : null;
          if (bk?.id) pipelineTestBooking = bk as any;
          console.log("[CANDIDATO][useApplicationStatus] unit_test_config lido do banco", {
            applicationId,
            postUnitId,
            utc_raw: utc,
            configuredModality,
            unitTestModality_resolvido: unitTestModality,
            pipelineTestBooking,
          });
        } catch (err) {
          console.log("[CANDIDATO][useApplicationStatus] erro lendo unit_test_config", err);
        }
      } else {
        console.log("[CANDIDATO][useApplicationStatus] gate modalidade NÃO avaliado", {
          hasPostInterviewPhase,
          postUnitId,
        });
      }

      let postInterviewTest: PostInterviewTestState | null = null;

      // Gate do teste pós-entrevista (fluxo unificado "Online + Presencial").
      //
      // O teste ONLINE é sempre a primeira etapa obrigatória — sem escolha de
      // modalidade. Este gate só empurra a pendência "Fazer teste online" e só
      // roda enquanto ainda há passos não respondidos na fase pós-entrevista;
      // assim que o candidato conclui o online, o gate deixa de sugerir o teste
      // e o agendamento presencial é oferecido pelo PostTestPresencialCard.
      const applyModalityGate = (): boolean => {
        if (!postUnitId) return false;
        if (unitTestModality === null) return false; // teste não habilitado na unidade
        postInterviewTest = { stage: "choose", unitId: postUnitId, modality: "online" };
        pendingItems.push({
          type: "teste_modalidade",
          label: "Fazer teste online",
          responsible: "candidato",
        });
        return false;
      };

      // Triage / avaliação / etc steps (only when pipeline phases exist)
      if (allPhases.length > 0) {
        const currentPhaseId2 = app?.current_phase;
        let cpi = allPhases.findIndex((p: any) => p.id === currentPhaseId2);
        if (cpi === -1) cpi = 0;
        const cp = allPhases[cpi];
        const currentStepIds: string[] = (cp?.pipeline_steps || []).map((s: any) => s.id);
        const unansweredInCurrent = currentStepIds.filter((id) => !respondedStepIds.has(id)).length;
        const kind = (phaseKindById[cp?.id] || "avaliacao");
        const hasPendingAssignment = (testAssignments || []).length > 0;

        // Entrevista ativa (agendada/aguardando) ainda não realizada — enquanto
        // existir, o teste pós-entrevista permanece bloqueado, mesmo que o
        // status da application já esteja "aprovado" (ex.: auto-aprovação por score).
        const hasActivePendingInterview = (allInterviews || []).some((i: any) =>
          ["confirmed", "pending_approval", "reschedule_requested"].includes(i.status)
        );
        const interviewApprovedDecision =
          (app as any)?.post_interview_test_assigned === true ||
          ["aprovado", "presencial"].includes(String(interviewDecision || "").toLowerCase());

        // Regra: a triagem do cargo é executada em /teste-cargo (talent_pool_entries),
        // não em step_responses da application. Quando a application já existe
        // (= unidade escolhida), a triagem do cargo está concluída por definição.
        // Logo, se a fase atual ainda é "triagem", NÃO mostrar "Continuar triagem".
        //
        // EXCEÇÃO: candidaturas via link direto (/v/:token) — a triagem precisa
        // ser feita aqui, pois o link só pula a escolha de unidade.
        const cameFromDirectLink = !!(app as any)?.origin_link_id;
        const triageAlreadyDone = kind === "triagem" && !!app && !cameFromDirectLink;
        const isTriageDone = triageAlreadyDone || (kind === "triagem" && unansweredInCurrent === 0);

        if (triageAlreadyDone) {
          // Teste pós-entrevista: só libera após interview_feedback aprovado
          // manualmente pelo recrutador E sem entrevista ativa pendente.
          // Antes disso, fica oculto e o fluxo segue para agendar/realizar entrevista.
          const isPostInterviewTest =
            !!pipelineTestPhase && pipelineTestPhase.phase_kind === "avaliacao_pos_entrevista";
          const testGatedByInterview =
            isPostInterviewTest && (hasActivePendingInterview || !interviewApprovedDecision);


          if (hasPipelineTest && pipelineTestPhase && !testGatedByInterview) {
            // Gate de modalidade: teste pós-entrevista exige escolha
            // online/presencial antes de liberar o teste do pipeline.
            const canShowOnlineTest = !isPostInterviewTest || applyModalityGate();
            if (canShowOnlineTest) {
              pendingItems.push({
                type: "teste",
                label: "Realizar teste",
                responsible: "candidato",
                actionUrl: `/triagem/${applicationId}`,
                actionLabel: "Fazer teste",
              });
            }
          } else if (!testGatedByInterview && !hasPendingAssignment && app?.status !== "aprovado" && app?.status !== "contratado") {
            pendingItems.push({
              type: "avaliacao_ia",
              label: "Aguardando avaliação",
              responsible: "recrutador",
            });
          }
        } else if (unansweredInCurrent > 0 && !isTriageDone) {
          // Gate do teste pós-entrevista também quando current_phase aponta
          // DIRETAMENTE para a fase avaliacao_pos_entrevista: enquanto houver
          // entrevista ativa (agendada e não realizada) ou sem decisão aprovada
          // de entrevista, o bloco "Continuar etapa" fica oculto.
          const postInterviewLocked =
            kind === "avaliacao_pos_entrevista" &&
            (hasActivePendingInterview || !interviewApprovedDecision);

          if (!postInterviewLocked) {
            // Gate de modalidade também neste branch (current_phase aponta
            // direto para a fase pós-entrevista).
            const canShowOnlineTest =
              kind !== "avaliacao_pos_entrevista" || applyModalityGate();
            if (canShowOnlineTest) {
              const labelByKind: Record<string, string> = {
                triagem: "Continuar perguntas iniciais",
                avaliacao: "Realizar teste",
                avaliacao_pos_entrevista: "Realizar teste",
                entrevista: "Avaliação da entrevista",
                documentacao: "Etapa de documentação",
                resultado: "Etapa de resultado",
              };
              const label = `${labelByKind[kind] || "Continuar etapa"} (${currentStepIds.length - unansweredInCurrent}/${currentStepIds.length})`;
              pendingItems.push({
                type: kind === "triagem" ? "triagem" : "teste",
                label,
                responsible: "candidato",
                actionUrl: `/triagem/${applicationId}`,
                actionLabel: kind === "triagem" ? "Continuar" : "Fazer teste",
              });
            }
          }
        }

        // Lag de avanço: fase respondida mas sem teste / sem aprovação ainda.
        if (!triageAlreadyDone && isTriageDone && !hasPendingAssignment && !hasPipelineTest && app?.status !== "aprovado" && app?.status !== "contratado") {
          pendingItems.push({
            type: "avaliacao_ia",
            label: "Aguardando avaliação",
            responsible: "recrutador",
          });
        }
      }


      // Tests vindos de test_assignments (Regra 2: só quando pipeline NÃO tem
      // teste — caso contrário Pipeline vence e o módulo de testes fica reservado
      // para envio manual do recrutador).
      if (!hasPipelineTest) {
        (testAssignments || []).forEach((t: any) => {
          pendingItems.push({
            type: "teste",
            label: "Realizar teste",
            responsible: "candidato",
            actionUrl: `/testes/${t.id}`,
            actionLabel: "Fazer teste",
          });
        });
      }

      // Documents — não mostrar pendência quando candidato está fora do funil
      const isOutOfFunnel = ["standby", "reprovado", "desistente", "desligado", "declinado"].includes(app?.status as string);
      if (docTotalCount > 0 && !isOutOfFunnel) {
        // Considera APENAS obrigatórios — opcionais não geram pendência.
        const requiredNotUploaded = requiredDocs.filter((n) => {
          const s = uploadsByType[n];
          return !s || s.length === 0;
        }).length;
        if (docMissingCount === 0) {
          // Todos obrigatórios aprovados — sem pendência (opcionais ignorados)
        } else if (requiredNotUploaded > 0) {
          pendingItems.push({
            type: "documentos",
            label: `Faltam ${requiredNotUploaded} documento(s) para enviar`,
            responsible: "candidato",
            actionUrl: `/documentos/${applicationId}`,
            actionLabel: "Enviar Documentos",
          });
        } else {
          // Todos obrigatórios enviados, mas algum aguardando aprovação ou rejeitado
          const hasRejected = requiredDocs.some((n) => {
            const statuses = uploadsByType[n];
            const latest = statuses?.[statuses.length - 1];
            return latest === "rejected";
          });
          pendingItems.push({
            type: "documentos",
            label: hasRejected
              ? "Você possui documentos para revisão — verifique e reenvie"
              : "Documentos enviados — aguardando aprovação",
            responsible: hasRejected ? "candidato" : "recrutador",
            actionUrl: `/documentos/${applicationId}`,
            actionLabel: hasRejected ? "Reenviar Documentos" : "Verificar Documentos",
          });
        }
      }

      // Interview scheduling — show pending item when at "Entrevista" phase and no interview yet
      const activeInterviewCount = (allInterviews || []).filter(
        (i: any) => ["confirmed", "pending_approval", "reschedule_requested"].includes(i.status)
      ).length;
      if (activeInterviewCount === 0) {
        // Check if current phase (pipeline-based) or stage (synthetic) is interview-type
        const currentPhaseObj = allPhases.length > 0
          ? allPhases.find((p: any) => p.id === app?.current_phase)
          : null;
        const isInterviewPhase = currentPhaseObj
          ? ((currentPhaseObj as any).phase_kind === "entrevista")
          : false;
        // For synthetic flow: all tests done + status em_andamento + job requires interview
        const isSyntheticInterviewTime = allPhases.length === 0 &&
          (allTestAssignments || []).length > 0 &&
          (allTestAssignments || []).every((t: any) => t.status !== "pendente" && t.status !== "em_andamento") &&
          job?.requires_human_interview &&
          app?.status === "em_andamento";

        if (isInterviewPhase || isSyntheticInterviewTime) {
          // Check if self-scheduling is enabled
          const { data: selfScheduleSetting } = await supabase
            .from("global_settings")
            .select("value")
            .eq("category", "agendamento")
            .eq("key", "allow_candidate_self_schedule")
            .maybeSingle();
          const canSelfSchedule = (selfScheduleSetting?.value as any)?.enabled === true;

          pendingItems.push({
            type: "entrevista_agendar",
            label: canSelfSchedule ? "Agende sua entrevista" : "Aguardando agendamento da entrevista",
            responsible: canSelfSchedule ? "candidato" : "recrutador",
            actionUrl: canSelfSchedule ? undefined : undefined,
            actionLabel: canSelfSchedule ? "Ir para Candidaturas" : undefined,
          });
        }
      }

      // Interview info for display
      const interviewInfo: InterviewInfo[] = (allInterviews || []).map((i: any) => ({
        id: i.id,
        scheduled_date: i.scheduled_date,
        scheduled_time: i.scheduled_time,
        status: i.status,
        modality: i.modality,
        meeting_link: i.meeting_link,
        meeting_provider: i.meeting_provider,
      }));

      const _hasTests = (allTestAssignments || []).length > 0;
      const _allTestsDone = _hasTests && (allTestAssignments || []).every(
        (t: any) => t.status !== "pendente" && t.status !== "em_andamento",
      );
      const _interviewsNonCancelled = (allInterviews || []).filter(
        (i: any) => i.status !== "cancelled",
      );
      const _hasInterviews = _interviewsNonCancelled.length > 0;
      const _allInterviewsDone = _hasInterviews && _interviewsNonCancelled.every(
        (i: any) => !["confirmed", "pending_approval", "reschedule_requested"].includes(i.status),
      );
      const _hadCancelledInterview = (allInterviews || []).some(
        (i: any) => i.status === "cancelled",
      );

      // Active cycle restart_mode (drives stepper override after a reactivation)
      let currentRestartMode: ApplicationStatusData["currentRestartMode"] = null;
      try {
        const { data: activeCycle } = await supabase
          .from("application_cycles" as any)
          .select("restart_mode")
          .eq("application_id", applicationId)
          .is("closed_at", null)
          .order("cycle_number", { ascending: false })
          .limit(1)
          .maybeSingle();
        currentRestartMode = ((activeCycle as any)?.restart_mode as any) || null;
      } catch (_) { /* ignore */ }

      const _result: ApplicationStatusData = {
        phases,
        currentPhaseIndex: phases.findIndex(p => p.status === "current"),
        pendingItems,
        lastUpdate: app?.updated_at || new Date().toISOString(),
        totalSteps,
        answeredSteps,
        interviewInfo: interviewInfo.length > 0 ? interviewInfo : undefined,
        appStatus: app?.status || "em_andamento",
        docPendingCount,
        docSentCount,
        docTotalCount,
        pendingAction: docPendingCount > 0 ? "documents" : null,
        testsAggregate: { has: _hasTests, allDone: _allTestsDone },
        interviewsAggregate: {
          has: _hasInterviews,
          allDone: _allInterviewsDone,
          decisionRejected: interviewDecision === "encerrado" || aiRejected,
          hadCancelled: _hadCancelledInterview,
          hasApprovedDecision:
            (app as any)?.post_interview_test_assigned === true ||
            interviewDecision === "aprovado" ||
            interviewDecision === "presencial",
        },
        currentRestartMode,
        postInterviewTest,
        workStartAt: (app as any)?.work_start_at ?? null,
      };
      console.log("[CANDIDATO][useApplicationStatus] RESULTADO FINAL", {
        applicationId,
        jobId,
        appStatus: _result.appStatus,
        currentPhaseIndex: _result.currentPhaseIndex,
        currentPhase: _result.phases[_result.currentPhaseIndex],
        pendingItems: _result.pendingItems,
        postInterviewTest: _result.postInterviewTest,
        docPendingCount: _result.docPendingCount,
        docSentCount: _result.docSentCount,
        docTotalCount: _result.docTotalCount,
        testsAggregate: _result.testsAggregate,
        interviewsAggregate: _result.interviewsAggregate,
        phases: _result.phases,
      });
      console.log("[CANDIDATO][useApplicationStatus] RESULTADO FINAL COMPLETO", _result);
      return _result;

    },
  });

  return query;
}
