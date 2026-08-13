import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Camada de UTILIZAÇÃO / ADESÃO da plataforma (distinta dos indicadores de
 * recrutamento). Mede se os responsáveis pelas unidades — franqueados e gestores
 * de recrutamento — estão de fato usando o sistema, a partir de `activity_logs`
 * mapeado à unidade via `user_roles`.
 *
 * Definições:
 *  - Base = unidades com ao menos um franqueado/gestor atribuído.
 *  - Unidade ATIVA (no período) = teve ≥1 ação de algum responsável no período.
 *  - % de utilização = unidades ativas / base.
 *  - Baixa aderência = unidade da base sem atividade no período (ou nunca).
 *
 * Obs.: `admin_users.last_login_at` está sempre vazio no banco, por isso o sinal
 * usado é `activity_logs` (ações reais), que é populado para franqueados/gestores.
 */

const USAGE_ROLES = ["franqueado", "gestor_recrutamento"] as const;
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

export interface UnitUsage {
  unitId: string;
  unitName: string;
  city: string | null;
  state: string | null;
  assignedUsers: number;
  activeUsers: number;
  actions: number;
  lastActivity: string | null;
  daysSinceLast: number | null;
}

export interface UsageWeek {
  week: string;
  actions: number;
  activeUnits: number;
}

export interface UnitUsageResult {
  units: UnitUsage[];
  network: {
    baseUnits: number;
    activeUnits: number;
    usagePct: number;
    assignedUsers: number;
    activeUsers: number;
    actions: number;
    windowDays: number;
  };
  weekly: UsageWeek[];
}

function emptyResult(windowDays: number): UnitUsageResult {
  return {
    units: [],
    network: { baseUnits: 0, activeUnits: 0, usagePct: 0, assignedUsers: 0, activeUsers: 0, actions: 0, windowDays },
    weekly: [],
  };
}

export function useUnitUsage(windowDays = 30, trendWeeks = 8) {
  return useQuery<UnitUsageResult>({
    queryKey: ["unit_usage", windowDays, trendWeeks],
    staleTime: 60_000,
    queryFn: async () => {
      // 1) Mapeamento responsável → unidade
      const { data: roles, error: rolesErr } = await supabase
        .from("user_roles")
        .select("user_id, unit_id, role")
        .in("role", USAGE_ROLES)
        .not("unit_id", "is", null);
      if (rolesErr) throw rolesErr;

      const mappings = (roles || []).filter((r: any) => r.user_id && r.unit_id);
      const userIds = [...new Set(mappings.map((r: any) => r.user_id as string))];
      const unitIds = [...new Set(mappings.map((r: any) => r.unit_id as string))];
      if (unitIds.length === 0) return emptyResult(windowDays);

      // user → unidades (um responsável pode cobrir mais de uma unidade)
      const userUnits = new Map<string, Set<string>>();
      for (const m of mappings) {
        if (!userUnits.has(m.user_id)) userUnits.set(m.user_id, new Set());
        userUnits.get(m.user_id)!.add(m.unit_id);
      }

      // 2) Nomes das unidades
      const { data: unitsData } = await supabase
        .from("units")
        .select("id, name, city, state")
        .in("id", unitIds);
      const unitMap = new Map((unitsData || []).map((u: any) => [u.id, u]));

      // 3) Ações desses responsáveis (volume pequeno; sem filtro de data para
      //    obter a "última atividade" real)
      const { data: logs } = await supabase
        .from("activity_logs")
        .select("user_id, created_at")
        .in("user_id", userIds);

      const now = Date.now();
      const windowStart = now - windowDays * DAY_MS;
      const trendStart = now - trendWeeks * WEEK_MS;

      type Acc = { assigned: Set<string>; activeUsers: Set<string>; actions: number; last: number };
      const acc = new Map<string, Acc>();
      for (const uid of unitIds) acc.set(uid, { assigned: new Set(), activeUsers: new Set(), actions: 0, last: 0 });
      for (const m of mappings) acc.get(m.unit_id)!.assigned.add(m.user_id);

      const activeUserSet = new Set<string>();
      let netActions = 0;
      const weekActions = new Map<number, number>();
      const weekUnits = new Map<number, Set<string>>();

      for (const log of logs || []) {
        const t = new Date(log.created_at).getTime();
        if (Number.isNaN(t)) continue;
        const uset = userUnits.get(log.user_id);
        if (!uset) continue;
        const inWindow = t >= windowStart;
        if (inWindow) {
          netActions++;
          activeUserSet.add(log.user_id);
        }
        for (const uid of uset) {
          const a = acc.get(uid);
          if (!a) continue;
          if (t > a.last) a.last = t;
          if (inWindow) {
            a.actions++;
            a.activeUsers.add(log.user_id);
          }
        }
        if (t >= trendStart) {
          const wi = Math.min(trendWeeks - 1, Math.floor((t - trendStart) / WEEK_MS));
          weekActions.set(wi, (weekActions.get(wi) || 0) + 1);
          if (!weekUnits.has(wi)) weekUnits.set(wi, new Set());
          for (const uid of uset) weekUnits.get(wi)!.add(uid);
        }
      }

      const units: UnitUsage[] = unitIds.map((uid) => {
        const a = acc.get(uid)!;
        const u = unitMap.get(uid);
        return {
          unitId: uid,
          unitName: u?.name || "Unidade",
          city: u?.city ?? null,
          state: u?.state ?? null,
          assignedUsers: a.assigned.size,
          activeUsers: a.activeUsers.size,
          actions: a.actions,
          lastActivity: a.last ? new Date(a.last).toISOString() : null,
          daysSinceLast: a.last ? Math.floor((now - a.last) / DAY_MS) : null,
        };
      });

      const baseUnits = unitIds.length;
      const activeUnits = units.filter((u) => u.actions > 0).length;

      const weekly: UsageWeek[] = [];
      for (let wi = 0; wi < trendWeeks; wi++) {
        const start = new Date(trendStart + wi * WEEK_MS);
        const label = `${String(start.getDate()).padStart(2, "0")}/${String(start.getMonth() + 1).padStart(2, "0")}`;
        weekly.push({ week: label, actions: weekActions.get(wi) || 0, activeUnits: (weekUnits.get(wi) || new Set()).size });
      }

      return {
        units,
        network: {
          baseUnits,
          activeUnits,
          usagePct: baseUnits > 0 ? Math.round((activeUnits / baseUnits) * 100) : 0,
          assignedUsers: userIds.length,
          activeUsers: activeUserSet.size,
          actions: netActions,
          windowDays,
        },
        weekly,
      };
    },
  });
}

