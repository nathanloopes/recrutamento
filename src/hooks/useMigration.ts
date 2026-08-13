import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { sendPushToDevice } from "@/hooks/useNotifications";

// ── CrossConfig helpers ──

async function getMigrationSetting(key: string): Promise<any> {
  const { data } = await supabase
    .from("global_settings")
    .select("value")
    .eq("category", "migration")
    .eq("key", key)
    .maybeSingle();
  return data?.value;
}

// ── Admin: Migration Logs ──

export function useMigrationLogs(statusFilter?: string) {
  return useQuery({
    queryKey: ["migration_logs", statusFilter],
    queryFn: async () => {
      let q = supabase
        .from("migration_logs" as any)
        .select("*, profiles:candidate_id(full_name, email, phone), candidates:candidate_id(cpf), units:unit_id(name), jobs:job_id(title)")
        .order("created_at", { ascending: false });
      if (statusFilter && statusFilter !== "all") {
        q = q.eq("status", statusFilter);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data as any[]) || [];
    },
  });
}

// ── Admin: Onboarding Statuses ──

export function useOnboardingStatuses(statusFilter?: string) {
  return useQuery({
    queryKey: ["onboarding_statuses", statusFilter],
    queryFn: async () => {
      let q = supabase
        .from("onboarding_status" as any)
        .select("*, profiles:candidate_id(full_name, email), migration_logs:migration_id(unit_id, job_id, units:unit_id(name), jobs:job_id(title))")
        .order("created_at", { ascending: false });
      if (statusFilter === "completed") {
        q = q.eq("is_completed", true);
      } else if (statusFilter === "pending") {
        q = q.eq("is_completed", false);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data as any[]) || [];
    },
  });
}

// ── Admin: Metrics ──

export function useMigrationMetrics() {
  const { hasRole, unitIds } = useAuth();
  const isSuperAdmin = hasRole("admin");

  return useQuery({
    queryKey: ["migration_metrics", isSuperAdmin, unitIds],
    queryFn: async () => {
      let logsQuery = supabase
        .from("migration_logs" as any)
        .select("status, unit_id");
      if (!isSuperAdmin && unitIds.length > 0) {
        logsQuery = logsQuery.in("unit_id", unitIds);
      }
      const { data: logs, error: e1 } = await logsQuery;
      if (e1) throw e1;

      const allLogs = (logs as any[]) || [];

      let onbQuery = supabase
        .from("onboarding_status" as any)
        .select("is_completed, started_at, created_at, migration_id");
      if (!isSuperAdmin && unitIds.length > 0) {
        const { data: scopedMigrations } = await supabase
          .from("migration_logs" as any)
          .select("id")
          .in("unit_id", unitIds);
        const migrationIds = (scopedMigrations as any[] || []).map((m: any) => m.id);
        if (migrationIds.length > 0) {
          onbQuery = onbQuery.in("migration_id", migrationIds);
        } else {
          return {
            total: allLogs.length,
            pending: allLogs.filter((l) => l.status === "pending").length,
            completed: allLogs.filter((l) => l.status === "completed").length,
            failed: allLogs.filter((l) => l.status === "failed").length,
            onboardingTotal: 0,
            onboardingCompleted: 0,
            onboardingStalled: 0,
          };
        }
      }
      const { data: onboardings, error: e2 } = await onbQuery;
      if (e2) throw e2;

      const allOnb = (onboardings as any[]) || [];

      const now = Date.now();
      const stalledThresholdMs = 48 * 60 * 60 * 1000;

      return {
        total: allLogs.length,
        pending: allLogs.filter((l) => l.status === "pending").length,
        completed: allLogs.filter((l) => l.status === "completed").length,
        failed: allLogs.filter((l) => l.status === "failed").length,
        onboardingTotal: allOnb.length,
        onboardingCompleted: allOnb.filter((o) => o.is_completed).length,
        onboardingStalled: allOnb.filter(
          (o) =>
            !o.is_completed &&
            now - new Date(o.started_at || o.created_at).getTime() > stalledThresholdMs
        ).length,
      };
    },
  });
}

// ── Helper: Check if auto_migrate_enabled ──

export async function isAutoMigrateEnabled(): Promise<boolean> {
  const val = await getMigrationSetting("auto_migrate_enabled");
  if (val === false || val === "false") return false;
  return true; // default true
}

// ── Helper: Get allowed roles from CrossConfig ──

async function getAllowedRoles(): Promise<string[]> {
  const val = await getMigrationSetting("allowed_roles");
  if (Array.isArray(val)) return val;
  if (typeof val === "string") {
    try { return JSON.parse(val); } catch { return ["colaborador"]; }
  }
  return ["colaborador"];
}

// ── Helper: Get onboarding steps from CrossConfig ──

async function getOnboardingSteps(): Promise<string[]> {
  const val = await getMigrationSetting("onboarding_steps");
  if (Array.isArray(val)) return val;
  if (typeof val === "string") {
    try { return JSON.parse(val); } catch { /* fall through */ }
  }
  return ["aceitar_termos", "confirmar_dados", "definir_senha"];
}

