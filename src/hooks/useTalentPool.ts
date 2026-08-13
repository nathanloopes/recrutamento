import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { getAdminRecipientIds } from "@/lib/notificationRoutes";
import { restartApplicationCycle } from "@/lib/applicationCycle";

// Helper to log talent pool events (auto-injects current score)
async function logTalentPoolEvent(candidateId: string, event: string, context: Record<string, any> = {}) {
  // Fetch current score to enrich log context
  let currentScore: number | null = null;
  try {
    const { data: entry } = await supabase
      .from("talent_pool_entries")
      .select("global_score")
      .eq("candidate_id", candidateId)
      .maybeSingle();
    currentScore = entry?.global_score ?? null;
  } catch { /* best-effort */ }

  await supabase.from("talent_pool_logs" as any).insert({
    candidate_id: candidateId,
    event,
    context: { ...context, ...(currentScore !== null ? { current_score: currentScore } : {}) },
  });
}

export function useTalentPoolEntry() {
  const { user } = useAuth();
  const qc = useQueryClient();

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`talent-pool-candidate-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "talent_pool_entries", filter: `candidate_id=eq.${user.id}` }, () => {
        qc.invalidateQueries({ queryKey: ["talent_pool_entry", user.id] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "talent_invites", filter: `candidate_id=eq.${user.id}` }, () => {
        qc.invalidateQueries({ queryKey: ["talent_invites", user.id] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, qc]);

  return useQuery({
    queryKey: ["talent_pool_entry", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("talent_pool_entries")
        .select("*, jobs:last_job_id(title), units:origin_unit_id(name, city, state)")
        .eq("candidate_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

// Manual signup: candidate registers voluntarily
export function useManualTalentSignup() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ unitJobId }: { unitJobId: string }) => {
      // Check if already exists
      const { data: existing } = await supabase
        .from("talent_pool_entries")
        .select("id, status")
        .eq("candidate_id", user!.id)
        .maybeSingle();

      if (existing) {
        throw new Error("ALREADY_EXISTS");
      }

      // Block if candidate is already hired
      const { count: hiredCount } = await supabase
        .from("applications")
        .select("id", { count: "exact", head: true })
        .eq("candidate_id", user!.id)
        .eq("status", "contratado");

      if ((hiredCount || 0) > 0) {
        throw new Error("ALREADY_HIRED");
      }

      // Get job_id and unit_id from unit_job
      const { data: unitJob } = await supabase
        .from("unit_jobs")
        .select("job_id, unit_id")
        .eq("id", unitJobId)
        .single();

      const { error } = await supabase.from("talent_pool_entries").insert({
        candidate_id: user!.id,
        entry_origin: "manual",
        last_job_id: unitJob?.job_id || null,
        origin_unit_id: unitJob?.unit_id || null,
        status: "active",
      } as any);
      if (error) throw error;

      await logTalentPoolEvent(user!.id, "opt_in", { source: "manual_signup", unit_job_id: unitJobId });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["talent_pool_entry"] });
      toast({ title: "Cadastro realizado!", description: "Você agora faz parte do Banco de Talentos." });
    },
    onError: (e: any) => {
      if (e.message === "ALREADY_EXISTS") {
        toast({ title: "Você já faz parte do Banco de Talentos", description: "Seu cadastro já está ativo." });
      } else if (e.message === "ALREADY_HIRED") {
        toast({ title: "Cadastro indisponível", description: "Você já foi contratado(a) para uma vaga.", variant: "destructive" });
      } else {
        toast({ title: "Erro", description: e.message, variant: "destructive" });
      }
    },
  });
}

export function useUpdateTalentPoolEntry() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (updates: Record<string, any>) => {
      const { error } = await supabase
        .from("talent_pool_entries")
        .update({ ...updates, last_interaction: new Date().toISOString() })
        .eq("candidate_id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["talent_pool_entry"] });
      toast({ title: "Preferências salvas" });
    },
    onError: (e: any) => {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    },
  });
}

export function useWithdrawTalentPool() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("talent_pool_entries")
        .update({ status: "opt_out" as any, last_interaction: new Date().toISOString() })
        .eq("candidate_id", user!.id);
      if (error) throw error;

      await logTalentPoolEvent(user!.id, "withdrawn", { source: "candidate_action" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["talent_pool_entry"] });
      toast({ title: "Desistência confirmada", description: "Você saiu do Banco de Talentos. Pode reativar a qualquer momento." });
    },
    onError: (e: any) => {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    },
  });
}

// Prazo (horas) para o candidato aceitar um convite. Passado esse prazo o
// convite expira e some da lista do candidato (e o aceite é bloqueado).
export const INVITE_EXPIRY_HOURS = 72;

export function useTalentInvites() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["talent_invites", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("talent_invites")
        .select("*, unit_jobs(*, jobs(title, description), units(name, city, state))")
        .eq("candidate_id", user!.id)
        .order("invited_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useRespondInvite() {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "accepted" | "declined" }) => {
      // Block if candidate is already hired
      if (status === "accepted") {
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        if (currentUser) {
          const { count: alreadyHired } = await supabase
            .from("applications")
            .select("id", { count: "exact", head: true })
            .eq("candidate_id", currentUser.id)
            .eq("status", "contratado");
          if ((alreadyHired || 0) > 0) {
            throw new Error("Você já está contratado(a) em uma vaga. Não é possível aceitar novos convites.");
          }
        }
      }

      // Guard de prazo: o convite expira INVITE_EXPIRY_HOURS após o envio.
      // Se o prazo passou, bloqueia o aceite e marca o convite como expirado.
      if (status === "accepted") {
        const { data: inv } = await supabase
          .from("talent_invites")
          .select("invited_at, status")
          .eq("id", id)
          .maybeSingle();
        if (inv) {
          if ((inv as any).status !== "pending") {
            throw new Error("Este convite não está mais disponível.");
          }
          const ageMs = Date.now() - new Date((inv as any).invited_at).getTime();
          if (ageMs > INVITE_EXPIRY_HOURS * 60 * 60 * 1000) {
            await supabase
              .from("talent_invites")
              .update({ status: "expired" as any })
              .eq("id", id);
            throw new Error(`O prazo de ${INVITE_EXPIRY_HOURS}h para aceitar este convite expirou.`);
          }
        }
      }

      // Update the invite status
      const { data: invite, error } = await supabase
        .from("talent_invites")
        .update({ status, responded_at: new Date().toISOString() })
        .eq("id", id)
        .select("candidate_id, unit_job_id, restart_mode")
        .single();
      if (error) throw error;

      // Create or update the corresponding application
      if (invite) {
        if (status === "accepted") {
          // Auto-withdraw from other active processes (conflict management)
          const { data: activeApps } = await supabase
            .from("applications")
            .select("id, unit_job_id")
            .eq("candidate_id", invite.candidate_id)
            .in("status", ["em_andamento" as any, "pendente" as any])
            .neq("unit_job_id", invite.unit_job_id);

          if (activeApps && activeApps.length > 0) {
            for (const app of activeApps) {
              await supabase
                .from("applications")
                .update({ status: "desistente" as any, withdrawal_reason: "Aceite de outro processo seletivo via Banco de Talentos" })
                .eq("id", app.id);

              // Cancel related interviews
              await supabase
                .from("interviews")
                .update({ status: "cancelled" as any })
                .eq("application_id", app.id)
                .in("status", ["confirmed" as any, "rescheduled" as any]);
            }

            await logTalentPoolEvent(invite.candidate_id, "removed_conflict", {
              new_unit_job_id: invite.unit_job_id,
              withdrawn_applications: activeApps.map(a => a.id),
            });
          }

          // Check if an application already exists for this job
          const { data: existingApp } = await supabase
            .from("applications")
            .select("id, status")
            .eq("candidate_id", invite.candidate_id)
            .eq("unit_job_id", invite.unit_job_id)
            .maybeSingle();

          if (existingApp) {
            // Reativação: criar novo ciclo limpo (não reaproveitar progresso antigo)
            const mode = ((invite as any).restart_mode || "triagem") as
              | "triagem" | "teste" | "entrevista" | "documentacao" | "last_valid";
            try {
              await restartApplicationCycle(existingApp.id, mode, invite.candidate_id);
            } catch (e) {
              console.error("[restartApplicationCycle] failed:", e);
              // Fallback mínimo para não travar o fluxo
              await supabase
                .from("applications")
                .update({ status: "em_andamento" as any } as any)
                .eq("id", existingApp.id);
            }
          } else {
            // Determine first pipeline phase
            const { data: ujData2 } = await supabase
              .from("unit_jobs")
              .select("job_id")
              .eq("id", invite.unit_job_id)
              .single();

            let firstPhaseId: string | null = null;
            if (ujData2) {
              const { data: pipeline } = await supabase
                .from("job_pipelines")
                .select("id, pipeline_phases(id, order_index, phase_kind)")
                .eq("job_id", ujData2.job_id)
                .eq("is_active", true)
                .limit(1)
                .single();
              const sortedPhases = (pipeline?.pipeline_phases || [])
                .slice()
                .sort((a: any, b: any) => a.order_index - b.order_index);
              firstPhaseId =
                sortedPhases.find((p: any) => (p.phase_kind || "avaliacao") !== "triagem")?.id ||
                sortedPhases[0]?.id ||
                null;
            }

            // Create new application
            await supabase
              .from("applications")
              .insert({
                candidate_id: invite.candidate_id,
                unit_job_id: invite.unit_job_id,
                current_phase: firstPhaseId,
                status: "em_andamento" as any,
              });
          }

          // Update talent pool entry status to in_process
          await supabase
            .from("talent_pool_entries")
            .update({ status: "in_process" as any, last_interaction: new Date().toISOString() })
            .eq("candidate_id", invite.candidate_id);
        } else {
          // Declined — update existing application if any
          await supabase
            .from("applications")
            .update({ status: "desistente" as any })
            .eq("candidate_id", invite.candidate_id)
            .eq("unit_job_id", invite.unit_job_id)
            .in("status", ["pendente" as any, "em_andamento" as any]);
        }

        // Notify admins about the response
        const { data: ujData } = await supabase
          .from("unit_jobs")
          .select("unit_id, jobs:job_id(title), units:unit_id(name)")
          .eq("id", invite.unit_job_id)
          .single();
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", invite.candidate_id)
          .single();
        const jobTitle = (ujData as any)?.jobs?.title || "vaga";
        const unitName = (ujData as any)?.units?.name || "unidade";
        const candidateName = profile?.full_name || "Candidato";
        const unitId = (ujData as any)?.unit_id;
        const eventType = status === "accepted" ? "talent_invite_accepted" : "talent_invite_declined";
        const title = status === "accepted" ? "Convite aceito" : "Convite recusado";
        const body = status === "accepted"
          ? `${candidateName} aceitou o convite para o processo seletivo de ${jobTitle} na ${unitName}.`
          : `${candidateName} recusou o convite para o processo seletivo de ${jobTitle} na ${unitName}.`;

        const adminIds = await getAdminRecipientIds(unitId);
        if (adminIds.length > 0) {
          await supabase.from("notifications" as any).insert(
            adminIds.map((recipientId) => ({
              event_type: eventType,
              recipient_id: recipientId,
              channel: "push",
              title,
              body,
              status: "pending",
              action_url: invite.unit_job_id
                ? `/admin/vagas/${invite.unit_job_id}/candidatos`
                : "/admin/vagas",
              action_type: "info",
              payload: { unit_job_id: invite.unit_job_id, candidate_id: invite.candidate_id, job_title: jobTitle, unit_name: unitName },
            } as any))
          );
        }

        // Log the event
        await logTalentPoolEvent(invite.candidate_id, status === "accepted" ? "accepted" : "declined", {
          unit_job_id: invite.unit_job_id,
          invite_id: id,
          job_title: jobTitle,
        });
      }
    },
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: ["talent_invites"] });
      qc.invalidateQueries({ queryKey: ["my_applications"] });
      qc.invalidateQueries({ queryKey: ["pipeline_candidaturas"] });
      qc.invalidateQueries({ queryKey: ["admin_talent_pool"] });
      toast({
        title: v.status === "accepted" ? "Convite aceito!" : "Convite recusado",
        description: v.status === "accepted"
          ? "Você agora está no processo seletivo desta vaga."
          : "Sua candidatura foi cancelada.",
      });
    },
    onError: (e: any) => {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    },
  });
}

// Admin hooks
export function useAdminTalentPool(entryOrigin?: string) {
  const qc = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel("talent-pool-admin-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "talent_pool_entries" }, () => {
        qc.invalidateQueries({ queryKey: ["admin_talent_pool"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "talent_invites" }, () => {
        qc.invalidateQueries({ queryKey: ["admin_talent_invites"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);

  return useQuery({
    queryKey: ["admin_talent_pool", entryOrigin],
    queryFn: async () => {
      // Item 15: standby_visibility — filter by scope
      const { data: visibilitySetting } = await supabase
        .from("global_settings")
        .select("value")
        .eq("category", "talent_pool")
        .eq("key", "standby_visibility")
        .maybeSingle();
      const visibility = (visibilitySetting?.value as string) || "global";

      let query = supabase
        .from("talent_pool_entries")
        .select("*, profiles(full_name, email, city, state, phone, cpf, birth_date, gender, cep, resume_url, opt_in_talent_pool, is_active), jobs:last_job_id(title), units:origin_unit_id(name, city, state)") as any;
      query = query.order("global_score", { ascending: false });

      if (entryOrigin) {
        query = query.eq("entry_origin" as any, entryOrigin);
      }
      // Show ALL entries including auto-enrolled candidates

      const { data, error } = await query;
      if (error) throw error;

      // Fetch admin/rh user IDs to exclude them
      const { data: adminRoles } = await supabase
        .from("user_roles")
        .select("user_id")
        .in("role", ["admin", "rh_franqueadora", "auditor_admin", "gestor_recrutamento", "franqueado"]);

      const adminIds = new Set((adminRoles || []).map((r: any) => r.user_id));

      // Filtra admins e candidatos desativados (is_active=false em profiles/candidates)
      let candidates = (data || []).filter((entry: any) =>
        !adminIds.has(entry.candidate_id) && entry.profiles?.is_active !== false
      );

      // Item 15: Apply visibility scope filtering
      if (visibility === "unit") {
        // Get current user's unit IDs
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        if (currentUser) {
          const { data: userRoles } = await supabase
            .from("user_roles")
            .select("unit_id")
            .eq("user_id", currentUser.id)
            .not("unit_id", "is", null);
          const myUnitIds = (userRoles || []).map((r: any) => r.unit_id);
          if (myUnitIds.length > 0) {
            candidates = candidates.filter((entry: any) =>
              entry.origin_unit_id && myUnitIds.includes(entry.origin_unit_id)
            );
          }
        }
      } else if (visibility === "regional") {
        // Filter by same state/region as user's units
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        if (currentUser) {
          const { data: userRoles } = await supabase
            .from("user_roles")
            .select("unit_id")
            .eq("user_id", currentUser.id)
            .not("unit_id", "is", null);
          const myUnitIds = (userRoles || []).map((r: any) => r.unit_id);
          if (myUnitIds.length > 0) {
            const { data: myUnitsData } = await supabase
              .from("units")
              .select("state")
              .in("id", myUnitIds);
            const myStates = new Set((myUnitsData || []).map((u: any) => u.state).filter(Boolean));
            if (myStates.size > 0) {
              candidates = candidates.filter((entry: any) => {
                const entryState = entry.profiles?.state;
                return entryState && myStates.has(entryState);
              });
            }
          }
        }
      }
      // visibility === "global" → no filtering

      // Enrich with latest application status per candidate
      const candidateIds = candidates.map((e: any) => e.candidate_id);
      if (candidateIds.length > 0) {
        const { data: latestApps } = await supabase
          .from("applications")
          .select("candidate_id, status, unit_jobs(jobs(title))")
          .in("candidate_id", candidateIds)
          .order("created_at", { ascending: false });

        // Build map: candidate_id -> best app status (prioritize contratado)
        const statusPriority: Record<string, number> = { contratado: 5, em_andamento: 4, aprovado: 3, pendente: 2, standby: 1, reprovado: 1, desistente: 0, desligado: 0 };
        const appMap = new Map<string, { app_status: string; app_job_title: string }>();
        for (const app of (latestApps || [])) {
          const existing = appMap.get(app.candidate_id);
          const currentPriority = statusPriority[app.status] ?? 0;
          const existingPriority = existing ? (statusPriority[existing.app_status] ?? 0) : -1;
          if (currentPriority > existingPriority) {
            appMap.set(app.candidate_id, {
              app_status: app.status,
              app_job_title: (app as any).unit_jobs?.jobs?.title || "",
            });
          }
        }

        return candidates.map((entry: any) => ({
          ...entry,
          _app_status: appMap.get(entry.candidate_id)?.app_status || null,
          _app_job_title: appMap.get(entry.candidate_id)?.app_job_title || null,
        })).sort((a: any, b: any) =>
          (a.profiles?.full_name || "").toLowerCase().localeCompare((b.profiles?.full_name || "").toLowerCase(), "pt-BR")
        );
      }

      return candidates.slice().sort((a: any, b: any) =>
        (a.profiles?.full_name || "").toLowerCase().localeCompare((b.profiles?.full_name || "").toLowerCase(), "pt-BR")
      );
    },
  });
}

export function useAdminTalentInvites() {
  return useQuery({
    queryKey: ["admin_talent_invites"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("talent_invites")
        .select("*, profiles(full_name), unit_jobs(*, jobs(title), units(name))")
        .order("invited_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []).slice().sort((a: any, b: any) =>
        (a.profiles?.full_name || "").toLowerCase().localeCompare((b.profiles?.full_name || "").toLowerCase(), "pt-BR")
      );
    },
  });
}

export function useReactivateTalent() {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (
      input: string | { candidateId: string; mode?: import("@/lib/applicationCycle").RestartMode },
    ) => {
      const candidateId = typeof input === "string" ? input : input.candidateId;
      const mode = (typeof input === "object" && input.mode) || "triagem";

      // 1) Reativar entrada do banco de talentos
      const { error } = await supabase
        .from("talent_pool_entries")
        .update({
          status: "active",
          standby_reason: null,
          last_interaction: new Date().toISOString(),
        } as any)
        .eq("candidate_id", candidateId);
      if (error) throw error;

      // 2) Se houver candidaturas reprovadas/desistentes/em standby, reiniciar
      //    o ciclo da mais recente para começar limpo no novo processo.
      const { data: apps } = await supabase
        .from("applications")
        .select("id, status, updated_at")
        .eq("candidate_id", candidateId)
        .in("status", ["reprovado", "desistente", "standby"] as any)
        .order("updated_at", { ascending: false })
        .limit(1);

      if (apps && apps[0]) {
        try {
          await restartApplicationCycle(apps[0].id, mode, candidateId);
        } catch (e) {
          console.error("[useReactivateTalent] restart failed:", e);
        }
      }

      await logTalentPoolEvent(candidateId, "reactivated", { source: "admin_action", mode });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin_talent_pool"] });
      qc.invalidateQueries({ queryKey: ["my_applications"] });
      qc.invalidateQueries({ queryKey: ["application_status"] });
      qc.invalidateQueries({ queryKey: ["candidate_timeline"] });
      qc.invalidateQueries({ queryKey: ["candidates_by_job"] });
      qc.invalidateQueries({ queryKey: ["interviews"] });
      qc.invalidateQueries({ queryKey: ["test_assignments"] });
      qc.invalidateQueries({ queryKey: ["document_requests"] });
      toast({ title: "Talento reativado com sucesso!" });
    },
    onError: (e: any) => {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    },
  });
}

export function useAdminInviteToTalentPool() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ candidateId, unitJobId }: { candidateId: string; unitJobId?: string }) => {
      const { data: existing } = await supabase
        .from("talent_pool_entries")
        .select("id, status")
        .eq("candidate_id", candidateId)
        .maybeSingle();

      if (existing) {
        if (existing.status === "opt_out" || existing.status === "archived") {
          const { error } = await supabase
            .from("talent_pool_entries")
            .update({ status: "active", last_interaction: new Date().toISOString() } as any)
            .eq("candidate_id", candidateId);
          if (error) throw error;
        }
        return { alreadyExists: true };
      }

      let lastJobId: string | null = null;
      let originUnitId: string | null = null;
      if (unitJobId) {
        const { data: unitJob } = await supabase
          .from("unit_jobs")
          .select("job_id, unit_id")
          .eq("id", unitJobId)
          .single();
        lastJobId = unitJob?.job_id || null;
        originUnitId = unitJob?.unit_id || null;
      }

      const { error } = await supabase.from("talent_pool_entries").insert({
        candidate_id: candidateId,
        entry_origin: "rejected_invited",
        last_job_id: lastJobId,
        origin_unit_id: originUnitId,
        status: "active",
      } as any);
      if (error) throw error;
      return { alreadyExists: false };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin_talent_pool"] });
    },
  });
}

export function useDispatchMatching() {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (unitJobId: string) => {
      const { data: { session } } = await supabase.auth.getSession();

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60_000);

      try {
        const res = await fetch(
          `${SUPABASE_URL}/functions/v1/match-talents`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session?.access_token}`,
              apikey: SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({ unit_job_id: unitJobId }),
            signal: controller.signal,
          }
        );
        if (!res.ok) {
          let msg = "Erro no matching";
          try {
            const err = await res.json();
            msg = err.error || msg;
          } catch {
            // ignore
          }
          throw new Error(msg);
        }
        return res.json();
      } catch (e: any) {
        if (e?.name === "AbortError") {
          throw new Error(
            "Tempo esgotado ao disparar o matching. Os convites podem ter sido criados — confira a lista em alguns segundos."
          );
        }
        throw e;
      } finally {
        clearTimeout(timeoutId);
      }
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["admin_talent_invites"] });
      qc.invalidateQueries({ queryKey: ["admin_talent_pool"] });
      toast({ title: "Matching concluído", description: data.message });
    },
    onError: (e: any) => {
      toast({ title: "Erro no matching", description: e.message, variant: "destructive" });
    },
  });
}

