import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { sendPushToDevice } from "@/hooks/useNotifications";
import { getAdminRecipientIds } from "@/lib/notificationRoutes";
import { dispatchAutomationEvent } from "@/lib/automationEngine";
import { invalidateProcessCache } from "@/lib/processCacheSync";
import { advanceAfterUnitChoice, autoApproveIfNoTest, autoApproveTestByScore } from "@/lib/pipelineProgression";

export function useMyApplications() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my_applications", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select("*, unit_jobs(*, jobs(id, title, requires_human_interview), units(id, name, city, state)), pipeline_phases(name, order_index), application_cycles!application_cycles_application_id_fkey(restart_mode, closed_at, cycle_number)")
        .eq("candidate_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      // Compute currentRestartMode (active cycle = closed_at IS NULL, highest cycle_number)
      const enriched = (data || []).map((app: any) => {
        const cycles = (app.application_cycles || []) as Array<{ restart_mode: string | null; closed_at: string | null; cycle_number: number }>;
        const active = cycles
          .filter((c) => c.closed_at === null)
          .sort((a, b) => (b.cycle_number ?? 0) - (a.cycle_number ?? 0))[0];
        return { ...app, currentRestartMode: active?.restart_mode ?? null };
      });
      return enriched;
    },
  });
}

export function useApplyToJob() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ unitJobId, origin = "unit", selectionType = "manual", reuseTriagem = false }: {
      unitJobId: string;
      origin?: string;
      selectionType?: string;
      /** Reaproveitamento: mesma vaga (cargo) em outra unidade com triagem já
       *  aprovada → inicia direto na fase de entrevista (ver Item 3 do plano). */
      reuseTriagem?: boolean;
    }) => {
      // Block if candidate is already hired
      const { count: alreadyHired } = await supabase
        .from("applications")
        .select("id", { count: "exact", head: true })
        .eq("candidate_id", user!.id)
        .eq("status", "contratado");
      if ((alreadyHired || 0) > 0) {
        throw new Error("Você já está contratado(a) em uma vaga. Não é possível se candidatar a novas vagas.");
      }

      // Exclusivity check: 1 candidatura ativa por candidato.
      // Ativos = pendente, em_andamento, em_avaliacao, aprovado (qualquer etapa antes de contratado).
      // Standby, pausado, reprovado, desistente, desligado NÃO bloqueiam.
      const { count } = await supabase
        .from("applications")
        .select("id", { count: "exact", head: true })
        .eq("candidate_id", user!.id)
        .in("status", ["pendente", "em_andamento", "em_avaliacao", "aprovado"]);

      if ((count || 0) >= 1) {
        throw new Error("Você já possui uma candidatura ativa em andamento. Encerre ou pause a candidatura atual antes de abrir uma nova.");
      }

      // Cooldown check: allow_reapply_after_days
      const { data: cooldownSetting } = await supabase
        .from("global_settings")
        .select("value")
        .eq("category", "scoring")
        .eq("key", "allow_reapply_after_days")
        .maybeSingle();

      const cooldownDays = cooldownSetting ? Number(cooldownSetting.value) : 90;

      if (cooldownDays > 0) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - cooldownDays);

        const { data: standbyApps } = await supabase
          .from("applications")
          .select("updated_at")
          .eq("candidate_id", user!.id)
          .eq("unit_job_id", unitJobId)
          .in("status", ["standby", "reprovado"])
          .gte("updated_at", cutoffDate.toISOString())
          .limit(1);

        if (standbyApps && standbyApps.length > 0) {
          throw new Error(`Você está em standby nesta vaga recentemente. Aguarde ${cooldownDays} dias para se candidatar novamente.`);
        }
      }

      // Get the first active pipeline phase for this job
      const { data: unitJob } = await supabase
        .from("unit_jobs")
        .select("job_id, unit_id, status, openings")
        .eq("id", unitJobId)
        .single();
      if (!unitJob) throw new Error("Vaga não encontrada");

      // Bloqueio DEFINITIVO por vaga: candidato declinou esta vaga anteriormente.
      const { count: declinedCount } = await supabase
        .from("applications")
        .select("id", { count: "exact", head: true })
        .eq("candidate_id", user!.id)
        .eq("unit_job_id", unitJobId)
        .eq("status", "declinado");
      if ((declinedCount || 0) > 0) {
        throw new Error("Você declinou esta vaga anteriormente e não pode se candidatar novamente a ela.");
      }

      // Bloqueio por UNIDADE: processo encerrado em qualquer vaga desta unidade.
      // Chaveado em test_feedback.decision='encerrado' (não no status), para não
      // afetar o desligamento pós-contratação.
      const { data: unitUJs } = await supabase
        .from("unit_jobs")
        .select("id")
        .eq("unit_id", unitJob.unit_id);
      const unitUjIds = (unitUJs || []).map((u: any) => u.id);
      if (unitUjIds.length > 0) {
        const { data: myAppsInUnit } = await supabase
          .from("applications")
          .select("id")
          .eq("candidate_id", user!.id)
          .in("unit_job_id", unitUjIds);
        const unitAppIds = (myAppsInUnit || []).map((a: any) => a.id);
        if (unitAppIds.length > 0) {
          const { data: closedInUnit } = await supabase
            .from("test_feedback" as any)
            .select("id")
            .eq("decision", "encerrado")
            .in("application_id", unitAppIds)
            .limit(1);
          if (closedInUnit && closedInUnit.length > 0) {
            throw new Error("Seu processo foi encerrado nesta unidade e não é possível se candidatar às vagas dela.");
          }
        }
      }

      // Block if job is not open
      if (unitJob.status !== "aberta") {
        const statusMsg: Record<string, string> = {
          preenchida: "Esta vaga já foi preenchida.",
          encerrada: "Esta vaga foi encerrada.",
          pausada: "Esta vaga está temporariamente pausada.",
        };
        throw new Error(statusMsg[unitJob.status] || "Esta vaga não está aceitando candidaturas.");
      }

      // Check if openings are still available (based on hired count)
      if (unitJob.openings && unitJob.openings > 0) {
        const { count: hiredCount } = await supabase
          .from("applications")
          .select("id", { count: "exact", head: true })
          .eq("unit_job_id", unitJobId)
          .eq("status", "contratado");
        if ((hiredCount || 0) >= unitJob.openings) {
          throw new Error("Esta vaga já foi preenchida.");
        }
      }

      // Visão operacional: mescla TODOS os pipelines ativos do cargo.
      // Necessário porque alguns cargos têm pipelines separados para
      // Triagem e Avaliação/Teste, e o candidato precisa cair na primeira
      // fase pós-triagem real, não na primeira fase do primeiro pipeline.
      const { loadOperationalPipeline } = await import("@/lib/operationalPipeline");
      const op = await loadOperationalPipeline(unitJob.job_id);
      const sortedPhases = op?.pipeline_phases || [];
      const firstPostTriage = sortedPhases.find(
        (p: any) => (p.phase_kind || "avaliacao") !== "triagem"
      );

      // Fetch talent pool: score (propagado à application) + approved_job_id
      // (sinal de triagem do cargo aprovada, usado no reaproveitamento).
      let initialScore: number | null = null;
      const { data: tpEntry } = await supabase
        .from("talent_pool_entries")
        .select("test_score, approved_job_id")
        .eq("candidate_id", user!.id)
        .maybeSingle();
      if (tpEntry?.test_score != null) {
        initialScore = Number(tpEntry.test_score);
      }

      // Reaproveitamento (Item 3): mesma vaga em outra unidade com triagem do
      // cargo já aprovada → começa direto na fase de ENTREVISTA. Só quando o
      // CTA de reuso pediu E a triagem do cargo está aprovada (approved_job_id
      // === job_id). Caso contrário, mantém o comportamento normal.
      const interviewPhase = sortedPhases.find((p: any) => (p.phase_kind || "") === "entrevista");
      const canReuseTriagem =
        reuseTriagem && !!interviewPhase && tpEntry?.approved_job_id === unitJob.job_id;
      const firstPhase = canReuseTriagem ? interviewPhase : (firstPostTriage || sortedPhases[0]);

      console.info("[useApplyToJob] inserting application", {
        candidate_id: user!.id,
        unit_job_id: unitJobId,
        first_phase_id: firstPhase?.id || null,
        initial_score: initialScore,
      });
      const { data, error } = await supabase
        .from("applications")
        .insert({
          candidate_id: user!.id,
          unit_job_id: unitJobId,
          current_phase: firstPhase?.id || null,
          // Reuso da triagem começa direto na entrevista → já entra em andamento.
          status: (canReuseTriagem ? "em_andamento" : "pendente") as any,
          total_score: initialScore,
        } as any)
        .select()
        .single();
      if (error) {
        console.error("[useApplyToJob] insert FAILED", error);
        throw error;
      }
      console.info("[useApplyToJob] application created", data?.id);

      // Record unit selection for audit
      await supabase.from("candidate_unit_selections").insert({
        candidate_id: user!.id,
        unit_id: unitJob.unit_id,
        unit_job_id: unitJobId,
        origin,
        selection_type: selectionType,
      });

      // REGRA OFICIAL (Pipeline x Módulo Testes):
      //  - Se o pipeline do cargo possui fase de teste (phase_kind=avaliacao com
      //    step do tipo quiz), o teste oficial é o do Pipeline. NÃO criar
      //    test_assignment auto — o template da vaga vira envio manual.
      //  - Se o pipeline NÃO tem teste, resolver pelo template vinculado e
      //    criar test_assignment imediatamente para dar destino ao botão
      //    "Ver testes da vaga".
      if (canReuseTriagem) {
        // Reaproveitamento: a candidatura já nasceu na fase de ENTREVISTA
        // (mesma vaga/cargo em outra unidade, triagem já aprovada). NÃO rodar
        // resolução de teste nem o avanço/auto-aprovação pós-triagem — isso
        // reposicionaria para a fase de avaliação. Apenas registrar o pulo.
        try {
          await supabase.rpc("log_application_journey" as any, {
            p_application_id: data.id,
            p_event_type: "phase_skipped",
            p_skipped: true,
            p_skip_reason: "triage_reused_other_unit",
            p_phase_id: null,
            p_actor_role: "system",
            p_source: "system",
            p_details: { jumped_to_phase_id: firstPhase?.id ?? null, job_id: unitJob.job_id } as any,
          } as any);
        } catch (e) {
          console.error("[useApplyToJob] log_application_journey (reuse) failed:", e);
        }
      } else {
        try {
          const { resolveAvailableTest, pipelineHasTestPhase } = await import("@/lib/testResolver");
          const { hasTest } = await pipelineHasTestPhase(unitJob.job_id);
          if (!hasTest) {
            await resolveAvailableTest(data.id, unitJob.job_id, user!.id);
          }
        } catch (e) {
          console.error("[useApplyToJob] auto test resolution failed:", e);
        }

        // 🔁 AVANÇO AUTOMÁTICO DE FASE pós-escolha de unidade.
        // Triagem do cargo já foi cumprida em /teste-cargo. Ao escolher a
        // unidade, a fase ativa precisa pular para a primeira fase pós-triagem
        // (Avaliação/Teste) — sem depender de refresh ou clique adicional.
        await advanceAfterUnitChoice(data.id);
        const scoreApproval = await autoApproveTestByScore(data.id);
        if (!scoreApproval.approved) {
          await autoApproveIfNoTest(data.id);
        }
      }


      // Auto-create or update talent_pool_entries (Talent Pipeline)
      // Skip if candidate is already hired for any position
      const { count: candidateHiredCount } = await supabase
        .from("applications")
        .select("id", { count: "exact", head: true })
        .eq("candidate_id", user!.id)
        .eq("status", "contratado");

      if ((candidateHiredCount || 0) === 0) {
        const { data: existingEntry } = await supabase
          .from("talent_pool_entries")
          .select("id")
          .eq("candidate_id", user!.id)
          .maybeSingle();

        if (!existingEntry) {
          const { error: tpInsertErr } = await supabase.from("talent_pool_entries").insert({
            candidate_id: user!.id,
            entry_origin: "application_auto",
            last_job_id: unitJob.job_id,
            origin_unit_id: unitJob.unit_id,
            status: "active",
          } as any);
          if (tpInsertErr) console.error("Talent pool insert error:", tpInsertErr);
        } else {
          const { error: tpUpdateErr } = await supabase
            .from("talent_pool_entries")
            .update({
              entry_origin: "application_auto",
              last_job_id: unitJob.job_id,
              origin_unit_id: unitJob.unit_id,
              last_interaction: new Date().toISOString(),
            } as any)
            .eq("id", existingEntry.id);
          if (tpUpdateErr) console.error("Talent pool update error:", tpUpdateErr);
        }
      }

      return data;
    },
    onSuccess: (data) => {
      invalidateProcessCache(qc);
      qc.invalidateQueries({ queryKey: ["admin_talent_pool"] });
      qc.invalidateQueries({ queryKey: ["open_jobs"] });
      qc.invalidateQueries({ queryKey: ["unit_jobs"] });
      qc.invalidateQueries({ queryKey: ["my_test_assignments"] });
      qc.invalidateQueries({ queryKey: ["test_assignments"] });
      qc.invalidateQueries({ queryKey: ["application_status"] });
      qc.invalidateQueries({ queryKey: ["candidate_timeline"] });

      // Audit log
      supabase.from("activity_logs").insert({
        user_id: user?.id || null,
        action: "candidatura_criada",
        module: "recrutamento",
        details: { application_id: data?.id },
      } as any).then(() => {});

      // Notify admins about new application
      if (data?.id && data?.unit_job_id) {
        (async () => {
          try {
            const { data: profile } = await supabase
              .from("profiles")
              .select("full_name")
              .eq("id", user!.id)
              .single();
            const candidateName = profile?.full_name || "Novo candidato";

            const { data: ujData } = await supabase
              .from("unit_jobs")
              .select("unit_id, jobs:job_id(title)")
              .eq("id", data.unit_job_id)
              .single();

            const jobTitle = (ujData as any)?.jobs?.title || "vaga";
            const title = "Nova candidatura";
            const body = `${candidateName} se candidatou para ${jobTitle}.`;
            const actionUrl = `/admin/vagas/${data.unit_job_id}/candidatos`;

            // Find admins of the unit (admin role always receives)
            const admins = (await getAdminRecipientIds(ujData?.unit_id)).map(uid => ({ user_id: uid }));

            for (const admin of admins) {
              await supabase.from("notifications" as any).insert({
                event_type: "new_application",
                recipient_id: admin.user_id,
                channel: "push",
                title,
                body,
                status: "pending",
                action_url: actionUrl,
                action_type: "action_required",
                payload: { application_id: data.id, unit_job_id: data.unit_job_id, candidate_name: candidateName },
              } as any);

              sendPushToDevice({
                recipientId: admin.user_id,
                title,
                body,
                actionUrl,
              }).catch((err) => console.error("[PUSH] new_application push failed:", err));
            }
          } catch (err) {
            console.error("Failed to notify admins about new application:", err);
          }
        })();
      }
    },
  });
}

