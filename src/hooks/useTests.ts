import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { sendPushToDevice } from "@/hooks/useNotifications";
import { getAdminRecipientIds } from "@/lib/notificationRoutes";
import { invalidateProcessCache } from "@/lib/processCacheSync";

// ---- Types ----

export interface TestTemplate {
  id: string;
  title: string;
  description: string;
  type: "quiz" | "file" | "voice";
  content: any;
  category: string;
  subcategory: string;
  time_limit_minutes: number | null;
  created_by: string | null;
  is_active: boolean;
  created_at: string;
  execution_mode?: "form" | "chatbox";
}

export interface TestAssignment {
  id: string;
  test_template_id: string;
  application_id: string;
  candidate_id: string;
  assigned_by: string | null;
  deadline: string | null;
  is_mandatory: boolean;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  response: any;
  score: number | null;
  evaluator_notes: string | null;
  evaluated_by: string | null;
  evaluated_at: string | null;
  created_at: string;
  test_templates?: TestTemplate;
}

// ---- Admin: Templates ----

export function useTestTemplates(opts?: { onlyActive?: boolean }) {
  const onlyActive = opts?.onlyActive ?? false;
  return useQuery({
    queryKey: ["test_templates", { onlyActive }],
    queryFn: async () => {
      let q = supabase
        .from("test_templates" as any)
        .select("*")
        .order("title", { ascending: true });
      if (onlyActive) q = q.eq("is_active", true);
      const { data, error } = await q;
      if (error) throw error;
      return data as unknown as TestTemplate[];
    },
  });
}

export function useCreateTestTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (template: Partial<TestTemplate>) => {
      const { data, error } = await supabase
        .from("test_templates" as any)
        .insert(template as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["test_templates"] }),
  });
}

export function useUpdateTestTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<TestTemplate> & { id: string }) => {
      const { data, error } = await supabase
        .from("test_templates" as any)
        .update(updates as any)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["test_templates"] }),
  });
}

export function useDeleteTestTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("test_templates" as any)
        .update({ is_active: false } as any)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["test_templates"] }),
  });
}

// ---- Admin: Assignments ----

export function useTestAssignments(filters?: { applicationId?: string; status?: string }) {
  return useQuery({
    queryKey: ["test_assignments", filters],
    queryFn: async () => {
      let q = supabase
        .from("test_assignments" as any)
        .select("*, test_templates(*)")
        .order("created_at", { ascending: false });
      if (filters?.applicationId) q = q.eq("application_id", filters.applicationId);
      if (filters?.status) q = q.eq("status", filters.status);
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data || []) as any[];

      // Collect unique user IDs for candidate and assigner
      const candidateIds = [...new Set(rows.map(r => r.candidate_id).filter(Boolean))];
      const assignerIds = [...new Set(rows.map(r => r.assigned_by).filter(Boolean))];
      const applicationIds = [...new Set(rows.map(r => r.application_id).filter(Boolean))];
      const allUserIds = [...new Set([...candidateIds, ...assignerIds])];

      // Batch fetch profiles
      let profileMap: Record<string, { full_name: string; email: string; avatar_url: string }> = {};
      if (allUserIds.length > 0) {
        const { data: profiles } = await supabase
          .from("candidates" as any)
          .select("id, full_name, email, avatar_url")
          .in("id", allUserIds);
        (profiles || []).forEach((p: any) => { profileMap[p.id] = p; });
      }

      // Batch fetch job titles via applications -> unit_jobs -> jobs
      let jobMap: Record<string, string> = {};
      if (applicationIds.length > 0) {
        const { data: apps } = await supabase
          .from("applications" as any)
          .select("id, unit_job_id, unit_jobs(job_id, jobs(title))")
          .in("id", applicationIds);
        (apps || []).forEach((a: any) => {
          jobMap[a.id] = a.unit_jobs?.jobs?.title || null;
        });
      }

      return rows.map((row: any) => ({
        ...row,
        candidate_name: profileMap[row.candidate_id]?.full_name || null,
        candidate_email: profileMap[row.candidate_id]?.email || null,
        candidate_avatar: profileMap[row.candidate_id]?.avatar_url || null,
        assigner_name: profileMap[row.assigned_by]?.full_name || null,
        job_title: jobMap[row.application_id] || null,
      })) as unknown as (TestAssignment & { candidate_name?: string; candidate_email?: string; candidate_avatar?: string; assigner_name?: string; job_title?: string })[];
    },
  });
}