// Talent Pool Logs — query for a specific candidate or all
export function useTalentPoolLogs(candidateId?: string) {
  return useQuery({
    queryKey: ["talent_pool_logs", candidateId],
    queryFn: async () => {
      let query = supabase
        .from("talent_pool_logs" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      if (candidateId) {
        query = query.eq("candidate_id", candidateId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as Array<{
        id: string;
        candidate_id: string;
        event: string;
        context: Record<string, any>;
        created_at: string;
      }>;
    },
  });
}

// Candidate's own logs
export function useMyTalentPoolLogs() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my_talent_pool_logs", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("talent_pool_logs" as any)
        .select("*")
        .eq("candidate_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as unknown as Array<{
        id: string;
        candidate_id: string;
        event: string;
        context: Record<string, any>;
        created_at: string;
      }>;
    },
  });
}

/**
 * Lists pending/declined invites for a given unit_job (admin view).
 * Used to render "Convite enviado / Recusou" states on standby candidate cards.
 */
export function useUnitJobInvites(unitJobId: string | undefined) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!unitJobId) return;
    const ch = supabase
      .channel(`unit-job-invites-${unitJobId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "talent_invites", filter: `unit_job_id=eq.${unitJobId}` }, () => {
        qc.invalidateQueries({ queryKey: ["unit_job_invites", unitJobId] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [unitJobId, qc]);

  return useQuery({
    queryKey: ["unit_job_invites", unitJobId],
    enabled: !!unitJobId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("talent_invites")
        .select("id, candidate_id, status, channel, restart_mode, invited_at, responded_at")
        .eq("unit_job_id", unitJobId!)
        .order("invited_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
}

/**
 * Admin sends a "resume candidacy" invite to a candidate currently in standby
 * for a specific unit_job. The candidate must accept (via /standby) to actually
 * resume the application — this does NOT auto-reactivate.
 */
export function useInviteStandbyToResume() {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ candidateId, unitJobId, candidateName, restartMode }: { candidateId: string; unitJobId: string; candidateName?: string; restartMode?: import("@/lib/applicationCycle").RestartMode }) => {
      // 1) Validate the unit_job is open and has room
      const { data: uj, error: ujErr } = await supabase
        .from("unit_jobs")
        .select("id, status, openings, unit_id, jobs:job_id(title), units:unit_id(name)")
        .eq("id", unitJobId)
        .single();
      if (ujErr || !uj) throw new Error("Vaga não encontrada.");
      if (uj.status !== "aberta") throw new Error("Esta vaga não está aberta para convites.");

      const { count: hiredCount } = await supabase
        .from("applications")
        .select("id", { count: "exact", head: true })
        .eq("unit_job_id", unitJobId)
        .eq("status", "contratado");
      if ((hiredCount || 0) >= (uj.openings || 1)) {
        throw new Error("Esta vaga já foi totalmente preenchida.");
      }

      // 2) Tratar invites pendentes preexistentes:
      //    - se for do motor automático (channel != 'sistema'), expirar e prosseguir
      //    - se já for um convite manual do admin (channel='sistema'), bloquear
      const { data: pendingList } = await supabase
        .from("talent_invites")
        .select("id, channel")
        .eq("candidate_id", candidateId)
        .eq("unit_job_id", unitJobId)
        .eq("status", "pending");

      const manualPending = (pendingList || []).find((p: any) => p.channel === "sistema");
      if (manualPending) {
        throw new Error("Já existe um convite aguardando resposta deste candidato para esta vaga. Cancele o convite anterior antes de enviar um novo.");
      }
      const autoPendingIds = (pendingList || [])
        .filter((p: any) => p.channel !== "sistema")
        .map((p: any) => p.id);
      if (autoPendingIds.length > 0) {
        await supabase
          .from("talent_invites")
          .update({ status: "expired", responded_at: new Date().toISOString() } as any)
          .in("id", autoPendingIds);
      }

      // 3) Create the invite
      const { error: invErr } = await supabase.from("talent_invites").insert({
        candidate_id: candidateId,
        unit_job_id: unitJobId,
        channel: "sistema",
        status: "pending",
        restart_mode: restartMode || "triagem",
      } as any);
      if (invErr) throw invErr;

      // 4) Notify the candidate
      const jobTitle = (uj as any).jobs?.title || "uma vaga";
      const unitName = (uj as any).units?.name || "";
      await supabase.from("notifications").insert({
        recipient_id: candidateId,
        event_type: "talent_invite_received",
        channel: "in_app",
        title: "Boa notícia! Vaga reaberta",
        body: `A vaga ${jobTitle}${unitName ? ` (${unitName})` : ""} foi reaberta. Deseja retomar sua candidatura?`,
        status: "pending",
        action_url: "/lista-oportunidade",
        action_type: "info",
        payload: { unit_job_id: unitJobId, job_title: jobTitle, unit_name: unitName },
      } as any);

      // 5) Log
      await logTalentPoolEvent(candidateId, "invited", {
        unit_job_id: unitJobId,
        job_title: jobTitle,
        source: "admin_resume_invite",
      });

      return { candidateName, jobTitle };
    },
    onSuccess: ({ candidateName, jobTitle }) => {
      qc.invalidateQueries({ queryKey: ["unit_job_invites"] });
      qc.invalidateQueries({ queryKey: ["admin_talent_invites"] });
      toast({
        title: "Convite enviado",
        description: `${candidateName || "O candidato"} foi convidado(a) a retomar a candidatura para ${jobTitle}. Aguarde a resposta.`,
      });
    },
    onError: (e: any) => {
      toast({ title: "Não foi possível convidar", description: e.message, variant: "destructive" });
    },
  });
}

/**
 * Admin cancels a pending invite to resume.
 */
export function useCancelStandbyInvite() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (inviteId: string) => {
      const { error } = await supabase
        .from("talent_invites")
        .update({ status: "expired", responded_at: new Date().toISOString() } as any)
        .eq("id", inviteId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["unit_job_invites"] });
      toast({ title: "Convite cancelado" });
    },
    onError: (e: any) => {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    },
  });
}