export function useApplicationTriage(applicationId: string) {
  return useQuery({
    queryKey: ["triage", applicationId],
    enabled: !!applicationId,
    queryFn: async () => {
      // Load application
      const { data: app, error: appErr } = await supabase
        .from("applications")
        .select("*, unit_jobs(job_id, unit_id, jobs(id, title, description))")
        .eq("id", applicationId)
        .single();
      if (appErr) throw appErr;

      // Carrega visão operacional unificada (mescla todos pipelines ativos)
      const { loadOperationalPipeline } = await import("@/lib/operationalPipeline");
      const op = await loadOperationalPipeline(app.unit_jobs.job_id);
      if (!op) throw new Error("Pipeline ativo não encontrado para este cargo");

      // Shape compatível com o consumidor existente (espera { ...pipeline, pipeline_phases })
      const pipeline: any = {
        id: op.id,
        name: op.name,
        job_id: op.job_id,
        is_active: true,
      };

      const phases = (op.pipeline_phases || []).map((ph: any) => ({
        ...ph,
        pipeline_steps: (ph.pipeline_steps || []).slice().sort(
          (a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0)
        ),
      }));

      // Auto-correção: se a candidatura ainda aponta para uma fase de
      // triagem (já cumprida em /teste-cargo), avança para a primeira
      // fase pós-triagem. Sem isso, o candidato vê a tela "Sem etapas
      // pendentes" mesmo havendo um teste do pipeline configurado.
      //
      // EXCEÇÃO: candidaturas vindas de link direto (/v/:token) precisam
      // FAZER a triagem aqui mesmo — o link só pula a escolha de unidade,
      // não a triagem. Quando há origin_link_id, manter a fase de triagem.
      const currentPhaseObj = phases.find((ph: any) => ph.id === app.current_phase);
      const currentKind = (currentPhaseObj as any)?.phase_kind || "avaliacao";
      const cameFromDirectLink = !!(app as any).origin_link_id;
      if (currentKind === "triagem" && !cameFromDirectLink) {
        const firstPostTriage = phases.find(
          (ph: any) => ((ph as any).phase_kind || "avaliacao") !== "triagem"
        );
        if (firstPostTriage && firstPostTriage.id !== app.current_phase) {
          await supabase
            .from("applications")
            .update({ current_phase: firstPostTriage.id, status: "em_andamento" } as any)
            .eq("id", applicationId);
          (app as any).current_phase = firstPostTriage.id;
        }
      }

      // Load existing responses
      const { data: responses } = await supabase
        .from("step_responses")
        .select("*")
        .eq("application_id", applicationId);

      // Load external scores: test_assignments
      const { data: testAssignments } = await supabase
        .from("test_assignments")
        .select("id, score, status")
        .eq("application_id", applicationId)
        .in("status", ["avaliado", "concluido"]);

      // Load external scores: interview_feedback
      const { data: interviewFeedback } = await supabase
        .from("interviews")
        .select("id, interview_feedback(decision, checklist_json)")
        .eq("application_id", applicationId);

      // Load scoring config (centralized source of truth)
      const { data: config } = await supabase
        .from("global_settings")
        .select("key, value")
        .eq("category", "scoring");

      const getConfig = (key: string, fallback: any) => {
        const s = config?.find((c) => c.key === key);
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

      // Consolidate external scores
      const externalScores: { source: string; score: number }[] = [];
      (testAssignments || []).forEach((t: any) => {
        if (t.score != null) externalScores.push({ source: "test", score: Number(t.score) });
      });
      (interviewFeedback || []).forEach((i: any) => {
        const fb = (i as any).interview_feedback;
        if (fb) {
          const feedbacks = Array.isArray(fb) ? fb : [fb];
          feedbacks.forEach((f: any) => {
            if (f.decision === "aprovado") externalScores.push({ source: "interview", score: 100 });
            else if (f.decision === "reprovado") externalScores.push({ source: "interview", score: 0 });
            else externalScores.push({ source: "interview", score: 50 });
          });
        }
      });

      // Load candidate profile for conditional steps
      const { data: candidateProfile } = await supabase
        .from("profiles")
        .select("gender, city, state")
        .eq("id", app.candidate_id)
        .single();

      return {
        application: app,
        pipeline: { ...pipeline, pipeline_phases: phases },
        responses: responses || [],
        externalScores,
        candidateProfile: candidateProfile || {},
        config: {
          min_score_phase_1: Number(getConfig("min_score_phase_1", 60)),
          min_score_ia_interview: Number(getConfig("min_score_ia_interview", 70)),
          min_score_human_interview: Number(getConfig("min_score_human_interview", 75)),
          min_score_hiring: Number(getConfig("min_score_hiring", 80)),
          max_retry_attempts: Number(getConfig("max_retry_attempts", 2)),
          max_global_retries: Number(getConfig("max_global_retries", 0)),
          allow_reapply_after_days: Number(getConfig("allow_reapply_after_days", 90)),
          score_rounding: String(getConfig("score_rounding", "floor")),
          enforce_global_scoring: Boolean(getConfig("enforce_global_scoring", true)),
          allow_manual_override: Boolean(getConfig("allow_manual_override", false)),
          escalation_threshold: Number(getConfig("escalation_threshold", 0)),
        },
      };
    },
  });
}

export function useSubmitStepResponse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      applicationId,
      stepId,
      response,
      score,
    }: {
      applicationId: string;
      stepId: string;
      response: any;
      score?: number;
    }) => {
      const insert: any = {
        application_id: applicationId,
        step_id: stepId,
        response,
      };
      if (score !== undefined) {
        insert.score = score;
        insert.evaluated_at = new Date().toISOString();
      }
      const { data, error } = await supabase
        .from("step_responses")
        .insert(insert)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["triage", vars.applicationId] });
    },
  });
}