// ── Create Migration (called after hiring) ──

export function useCreateMigration() {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      candidateId,
      applicationId,
      unitId,
      jobId,
      triggeredBy,
    }: {
      candidateId: string;
      applicationId: string;
      unitId: string;
      jobId: string;
      triggeredBy?: string;
    }) => {
      // Gap 3 fix: Block duplicate migration
      const { data: existing } = await supabase
        .from("migration_logs" as any)
        .select("id")
        .eq("candidate_id", candidateId)
        .eq("application_id", applicationId)
        .neq("status", "failed")
        .limit(1);
      if (existing && (existing as any[]).length > 0) {
        throw new Error("Já existe uma migração ativa para este candidato e candidatura.");
      }

      // Get CPF from profile
      const { data: profile, error: pErr } = await supabase
        .from("profiles")
        .select("cpf, full_name, email, phone")
        .eq("id", candidateId)
        .single();
      if (pErr) throw pErr;
      if (!profile?.cpf) throw new Error("Candidato sem CPF cadastrado");

      // Gap 1 fix: Get allowed_roles from CrossConfig to determine target_role
      const allowedRoles = await getAllowedRoles();
      const targetRole = allowedRoles[0] || "colaborador";

      // Get onboarding steps from CrossConfig
      const onboardingSteps = await getOnboardingSteps();

      // Get invite_expiration_hours from CrossConfig
      const expirationHours = await getMigrationSetting("invite_expiration_hours");
      const hours = typeof expirationHours === 'number' ? expirationHours : parseInt(expirationHours) || 72;
      const inviteExpiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

      // Create migration log
      const { data: migration, error: mErr } = await supabase
        .from("migration_logs" as any)
        .insert({
          candidate_id: candidateId,
          application_id: applicationId,
          unit_id: unitId,
          job_id: jobId,
          target_role: targetRole,
          triggered_by: triggeredBy || null,
          status: "pending",
          invite_expires_at: inviteExpiresAt,
        } as any)
        .select("id")
        .single();
      if (mErr) throw mErr;

      // Create onboarding status using CrossConfig steps
      const { error: oErr } = await supabase
        .from("onboarding_status" as any)
        .insert({
          migration_id: (migration as any).id,
          candidate_id: candidateId,
          current_step: onboardingSteps[0] || "aceitar_termos",
          steps_completed: [],
        } as any);
      if (oErr) throw oErr;

      // Send push notification
      const { data: templates } = await supabase
        .from("notification_templates")
        .select("*")
        .eq("event_type", "migration_completed")
        .eq("channel", "push")
        .eq("is_active", true)
        .limit(1);

      const tpl = templates?.[0];
      const title = tpl?.title?.replace("{{nome}}", profile.full_name) || "Integração Iniciada";
      const body = tpl?.body?.replace("{{nome}}", profile.full_name) || "Seu onboarding foi iniciado.";

      await supabase.from("notifications").insert({
        event_type: "migration_completed",
        recipient_id: candidateId,
        channel: "push",
        template_id: tpl?.id || null,
        payload: { nome: profile.full_name },
        title,
        body,
        status: "sent",
      } as any);

      await sendPushToDevice({
        recipientId: candidateId,
        title,
        body,
      });

      // Gap 2 fix: Send WhatsApp notification
      try {
        const { data: whatsappTpl } = await supabase
          .from("notification_templates")
          .select("*")
          .eq("event_type", "migration_completed")
          .eq("channel", "whatsapp")
          .eq("is_active", true)
          .limit(1);

        if (whatsappTpl?.[0] && profile.phone) {
          const waTitle = whatsappTpl[0].title?.replace("{{nome}}", profile.full_name) || title;
          const waBody = whatsappTpl[0].body?.replace("{{nome}}", profile.full_name) || body;

          await supabase.from("notifications").insert({
            event_type: "migration_completed",
            recipient_id: candidateId,
            channel: "whatsapp",
            template_id: whatsappTpl[0].id,
            payload: { nome: profile.full_name, phone: profile.phone },
            title: waTitle,
            body: waBody,
            status: "pending",
          } as any);

          // Invoke send-whatsapp Edge Function
          supabase.functions.invoke("send-whatsapp", {
            body: {
              phone: profile.phone,
              message: waBody,
            },
          }).catch((err) => console.error("[Migration] WhatsApp send error:", err));
        }
      } catch (e) {
        console.error("[Migration] WhatsApp notification error:", e);
      }

      // Gap 2 fix: Send Email notification
      try {
        const { data: emailTpl } = await supabase
          .from("notification_templates")
          .select("*")
          .eq("event_type", "migration_completed")
          .eq("channel", "email")
          .eq("is_active", true)
          .limit(1);

        if (emailTpl?.[0] && profile.email) {
          const emTitle = emailTpl[0].title?.replace("{{nome}}", profile.full_name) || title;
          const emBody = emailTpl[0].body?.replace("{{nome}}", profile.full_name) || body;

          await supabase.from("notifications").insert({
            event_type: "migration_completed",
            recipient_id: candidateId,
            channel: "email",
            template_id: emailTpl[0].id,
            payload: { nome: profile.full_name, email: profile.email },
            title: emTitle,
            body: emBody,
            status: "pending",
          } as any);

          supabase.functions.invoke("send-email", {
            body: {
              to: profile.email,
              subject: emTitle,
              html: `<p>${emBody}</p>`,
            },
          }).catch((err) => console.error("[Migration] Email send error:", err));
        }
      } catch (e) {
        console.error("[Migration] Email notification error:", e);
      }

      return (migration as any).id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["migration_logs"] });
      qc.invalidateQueries({ queryKey: ["onboarding_statuses"] });
      qc.invalidateQueries({ queryKey: ["migration_metrics"] });
      toast({ title: "Migração criada com sucesso" });
    },
    onError: (e: any) => {
      toast({ title: "Erro na migração", description: e.message, variant: "destructive" });
    },
  });
}

