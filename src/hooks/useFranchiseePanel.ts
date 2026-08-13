import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUnitMonitoringData } from "@/hooks/useUnitMonitoring";
import { useUnitUsage } from "@/hooks/useUnitUsage";

/**
 * Painel do Franqueado / Acompanhamento da Unidade.
 *
 * Compõe fontes JÁ existentes por unidade:
 *  - useUnitMonitoringData(): vagas, candidatos, contratações, vagas paradas, tempo médio.
 *  - useUnitUsage(): frequência/adesão (ações e último acesso via activity_logs).
 *  - RPC get_users_last_login: último login e nome do franqueado.
 *  - unit_implementation: registro-base (status, responsável, próxima ação) + estado de
 *    acompanhamento do RH (checklist, marcos manuais, observações).
 *  - unit_timeline_notes: notas datadas manuais da timeline.
 *
 * A "Saúde da Unidade" (🟢/🟡/🔴) é calculada automaticamente por computeUnitHealth().
 *
 * Universo = unidades com franqueado (user_roles) OU com registro de implantação.
 */

const DAY_MS = 86_400_000;

export type ImplementationStatus = "nao_iniciada" | "agendado" | "em_andamento" | "concluido";
/** @deprecated Engajamento manual foi substituído por saúde automática (computeUnitHealth). */
export type EngagementLevel = "alto" | "medio" | "baixo";
export type HealthLevel = "saudavel" | "atencao" | "critico";

export interface OnboardingChecklist {
  apresentacao: boolean;
  manual_enviado: boolean;
  acesso_liberado: boolean;
  login_realizado: boolean;
  primeira_vaga: boolean;
}
export interface DivulgacaoChecklist {
  instagram: boolean;
  linkedin: boolean;
  whatsapp: boolean;
  facebook: boolean;
}
export interface UnitChecklist {
  onboarding: OnboardingChecklist;
  divulgacao: DivulgacaoChecklist;
}
export interface UnitMilestones {
  primeira_reuniao: string | null;
  onboarding_apresentado: string | null;
  loja_inaugurada: string | null;
}
export interface UnitHealth {
  level: HealthLevel;
  reasons: string[];
}

export function emptyChecklist(): UnitChecklist {
  return {
    onboarding: {
      apresentacao: false,
      manual_enviado: false,
      acesso_liberado: false,
      login_realizado: false,
      primeira_vaga: false,
    },
    divulgacao: { instagram: false, linkedin: false, whatsapp: false, facebook: false },
  };
}
export function emptyMilestones(): UnitMilestones {
  return { primeira_reuniao: null, onboarding_apresentado: null, loja_inaugurada: null };
}

/** Normaliza o JSONB do banco (que pode vir parcial/nulo) para a forma completa. */
function normalizeChecklist(raw: any): UnitChecklist {
  const base = emptyChecklist();
  if (raw && typeof raw === "object") {
    base.onboarding = { ...base.onboarding, ...(raw.onboarding || {}) };
    base.divulgacao = { ...base.divulgacao, ...(raw.divulgacao || {}) };
  }
  return base;
}
function normalizeMilestones(raw: any): UnitMilestones {
  const base = emptyMilestones();
  if (raw && typeof raw === "object") {
    if (typeof raw.primeira_reuniao === "string") base.primeira_reuniao = raw.primeira_reuniao;
    if (typeof raw.onboarding_apresentado === "string") base.onboarding_apresentado = raw.onboarding_apresentado;
    if (typeof raw.loja_inaugurada === "string") base.loja_inaugurada = raw.loja_inaugurada;
  }
  return base;
}

export function isOnboardingComplete(c: UnitChecklist): boolean {
  return Object.values(c.onboarding).every(Boolean);
}

export interface FranchiseeRow {
  unitId: string;
  unitName: string;
  city: string | null;
  state: string | null;
  franqueadoNames: string[];
  franqueadoIds: string[];
  hasRecord: boolean;
  // registro de implantação (defaults quando ainda não existe)
  status: ImplementationStatus;
  responsavelId: string | null;
  nextAction: string | null;
  nextActionDate: string | null;
  checklist: UnitChecklist;
  milestones: UnitMilestones;
  observacoes: string | null;
  // métricas automáticas
  openJobs: number;
  closedJobs: number;
  avgDaysToFill: number;
  totalCandidates: number;
  hired: number;
  stalledJobs: number;
  oldestOpenJobDays: number;
  lastAccess: string | null;
  actions: number;
  daysSinceLast: number | null;
  // saúde calculada
  health: UnitHealth;
}

/**
 * Calcula a "Saúde da Unidade" de forma transparente: cada sinal vira uma
 * razão legível, e o nível final é o pior sinal disparado.
 */