export interface ActiveUser {
  userId: string;
  name: string;
  email: string | null;
  units: string[];
  actions: number;
  lastLogin: string | null;
  lastSeen: string | null;
}

/**
 * Detalhe dos franqueados/gestores ATIVOS no período (para o clique em
 * "Usuários ativos"): nome, unidade(s), nº de ações e último login/acesso.
 * O último login vem da RPC admin-gated `get_users_last_login` (identity_sessions),
 * já que a RLS de identity_sessions não deixa o admin ler sessões de terceiros.
 * `enabled` evita buscar até o diálogo abrir.
 */
export function useActiveUsers(windowDays = 30, enabled = false) {
  return useQuery<ActiveUser[]>({
    queryKey: ["active_users_detail", windowDays],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id, unit_id, role")
        .in("role", USAGE_ROLES)
        .not("unit_id", "is", null);
      const mappings = (roles || []).filter((r: any) => r.user_id && r.unit_id);
      const userIds = [...new Set(mappings.map((r: any) => r.user_id as string))];
      if (userIds.length === 0) return [];

      const unitIds = [...new Set(mappings.map((r: any) => r.unit_id as string))];
      const { data: unitsData } = await supabase.from("units").select("id, name").in("id", unitIds);
      const unitMap = new Map((unitsData || []).map((u: any) => [u.id, u.name as string]));
      const userUnitNames = new Map<string, Set<string>>();
      for (const m of mappings) {
        if (!userUnitNames.has(m.user_id)) userUnitNames.set(m.user_id, new Set());
        const n = unitMap.get(m.unit_id);
        if (n) userUnitNames.get(m.user_id)!.add(n);
      }

      const sinceISO = new Date(Date.now() - windowDays * DAY_MS).toISOString();
      const { data: logs } = await supabase
        .from("activity_logs")
        .select("user_id, created_at")
        .in("user_id", userIds)
        .gte("created_at", sinceISO);
      const actions = new Map<string, number>();
      for (const l of logs || []) actions.set(l.user_id, (actions.get(l.user_id) || 0) + 1);
      const activeIds = [...actions.keys()];
      if (activeIds.length === 0) return [];

      const { data: logins } = await (supabase as any).rpc("get_users_last_login", { _user_ids: activeIds });
      const loginMap = new Map((logins || []).map((r: any) => [r.user_id, r]));

      return activeIds
        .map((id) => {
          const info: any = loginMap.get(id);
          return {
            userId: id,
            name: info?.full_name || "Usuário",
            email: info?.email ?? null,
            units: [...(userUnitNames.get(id) || [])],
            actions: actions.get(id) || 0,
            lastLogin: info?.last_login ?? null,
            lastSeen: info?.last_seen ?? null,
          } as ActiveUser;
        })
        .sort((a, b) => (b.lastLogin ? Date.parse(b.lastLogin) : 0) - (a.lastLogin ? Date.parse(a.lastLogin) : 0));
    },
  });
}