// ── Resend Migration Invite ──

export function useResendMigrationInvite() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ candidateId, candidateName, phone, email }: {
      candidateId: string;
      candidateName?: string;
      phone?: string;
      email?: string;
    }) => {
      const title = "Lembrete: Complete seu onboarding!";
      const body = `Olá${candidateName ? ` ${candidateName}` : ""}! Você ainda tem etapas pendentes no seu onboarding. Acesse o sistema para continuar.`;

      // Push
      await supabase.from("notifications").insert({
        event_type: "migration_reminder",
        recipient_id: candidateId,
        channel: "push",
        title,
        body,
        status: "pending",
      } as any);

      await sendPushToDevice({
        recipientId: candidateId,
        title,
        body,
      });

      // WhatsApp
      if (phone) {
        supabase.functions.invoke("send-whatsapp", {
          body: { phone, message: body },
        }).catch((err) => console.error("[Resend] WhatsApp error:", err));
      }

      // Email
      if (email) {
        supabase.functions.invoke("send-email", {
          body: { to: email, subject: title, html: `<p>${body}</p>` },
        }).catch((err) => console.error("[Resend] Email error:", err));
      }
    },
    onSuccess: () => {
      toast({ title: "Convite reenviado com sucesso" });
    },
    onError: (e: any) => {
      toast({ title: "Erro ao reenviar", description: e.message, variant: "destructive" });
    },
  });
}

// ── Candidate: My Onboarding ──

export function useMyOnboarding() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my_onboarding", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("onboarding_status" as any)
        .select("*, migration_logs:migration_id(unit_id, job_id, units:unit_id(name), jobs:job_id(title))")
        .eq("candidate_id", user!.id)
        .eq("is_completed", false)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as any | null;
    },
  });
}

// ── Candidate: Complete Onboarding Step ──

export function useCompleteOnboardingStep() {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      onboardingId,
      stepName,
      currentCompleted,
      allSteps,
    }: {
      onboardingId: string;
      stepName: string;
      currentCompleted: string[];
      allSteps: string[];
    }) => {
      const newCompleted = [...currentCompleted, stepName];
      const currentIdx = allSteps.indexOf(stepName);
      const nextStep = allSteps[currentIdx + 1] || stepName;
      const isLast = currentIdx === allSteps.length - 1;

      const updates: any = {
        steps_completed: newCompleted,
        current_step: isLast ? stepName : nextStep,
        started_at: currentCompleted.length === 0 ? new Date().toISOString() : undefined,
      };

      if (isLast) {
        updates.is_completed = true;
        updates.completed_at = new Date().toISOString();
      }

      Object.keys(updates).forEach((k) => updates[k] === undefined && delete updates[k]);

      const { error } = await supabase
        .from("onboarding_status" as any)
        .update(updates)
        .eq("id", onboardingId);
      if (error) throw error;

      if (isLast) {
        const { data: onb } = await supabase
          .from("onboarding_status" as any)
          .select("migration_id")
          .eq("id", onboardingId)
          .single();
        if (onb) {
          await supabase
            .from("migration_logs" as any)
            .update({ status: "completed", completed_at: new Date().toISOString() } as any)
            .eq("id", (onb as any).migration_id);
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my_onboarding"] });
      qc.invalidateQueries({ queryKey: ["migration_logs"] });
      qc.invalidateQueries({ queryKey: ["migration_metrics"] });
      toast({ title: "Etapa concluída!" });

      supabase.from("activity_logs").insert({
        action: "onboarding_step_concluido",
        module: "migracao",
        details: {},
      } as any).then(({ error }) => {
        if (error) console.error("[AuditLog] onboarding log failed:", error.message);
      });
    },
    onError: (e: any) => {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    },
  });
}

// ── Export onboarding steps fetcher for use in UI ──
export { getOnboardingSteps };