export function computeUnitHealth(r: {
  franqueadoIds: string[];
  daysSinceLast: number | null;
  actions: number;
  openJobs: number;
  totalCandidates: number;
  hired: number;
  stalledJobs: number;
  checklist: UnitChecklist;
  status: ImplementationStatus;
}): UnitHealth {
  const reasons: string[] = [];
  let critical = false;
  let attention = false;

  const hasFranq = r.franqueadoIds.length > 0;
  const onboardingDone = isOnboardingComplete(r.checklist);

  // Acesso
  if (hasFranq && r.daysSinceLast == null) {
    critical = true;
    reasons.push("Nunca acessou a plataforma");
  } else if (r.daysSinceLast != null && r.daysSinceLast > 30) {
    critical = true;
    reasons.push(`Sem acesso há ${r.daysSinceLast} dias`);
  } else if (r.daysSinceLast != null && r.daysSinceLast > 7) {
    attention = true;
    reasons.push(`Poucos acessos (último há ${r.daysSinceLast} dias)`);
  } else if (r.daysSinceLast != null) {
    reasons.push("Acessa com frequência");
  }

  // Movimentação de candidatos
  if (r.actions === 0 && r.totalCandidates === 0) {
    critical = true;
    reasons.push("Nenhuma movimentação");
  } else if (r.totalCandidates > 0 && r.hired === 0) {
    attention = true;
    reasons.push("Candidatos sem contratação");
  } else if (r.hired > 0) {
    reasons.push("Realiza contratações");
  }

  // Vagas paradas / publicação
  if (r.stalledJobs > 0) {
    attention = true;
    reasons.push(r.stalledJobs === 1 ? "1 vaga aberta parada" : `${r.stalledJobs} vagas abertas paradas`);
  } else if (r.openJobs > 0) {
    reasons.push("Publica vagas");
  }

  // Onboarding
  if (!onboardingDone && r.status !== "concluido") {
    attention = true;
    reasons.push("Onboarding não concluído");
  }

  const level: HealthLevel = critical ? "critico" : attention ? "atencao" : "saudavel";
  return { level, reasons };
}

/** Ordem de prioridade para ordenar a lista (crítico primeiro). */
export const HEALTH_ORDER: Record<HealthLevel, number> = { critico: 0, atencao: 1, saudavel: 2 };

interface BaseRow {
  unitId: string;
  unitName: string;
  city: string | null;
  state: string | null;
  franqueadoNames: string[];
  franqueadoIds: string[];
  hasRecord: boolean;
  status: ImplementationStatus;
  responsavelId: string | null;
  nextAction: string | null;
  nextActionDate: string | null;
  checklist: UnitChecklist;
  milestones: UnitMilestones;
  observacoes: string | null;
  lastAccess: string | null;
}