export function useCreateTestAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (assignment: Partial<TestAssignment>) => {
      const { data, error } = await supabase
        .from("test_assignments" as any)
        .insert(assignment as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["test_assignments"] }),
  });
}

export function useEvaluateTestAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, score, evaluator_notes, status, evaluated_by }: {
      id: string; score: number; evaluator_notes: string; status: string; evaluated_by: string;
    }) => {
      const { data, error } = await supabase
        .from("test_assignments" as any)
        .update({ score, evaluator_notes, status, evaluated_by, evaluated_at: new Date().toISOString() } as any)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["test_assignments"] }),
  });
}

// ---- Candidate ----

export function useMyTestAssignments() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my_test_assignments", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("test_assignments" as any)
        .select("*, test_templates(*), applications!inner(unit_job_id, unit_jobs!inner(job_id, jobs!inner(title)))")
        .eq("candidate_id", user!.id)
        .neq("status", "cancelled")
        .order("created_at", { ascending: false });
      if (error) throw error;
      // Flatten job_title onto each assignment
      return ((data || []) as any[]).map((row: any) => ({
        ...row,
        job_title: row.applications?.unit_jobs?.jobs?.title || null,
        applications: undefined,
      })) as unknown as (TestAssignment & { job_title?: string })[];
    },
  });
}

/**
 * Testes pendentes vindos do pipeline (não usam test_assignments).
 * Foco no teste pós-entrevista: aparece quando current_phase é
 * `avaliacao_pos_entrevista`, modalidade online escolhida (ou unidade só online),
 * e há perguntas não respondidas. Link aponta para /triagem/:applicationId.
 */
export function useMyPendingPipelineTests() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my_pending_pipeline_tests", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data: apps, error } = await supabase
        .from("applications")
        .select(`
          id,
          status,
          current_phase,
          unit_jobs!inner(unit_id, jobs!inner(title)),
          pipeline_phases!applications_current_phase_fkey(
            id, phase_kind, name,
            pipeline_steps(id)
          )
        `)
        .eq("candidate_id", user!.id)
        .not("status", "in", "(desligado,desistente,contratado,reprovado)");
      if (error) throw error;

      const items: Array<{
        id: string;
        applicationId: string;
        status: string;
        score: null;
        completed_at: null;
        deadline: null;
        job_title: string;
        test_templates: { title: string };
        source: "pipeline_test";
      }> = [];

      for (const app of (apps || []) as any[]) {
        const phase = app.pipeline_phases;
        if (!phase || phase.phase_kind !== "avaliacao_pos_entrevista") continue;
        const stepIds: string[] = (phase.pipeline_steps || []).map((s: any) => s.id);
        if (stepIds.length === 0) continue;

        const unitId = app.unit_jobs?.unit_id;
        if (!unitId) continue;

        const { data: utc } = await (supabase as any)
          .from("unit_test_config")
          .select("enabled, modality")
          .eq("unit_id", unitId)
          .maybeSingle();
        const allowOnline = utc?.enabled === true && utc.modality === "online";
        if (!allowOnline) continue;

        const { data: resp } = await supabase
          .from("step_responses")
          .select("step_id")
          .eq("application_id", app.id)
          .in("step_id", stepIds);
        const answered = new Set((resp || []).map((r: any) => r.step_id));
        const pending = stepIds.filter((id) => !answered.has(id));
        if (pending.length === 0) continue;

        items.push({
          id: `pipeline-${app.id}`,
          applicationId: app.id,
          status: "pendente",
          score: null,
          completed_at: null,
          deadline: null,
          job_title: app.unit_jobs?.jobs?.title || "",
          test_templates: { title: phase.name || "Teste pós-entrevista" },
          source: "pipeline_test",
        });
      }

      return items;
    },
  });
}

export function useTestAssignmentById(id: string | undefined) {
  return useQuery({
    queryKey: ["test_assignment", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("test_assignments" as any)
        .select("*, test_templates(*)")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data as unknown as TestAssignment;
    },
  });
}