export function useWithdrawApplication() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ applicationId, reason }: { applicationId: string; reason: string }) => {
      const { data, error } = await supabase
        .from("applications")
        .update({ status: "desistente" as any, withdrawal_reason: reason } as any)
        .eq("id", applicationId)
        .eq("candidate_id", user!.id)
        .select()
        .single();
      if (error) throw error;

      // Cancel all linked processes in parallel
      await Promise.all([
        supabase
          .from("test_assignments" as any)
          .update({ status: "cancelled" } as any)
          .eq("application_id", applicationId)
          .in("status", ["pendente", "em_andamento"]),
        supabase
          .from("document_requests")
          .update({ status: "cancelled" })
          .eq("application_id", applicationId)
          .in("status", ["open", "in_progress"]),
        supabase
          .from("interviews")
          .update({ status: "cancelled" })
          .eq("application_id", applicationId)
          .in("status", ["confirmed", "rescheduled"]),
      ]);

      // Cancel pending notifications related to this application
      const { data: pendingNotifs } = await supabase
        .from("notifications")
        .select("id")
        .eq("recipient_id", user!.id)
        .in("status", ["pending", "queued"])
        .contains("payload", { application_id: applicationId } as any);

      if (pendingNotifs && pendingNotifs.length > 0) {
        const notifIds = pendingNotifs.map((n: any) => n.id);
        await supabase
          .from("notifications")
          .update({ status: "cancelled" })
          .in("id", notifIds);
      }

      // Dispatch automation event: process_closed
      dispatchAutomationEvent("process_closed", {
        application_id: applicationId,
        candidate_id: user!.id,
        status: "desistente",
      }).catch(() => {});

      return data;
    },
    onSuccess: async (data: any) => {
      qc.invalidateQueries({ queryKey: ["my_applications"] });
      qc.invalidateQueries({ queryKey: ["test_assignments"] });
      qc.invalidateQueries({ queryKey: ["my_test_assignments"] });
      qc.invalidateQueries({ queryKey: ["documents"] });
      qc.invalidateQueries({ queryKey: ["my_document_requests"] });
      qc.invalidateQueries({ queryKey: ["interviews"] });
      qc.invalidateQueries({ queryKey: ["scheduling"] });

      // Audit log
      supabase.from("activity_logs").insert({
        user_id: user?.id || null,
        action: "candidatura_desistencia",
        module: "recrutamento",
        details: { application_id: data?.id, withdrawal_reason: data?.withdrawal_reason },
      } as any).then(() => {});

      // Notify admins and RH about the withdrawal
      try {
        const { data: appDetail } = await supabase
          .from("applications")
          .select("unit_job_id, unit_jobs(unit_id, jobs(title)), pipeline_phases(name)")
          .eq("id", data?.id)
          .single();

        const jobTitle = (appDetail as any)?.unit_jobs?.jobs?.title || "Vaga";
        const phaseName = (appDetail as any)?.pipeline_phases?.name || "—";

        // Get candidate name from profile
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", user!.id)
          .single();
        const candidateName = profile?.full_name || "Candidato";

        // Find admin recipients
        const adminRecipientIds = await getAdminRecipientIds();
        const adminRoles = adminRecipientIds.map(uid => ({ user_id: uid }));

        if (adminRoles.length > 0) {
          const payload = {
            candidate_name: candidateName,
            job_title: jobTitle,
            phase_name: phaseName,
            withdrawal_reason: data?.withdrawal_reason || "Não informado",
            unit_job_id: data?.unit_job_id,
            application_id: data?.id,
          };

          const notifications = adminRoles.map((r: any) => ({
            recipient_id: r.user_id,
            event_type: "candidate_withdrawn",
            channel: "push",
            action_type: "action_required",
            action_url: `/admin/vagas/${data?.unit_job_id}/candidatos`,
            title: `Candidato desistente: ${candidateName}`,
            body: `${candidateName} desistiu da vaga ${jobTitle} (fase: ${phaseName}). Motivo: ${data?.withdrawal_reason || "não informado"}`,
            payload,
            status: "pending",
          }));

          const { data: insertedNotifs } = await supabase.from("notifications").insert(notifications as any).select("id, recipient_id, title, body, action_url");

          // Send real push notification to each admin
          for (const notif of (insertedNotifs || [])) {
            sendPushToDevice({
              recipientId: (notif as any).recipient_id,
              title: (notif as any).title,
              body: (notif as any).body,
              notificationId: (notif as any).id,
              actionUrl: (notif as any).action_url,
            }).catch((err) => console.error("[PUSH] bypass sendPushToDevice failed:", err));
          }
        }
      } catch (err) {
        console.error("Failed to notify admins about withdrawal:", err);
      }
    },
  });
}

export function useAdvancePhase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      applicationId,
      nextPhaseId,
      status,
      totalScore,
    }: {
      applicationId: string;
      nextPhaseId?: string | null;
      status?: string;
      totalScore?: number;
    }) => {
      const updates: any = {};
      if (nextPhaseId !== undefined) updates.current_phase = nextPhaseId;
      if (status) updates.status = status;
      if (totalScore !== undefined) updates.total_score = totalScore;

      const { data, error } = await supabase
        .from("applications")
        .update(updates)
        .eq("id", applicationId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["triage", vars.applicationId] });
      invalidateProcessCache(qc);
    },
  });
}