export function useFranchiseePanel() {
  const monitoring = useUnitMonitoringData();
  const usage = useUnitUsage(30, 8);

  const base = useQuery<{ rows: BaseRow[] }>({
    queryKey: ["franchisee_panel_base"],
    queryFn: async () => {
      // 1) Franqueados por unidade
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id, unit_id")
        .eq("role", "franqueado")
        .not("unit_id", "is", null);
      const roleRows = (roles || []).filter((r: any) => r.user_id && r.unit_id);

      // 2) Registros de implantação
      const { data: records } = await (supabase as any)
        .from("unit_implementation")
        .select("unit_id, status, responsavel_id, next_action, next_action_date, checklist, milestones, observacoes");
      const recordsByUnit = new Map<string, any>(
        ((records || []) as any[]).map((r) => [r.unit_id, r]),
      );

      // 3) Universo de unidades (franqueado OU registro)
      const unitIds = [
        ...new Set([
          ...roleRows.map((r: any) => r.unit_id as string),
          ...((records || []) as any[]).map((r) => r.unit_id as string),
        ]),
      ];
      if (unitIds.length === 0) return { rows: [] };

      // 4) Unidades (exclui franqueadora)
      const { data: unitsData } = await supabase
        .from("units")
        .select("id, name, city, state, is_franqueadora")
        .in("id", unitIds)
        .eq("is_franqueadora", false);

      // 5) Nome + último acesso do franqueado via RPC admin-gated
      const franqueadoIds = [...new Set(roleRows.map((r: any) => r.user_id as string))];
      const loginMap = new Map<string, any>();
      if (franqueadoIds.length > 0) {
        const { data: logins } = await (supabase as any).rpc("get_users_last_login", {
          _user_ids: franqueadoIds,
        });
        ((logins || []) as any[]).forEach((l) => loginMap.set(l.user_id, l));
      }

      const franqByUnit = new Map<string, string[]>();
      roleRows.forEach((r: any) => {
        const arr = franqByUnit.get(r.unit_id) || [];
        if (!arr.includes(r.user_id)) arr.push(r.user_id);
        franqByUnit.set(r.unit_id, arr);
      });

      const rows: BaseRow[] = ((unitsData || []) as any[]).map((u) => {
        const fIds = franqByUnit.get(u.id) || [];
        const fNames = fIds
          .map((id) => loginMap.get(id)?.full_name)
          .filter(Boolean) as string[];
        const lastAccess =
          fIds
            .map((id) => loginMap.get(id)?.last_login as string | undefined)
            .filter(Boolean)
            .sort()
            .reverse()[0] || null;
        const rec = recordsByUnit.get(u.id);
        return {
          unitId: u.id,
          unitName: u.name,
          city: u.city,
          state: u.state,
          franqueadoNames: fNames,
          franqueadoIds: fIds,
          hasRecord: !!rec,
          status: (rec?.status || "nao_iniciada") as ImplementationStatus,
          responsavelId: rec?.responsavel_id ?? null,
          nextAction: rec?.next_action ?? null,
          nextActionDate: rec?.next_action_date ?? null,
          checklist: normalizeChecklist(rec?.checklist),
          milestones: normalizeMilestones(rec?.milestones),
          observacoes: rec?.observacoes ?? null,
          lastAccess,
        };
      });

      return { rows };
    },
  });

  const rows = useMemo<FranchiseeRow[]>(() => {
    const metricsByUnit = new Map((monitoring.data?.units || []).map((u) => [u.id, u]));
    const usageByUnit = new Map((usage.data?.units || []).map((u) => [u.unitId, u]));
    const now = Date.now();
    return (base.data?.rows || []).map((r) => {
      const m = metricsByUnit.get(r.unitId);
      const us = usageByUnit.get(r.unitId);

      // "Dias desde o último acesso" combina login (get_users_last_login) e
      // atividade (activity_logs) — o mais recente vence.
      const loginDays = r.lastAccess ? Math.floor((now - Date.parse(r.lastAccess)) / DAY_MS) : null;
      const actDays = us?.daysSinceLast ?? null;
      const daysSinceLast = [loginDays, actDays]
        .filter((v): v is number => v != null)
        .sort((a, b) => a - b)[0] ?? null;

      const merged = {
        ...r,
        openJobs: m?.openJobs ?? 0,
        closedJobs: m?.closedJobs ?? 0,
        avgDaysToFill: m?.avgDays ?? 0,
        totalCandidates: m?.totalCandidates ?? 0,
        hired: m?.hired ?? 0,
        stalledJobs: m?.stalledJobs ?? 0,
        oldestOpenJobDays: m?.oldestOpenJobDays ?? 0,
        actions: us?.actions ?? 0,
        daysSinceLast,
      };

      const health = computeUnitHealth({
        franqueadoIds: merged.franqueadoIds,
        daysSinceLast: merged.daysSinceLast,
        actions: merged.actions,
        openJobs: merged.openJobs,
        totalCandidates: merged.totalCandidates,
        hired: merged.hired,
        stalledJobs: merged.stalledJobs,
        checklist: merged.checklist,
        status: merged.status,
      });

      return { ...merged, health };
    });
  }, [base.data, monitoring.data, usage.data]);

  return {
    rows,
    isLoading: base.isLoading || monitoring.isLoading || usage.isLoading,
  };
}

/** Lista de usuários admin para o Select de "Responsável". */
export function useAdminUsers() {
  return useQuery({
    queryKey: ["admin_users_for_responsavel"],
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "admin");
      const ids = [...new Set((roles || []).map((r: any) => r.user_id as string).filter(Boolean))];
      if (ids.length === 0) return [] as { id: string; name: string }[];
      const { data: logins } = await (supabase as any).rpc("get_users_last_login", { _user_ids: ids });
      const nameMap = new Map<string, string>(
        ((logins || []) as any[]).map((l) => [l.user_id, l.full_name || "Admin"]),
      );
      return ids.map((id) => ({ id, name: nameMap.get(id) || "Admin" }));
    },
  });
}

export interface UpsertImplementationInput {
  unitId: string;
  status?: ImplementationStatus;
  responsavelId?: string | null;
  nextAction?: string | null;
  nextActionDate?: string | null;
  checklist?: UnitChecklist;
  milestones?: UnitMilestones;
  observacoes?: string | null;
}

/**
 * Cria/atualiza o registro de implantação de uma unidade (upsert por unit_id).
 * Aceita atualização parcial — só os campos informados são gravados.
 */
export function useUpsertUnitImplementation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpsertImplementationInput) => {
      const payload: Record<string, any> = {
        unit_id: input.unitId,
        updated_at: new Date().toISOString(),
      };
      if (input.status !== undefined) payload.status = input.status;
      if (input.responsavelId !== undefined) payload.responsavel_id = input.responsavelId;
      if (input.nextAction !== undefined) payload.next_action = input.nextAction;
      if (input.nextActionDate !== undefined) payload.next_action_date = input.nextActionDate;
      if (input.checklist !== undefined) payload.checklist = input.checklist;
      if (input.milestones !== undefined) payload.milestones = input.milestones;
      if (input.observacoes !== undefined) payload.observacoes = input.observacoes;

      const { error } = await (supabase as any)
        .from("unit_implementation")
        .upsert(payload, { onConflict: "unit_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["franchisee_panel_base"] });
    },
  });
}