export function useSubmitTestResponse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, response }: { id: string; response: any }) => {
      // First, fetch the assignment + template to check if we can auto-grade
      const { data: assignmentData } = await supabase
        .from("test_assignments" as any)
        .select("*, test_templates(*)")
        .eq("id", id)
        .single();

      const template = (assignmentData as any)?.test_templates;
      let autoScore: number | null = null;
      let autoStatus = "enviado";

      // Auto-grade quiz-type tests (hybrid: quiz by index, essay by AI)
      if (template?.type === "quiz" && template?.content?.questions && response?.answers) {
        const questions = template.content.questions as any[];
        const answerMap = response.answers;

        // Helper: normalize text for fuzzy comparison (lowercase, strip accents, trim)
        const norm = (s: any) => String(s ?? "").trim().toLowerCase()
          .normalize("NFD").replace(/[\u0300-\u036f]/g, "");

        // Separate quiz (has correct option/answer) vs essay (truly free text)
        const quizQuestions: { idx: number; q: any }[] = [];
        const essayQuestions: { idx: number; q: any }[] = [];

        questions.forEach((q: any, idx: number) => {
          const qType = q.type || "multiple_choice";
          const hasCorrectIdx = typeof q.correct === "number";
          const hasOptionsWithCorrect = Array.isArray(q.options)
            && q.options.length > 0
            && q.options.some((o: any) => o && typeof o === "object" && o.correct === true);
          const isChoiceType = ["multiple_choice", "true_false", "scale"].includes(qType);

          if (hasCorrectIdx || hasOptionsWithCorrect || isChoiceType) {
            quizQuestions.push({ idx, q });
          } else {
            essayQuestions.push({ idx, q });
          }
        });

        // Grade quiz: try numeric index, option.correct lookup, then text match (Chatbox)
        let quizCorrect = 0;
        quizQuestions.forEach(({ idx, q }) => {
          const raw = answerMap[idx];
          if (raw == null || raw === "") return;

          const rawStr = String(raw);
          const isNumeric = /^\d+$/.test(rawStr.trim());
          const asInt = isNumeric ? parseInt(rawStr) : -1;

          // 1. Numeric index match against q.correct
          if (isNumeric && typeof q.correct === "number" && asInt === q.correct) {
            quizCorrect++;
            return;
          }

          // 2. Numeric index → look up option.correct
          if (isNumeric && Array.isArray(q.options)) {
            const opt = q.options[asInt];
            if (opt && typeof opt === "object" && opt.correct === true) {
              quizCorrect++;
              return;
            }
          }

          // 3. Text match against the correct option's text (Chatbox sends text)
          if (Array.isArray(q.options)) {
            const correctOpt = q.options.find((o: any) => o && typeof o === "object" && o.correct === true);
            if (correctOpt && norm(correctOpt.text) === norm(raw)) {
              quizCorrect++;
              return;
            }
          }
        });

        const quizScore = quizQuestions.length > 0 ? (quizCorrect / quizQuestions.length) * 100 : 0;

        // Grade essay questions via AI
        let essayScore = 0;
        let aiGradingResults: any[] = [];
        let essayGradingFailed = false;
        if (essayQuestions.length > 0) {
          try {
            const essayPayload = essayQuestions.map(({ idx, q }) => ({
              question: q.question || q.text || `Pergunta ${idx + 1}`,
              candidate_answer: String(answerMap[idx] || ""),
              rubric: q.rubric || q.expected_answer || undefined,
              max_score: 100,
              context: q.context || undefined,
            }));

            const CHUNK_SIZE = 5;
            const allResults: any[] = [];
            for (let i = 0; i < essayPayload.length; i += CHUNK_SIZE) {
              const chunk = essayPayload.slice(i, i + CHUNK_SIZE);
              const { data: gradeData, error: gradeError } = await supabase.functions.invoke("grade-essay", {
                body: { questions: chunk },
              });
              if (gradeError) {
                console.error("[grade-essay] Edge function error:", gradeError);
                essayGradingFailed = true;
              } else if (gradeData?.results) {
                allResults.push(...gradeData.results);
              }
            }

            if (allResults.length > 0) {
              aiGradingResults = allResults;
              const validScores = allResults.filter((r: any) => !r.error && r.score != null);
              essayScore = validScores.length > 0
                ? validScores.reduce((s: number, r: any) => s + (r.score || 0), 0) / validScores.length
                : 0;
            } else if (essayQuestions.length > 0) {
              essayGradingFailed = true;
            }
          } catch (err) {
            console.error("[grade-essay] AI essay grading exception:", err);
            essayGradingFailed = true;
          }
        }

        // Combine scores (weighted by question count of each type)
        const totalQuestions = questions.length;
        const quizWeight = quizQuestions.length / totalQuestions;
        const essayWeight = essayQuestions.length / totalQuestions;
        autoScore = Math.round(quizScore * quizWeight + essayScore * essayWeight);

        console.log("[useSubmitTestResponse] Scoring breakdown:", {
          totalQuestions,
          quizQuestionsCount: quizQuestions.length,
          quizCorrect,
          quizScore: quizScore.toFixed(1),
          essayQuestionsCount: essayQuestions.length,
          essayScore: essayScore.toFixed(1),
          essayGradingFailed,
          autoScore,
        });

        const hasValidAnswers = Object.values(answerMap).some((v: any) => v !== null && v !== undefined && v !== "");
        if (essayGradingFailed && quizQuestions.length > 0) {
          autoScore = Math.round(quizScore);
          autoStatus = "pendente_revisao";
        } else if (essayGradingFailed && quizQuestions.length === 0) {
          autoStatus = "pendente_revisao";
        } else {
          autoStatus = (autoScore === 0 && hasValidAnswers) ? "pendente_revisao" : "corrigido";
        }

        // Store AI grading results in response for admin display
        if (aiGradingResults.length > 0) {
          response.ai_grading = aiGradingResults.map((r: any, i: number) => ({
            questionIndex: essayQuestions[i]?.idx,
            ...r,
          }));
        }
      }

      const updatePayload: any = {
        response,
        status: autoStatus,
        completed_at: new Date().toISOString(),
      };
      if (autoScore !== null) {
        updatePayload.score = autoScore;
        updatePayload.evaluated_at = new Date().toISOString();
      }

      const { data, error } = await supabase
        .from("test_assignments" as any)
        .update(updatePayload)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return { ...(data as any), _autoScore: autoScore };
    },
    onSuccess: async (data: any) => {
      invalidateProcessCache(qc);

      // Pós-teste: candidato vai para "em_avaliacao" e fica aguardando o recrutador.
      // O trigger fn_guard_apto_para_vaga não bloqueia transição para "em_avaliacao".
      // Não regredir status caso já esteja em estado final.
      if (data?.application_id) {
        try {
          const { data: app } = await supabase
            .from("applications")
            .select("status, unit_jobs(job_id, jobs(min_score))")
            .eq("id", data.application_id)
            .maybeSingle();
          const blockedStatuses = ["aprovado", "contratado", "reprovado", "standby", "desistente"];
          if (app && !blockedStatuses.includes((app as any).status)) {
            // Auto-aprovação por score: setting `pipelines.auto_approve_test_if_not_exists`
            // ON + nota >= jobs.min_score → aprova direto, sem clique manual do recrutador.
            let nextStatus: "aprovado" | "em_avaliacao" = "em_avaliacao";
            if (data?._autoScore != null) {
              const minScore = Number((app as any)?.unit_jobs?.jobs?.min_score ?? 0);
              if (data._autoScore >= minScore) {
                const { data: setting } = await supabase
                  .from("global_settings" as any)
                  .select("value")
                  .eq("category", "pipelines")
                  .eq("key", "auto_approve_test_if_not_exists")
                  .maybeSingle();
                const raw = (setting as any)?.value;
                const enabled = raw === true || raw === "true";
                if (enabled) {
                  nextStatus = "aprovado";
                  await supabase.from("activity_logs").insert({
                    action: "auto_test_approval",
                    module: "pipelines",
                    details: {
                      application_id: data.application_id,
                      test_assignment_id: data.id,
                      score: data._autoScore,
                      min_score: minScore,
                      reason: "score_meets_min",
                      triggered_by: "test_submission",
                    },
                  } as any);
                }
              }
            }
            await supabase
              .from("applications")
              .update({ status: nextStatus } as any)
              .eq("id", data.application_id);
          }
        } catch (e) {
          console.error("[useSubmitTestResponse] failed to set application status:", e);
        }
      }

      // Emit score_event so talent_pool_entries.global_score updates automatically (best-effort)
      if (data?._autoScore != null && data?.candidate_id && data?.application_id) {
        try {
          const { data: app } = await supabase
            .from("applications")
            .select("unit_job_id, unit_jobs(job_id)")
            .eq("id", data.application_id)
            .maybeSingle();
          const jobId = (app as any)?.unit_jobs?.job_id ?? null;

          await supabase.rpc("insert_score_event" as any, {
            p_candidate_id: data.candidate_id,
            p_event_type: "test_completed",
            p_process_stage: "test",
            p_related_job_id: jobId,
            p_score_delta: data._autoScore,
            p_reason: "Teste atribuído avaliado automaticamente",
            p_metadata: {
              source: "test_assignment",
              attempt_id: data.id,
              application_id: data.application_id,
            },
          });
          qc.invalidateQueries({ queryKey: ["score_events"] });
          qc.invalidateQueries({ queryKey: ["talent_pool"] });
        } catch (scoreErr) {
          console.error("[useSubmitTestResponse] insert_score_event failed:", scoreErr);
        }
      }

      // Notify admins that a candidate submitted a test
      if (data?.candidate_id) {
        try {
          const { data: profile } = await supabase
            .from("profiles")
            .select("full_name")
            .eq("id", data.candidate_id)
            .single();
          const candidateName = profile?.full_name || "Candidato";
          const scoreInfo = data._autoScore != null ? ` Nota: ${data._autoScore}/100.` : "";
          const title = data._autoScore != null ? "Teste corrigido automaticamente" : "Teste enviado";
          const body = `${candidateName} concluiu o teste.${scoreInfo}`;

          const admins = (await getAdminRecipientIds()).map(uid => ({ user_id: uid }));

          for (const admin of admins) {
            await supabase.from("notifications" as any).insert({
              event_type: "test_submitted",
              recipient_id: admin.user_id,
              channel: "push",
              title,
              body,
              status: "pending",
              action_url: "/admin/vagas",
              action_type: "action_required",
              payload: { candidate_id: data.candidate_id, test_assignment_id: data.id, score: data._autoScore },
            } as any);

            sendPushToDevice({
              recipientId: admin.user_id,
              title,
              body,
              actionUrl: "/admin/vagas",
            }).catch((err) => console.error("[PUSH] test_submitted push failed:", err));
          }
        } catch (err) {
          console.error("Failed to notify admins about test submission:", err);
        }
      }
    },
  });
}

export function useStartTest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("test_assignments" as any)
        .update({ status: "em_andamento", started_at: new Date().toISOString() } as any)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my_test_assignments"] });
      qc.invalidateQueries({ queryKey: ["test_assignment"] });
    },
  });
}

// ---- AI Functions ----

export function useGenerateTest() {
  return useMutation({
    mutationFn: async (params: { job_title: string; category: string; prompt: string; question_count: number; difficulty?: string; subcategory?: string }) => {
      const { data, error } = await supabase.functions.invoke("generate-test", { body: params });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { questions: any[]; passing_score: number };
    },
  });
}

export function useGradeEssay() {
  return useMutation({
    mutationFn: async (params: { questions: { question: string; rubric?: string; candidate_answer: string; max_score?: number; context?: string }[] }) => {
      const { data, error } = await supabase.functions.invoke("grade-essay", { body: params });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { results: any[]; summary: { average_score: number; total_graded: number; total_questions: number } };
    },
  });
}

// ---- Voice Test Evaluation ----

export function useEvaluateVoiceTest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { test_assignment_id: string; audio_urls: Record<string, string>; questions: { id: string; text: string; weight?: number }[] }) => {
      const { data, error } = await supabase.functions.invoke("evaluate-test-voice", { body: params });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { score: number; status: string; results: any[]; processing_time_ms: number };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["test_assignments"] });
      qc.invalidateQueries({ queryKey: ["my_test_assignments"] });
      qc.invalidateQueries({ queryKey: ["test_assignment"] });
    },
  });
}
