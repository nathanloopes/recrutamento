import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toDocNames } from "@/lib/docNames";

// ─── Types ───

export interface DashboardFilters {
  unitId?: string;
  unitIds?: string[];
  jobId?: string;
  state?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface FunnelStep {
  name: string;
  value: number;
  percent: number;
  conversionFromPrev: number;
  fill: string;
}

export interface UnitComparisonRow {
  unitId: string;
  unitName: string;
  city: string | null;
  state: string | null;
  totalCandidates: number;
  hired: number;
  conversionRate: number;
  avgDays: number;
}

export interface GargaloAlert {
  level: "warning" | "critical";
  message: string;
  unitName?: string;
  unitId?: string;
}

// ─── Admin Metrics (existing) ───

export function useAdminStats(filters?: DashboardFilters, staleTimeMs?: number, refetchIntervalMs?: number) {
  return useQuery({
    queryKey: ["admin_stats", filters],
    staleTime: staleTimeMs,
    refetchInterval: refetchIntervalMs,
    queryFn: async () => {
      if (filters?.unitIds && filters.unitIds.length === 0) {
        return {
          activeCandidates: 0,
          openJobs: 0,
          activeUnits: 0,
          conversionRate: "0%",
          rejectionRate: "0%",
          avgHiringDays: 0,
        };
      }

      // Build applications query with filters
      let appsQuery = supabase.from("applications").select("status, unit_job_id, created_at, updated_at");
      
      if (filters?.dateFrom) appsQuery = appsQuery.gte("created_at", filters.dateFrom);
      if (filters?.dateTo) appsQuery = appsQuery.lte("created_at", filters.dateTo + "T23:59:59");

      const [appsResult, openJobsResult, unitsResult] = await Promise.all([
        appsQuery,
        (() => {
          let q = supabase.from("unit_jobs").select("id", { count: "exact", head: true }).eq("status", "aberta");
          if (filters?.unitId) q = q.eq("unit_id", filters.unitId);
          else if (filters?.unitIds && filters.unitIds.length > 0) q = q.in("unit_id", filters.unitIds);
          return q;
        })(),
        (() => {
          let q = supabase.from("units").select("id", { count: "exact", head: true }).eq("is_active", true);
          if (filters?.unitId) q = q.eq("id", filters.unitId);
          else if (filters?.unitIds && filters.unitIds.length > 0) q = q.in("id", filters.unitIds);
          return q;
        })(),
      ]);

      let allApps = appsResult.data || [];

      // Filter by unit/job if needed
      if (filters?.unitId || filters?.unitIds || filters?.jobId || filters?.state) {
        const { data: ujData } = await supabase
          .from("unit_jobs")
          .select("id, unit_id, job_id, units(state)");
        const ujMap = new Map((ujData || []).map((uj: any) => [uj.id, uj]));
        
        allApps = allApps.filter((a: any) => {
          const uj = ujMap.get(a.unit_job_id) as any;
          if (!uj) return false;
          if (filters?.unitId && uj.unit_id !== filters.unitId) return false;
          if (filters?.unitIds && filters.unitIds.length > 0 && !filters.unitIds.includes(uj.unit_id)) return false;
          if (filters?.jobId && uj.job_id !== filters.jobId) return false;
          if (filters?.state && uj.units?.state !== filters.state) return false;
          return true;
        });
      }

      const total = allApps.length;
      const active = allApps.filter((a: any) => a.status === "em_andamento").length;
      const hired = allApps.filter((a: any) => a.status === "contratado").length;
      const rejected = allApps.filter((a: any) => a.status === "reprovado" || a.status === "standby").length;
      const conversionRate = total > 0 ? ((hired / total) * 100).toFixed(1) : "0";
      const rejectionRate = total > 0 ? ((rejected / total) * 100).toFixed(1) : "0";

      // Avg hiring time
      const hiredApps = allApps.filter((a: any) => a.status === "contratado");
      let avgDays = 0;
      if (hiredApps.length > 0) {
        const totalDays = hiredApps.reduce((sum: number, a: any) => {
          const created = new Date(a.created_at).getTime();
          const updated = new Date(a.updated_at).getTime();
          return sum + (updated - created) / (1000 * 60 * 60 * 24);
        }, 0);
        avgDays = Math.round(totalDays / hiredApps.length);
      }

      return {
        activeCandidates: active,
        openJobs: openJobsResult.count || 0,
        activeUnits: unitsResult.count || 0,
        conversionRate: `${conversionRate}%`,
        rejectionRate: `${rejectionRate}%`,
        avgHiringDays: avgDays,
      };
    },
  });
}

export function useRecruitmentFunnel() {
  return useQuery({
    queryKey: ["recruitment_funnel"],
    queryFn: async () => {
      const { data } = await supabase.from("applications").select("status");
      const apps = data || [];

      const statusMap: Record<string, number> = {
        em_andamento: 0,
        aprovado: 0,
        contratado: 0,
        reprovado: 0,
        standby: 0,
        desistente: 0,
      };

      apps.forEach((a) => {
        if (a.status in statusMap) statusMap[a.status]++;
      });

      return [
        { name: "Em Andamento", value: statusMap.em_andamento, fill: "hsl(var(--primary))" },
        { name: "Aprovados", value: statusMap.aprovado, fill: "hsl(142 71% 45%)" },
        { name: "Contratados", value: statusMap.contratado, fill: "hsl(262 83% 58%)" },
        { name: "Lista de Oportunidade", value: statusMap.reprovado + statusMap.standby, fill: "hsl(45 93% 47%)" },
        { name: "Desistentes", value: statusMap.desistente, fill: "hsl(var(--muted-foreground))" },
      ];
    },
  });
}

export function useRecentInterviews() {
  const { hasRole, unitIds } = useAuth();
  const isSuperAdmin = hasRole("admin");

  return useQuery({
    queryKey: ["recent_interviews_dashboard", isSuperAdmin, unitIds],
    queryFn: async () => {
      if (!isSuperAdmin && unitIds.length === 0) return [];

      const today = new Date().toISOString().split("T")[0];
      const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];

      let q = supabase
        .from("interviews")
        .select("id, scheduled_date, scheduled_time, modality, status, candidate_id, unit_id, units(name), profiles!interviews_candidate_id_fkey(full_name)")
        .gte("scheduled_date", today)
        .lte("scheduled_date", nextWeek)
        .eq("status", "confirmed")
        .order("scheduled_date")
        .order("scheduled_time")
        .limit(10);
      if (!isSuperAdmin && unitIds.length > 0) {
        q = q.in("unit_id", unitIds);
      }
      const { data } = await q;
      return data || [];
    },
  });
}

export function usePendingDocuments() {
  const { hasRole, unitIds } = useAuth();
  const isSuperAdmin = hasRole("admin");

  return useQuery({
    queryKey: ["pending_documents_dashboard", isSuperAdmin, unitIds],
    queryFn: async () => {
      if (!isSuperAdmin && unitIds.length === 0) return 0;

      let q = supabase
        .from("document_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "open");
      if (!isSuperAdmin && unitIds.length > 0) {
        q = q.in("unit_id", unitIds);
      }
      const { count } = await q;
      return count || 0;
    },
  });
}

// ─── Advanced Funnel ───

export function useAdvancedFunnel(filters?: DashboardFilters, staleTimeMs?: number, refetchIntervalMs?: number) {
  return useQuery({
    queryKey: ["advanced_funnel", filters],
    staleTime: staleTimeMs,
    refetchInterval: refetchIntervalMs,
    queryFn: async () => {
      if (filters?.unitIds && filters.unitIds.length === 0) return [];

      let query = supabase
        .from("applications")
        .select("id, status, current_phase, created_at, unit_job_id");

      if (filters?.dateFrom) query = query.gte("created_at", filters.dateFrom);
      if (filters?.dateTo) query = query.lte("created_at", filters.dateTo + "T23:59:59");

      const { data: apps } = await query;
      if (!apps || apps.length === 0) return [];

      let filtered = apps;

      if (filters?.unitId || filters?.unitIds || filters?.jobId || filters?.state) {
        const { data: ujData } = await supabase
          .from("unit_jobs")
          .select("id, unit_id, job_id, units(state)");
        const ujMap = new Map((ujData || []).map((uj: any) => [uj.id, uj]));
        
        filtered = apps.filter((a) => {
          const uj = ujMap.get(a.unit_job_id) as any;
          if (!uj) return false;
          if (filters?.unitId && uj.unit_id !== filters.unitId) return false;
          if (filters?.unitIds && filters.unitIds.length > 0 && !filters.unitIds.includes(uj.unit_id)) return false;
          if (filters?.jobId && uj.job_id !== filters.jobId) return false;
          if (filters?.state && uj.units?.state !== filters.state) return false;
          return true;
        });
      }

      // Get interview counts
      const appIds = filtered.map((a) => a.id);
      const { data: interviews } = await supabase
        .from("interviews")
        .select("application_id")
        .in("application_id", appIds.length > 0 ? appIds : ["__none__"]);
      const interviewedSet = new Set((interviews || []).map((i) => i.application_id));

      const total = filtered.length;
      const emTriagem = filtered.filter((a) => a.status === "em_andamento" && a.current_phase).length;
      const emEntrevista = filtered.filter((a) => interviewedSet.has(a.id)).length;
      const aprovados = filtered.filter((a) => a.status === "aprovado").length;
      const contratados = filtered.filter((a) => a.status === "contratado").length;
      const reprovados = filtered.filter((a) => a.status === "reprovado").length;
      const standby = filtered.filter((a) => a.status === "standby").length;
      const desistentes = filtered.filter((a) => a.status === "desistente").length;

      const steps: FunnelStep[] = [
        { name: "Inscritos", value: total, percent: 100, conversionFromPrev: 100, fill: "hsl(var(--primary))" },
        { name: "Em Triagem", value: emTriagem, percent: total > 0 ? (emTriagem / total) * 100 : 0, conversionFromPrev: total > 0 ? (emTriagem / total) * 100 : 0, fill: "hsl(210 80% 55%)" },
        { name: "Em Entrevista", value: emEntrevista, percent: total > 0 ? (emEntrevista / total) * 100 : 0, conversionFromPrev: emTriagem > 0 ? (emEntrevista / emTriagem) * 100 : 0, fill: "hsl(280 70% 55%)" },
        { name: "Aprovados", value: aprovados, percent: total > 0 ? (aprovados / total) * 100 : 0, conversionFromPrev: emEntrevista > 0 ? (aprovados / emEntrevista) * 100 : 0, fill: "hsl(142 71% 45%)" },
        { name: "Contratados", value: contratados, percent: total > 0 ? (contratados / total) * 100 : 0, conversionFromPrev: aprovados > 0 ? (contratados / aprovados) * 100 : 0, fill: "hsl(262 83% 58%)" },
      ];

      // Add negative outcomes
      steps.push(
        { name: "Lista de Oportunidade", value: reprovados, percent: total > 0 ? (reprovados / total) * 100 : 0, conversionFromPrev: 0, fill: "hsl(45 93% 47%)" },
        { name: "Standby", value: standby, percent: total > 0 ? (standby / total) * 100 : 0, conversionFromPrev: 0, fill: "hsl(45 93% 47%)" },
        { name: "Desistentes", value: desistentes, percent: total > 0 ? (desistentes / total) * 100 : 0, conversionFromPrev: 0, fill: "hsl(var(--muted-foreground))" },
      );

      return steps;
    },
  });
}

// ─── Average Hiring Time ───

export function useAvgHiringTime(filters?: DashboardFilters) {
  return useQuery({
    queryKey: ["avg_hiring_time", filters],
    queryFn: async () => {
      let query = supabase
        .from("applications")
        .select("id, created_at, updated_at, unit_job_id")
        .eq("status", "contratado");

      if (filters?.dateFrom) query = query.gte("created_at", filters.dateFrom);
      if (filters?.dateTo) query = query.lte("created_at", filters.dateTo + "T23:59:59");

      const { data: apps } = await query;
      if (!apps || apps.length === 0) return { overall: 0, byUnit: [] as { unitName: string; avgDays: number }[], byJob: [] as { jobTitle: string; avgDays: number }[] };

      // Load unit_jobs with joins for grouping
      const ujIds = [...new Set(apps.map((a) => a.unit_job_id))];
      const { data: ujData } = await supabase
        .from("unit_jobs")
        .select("id, unit_id, job_id, units(id, name), jobs(id, title)")
        .in("id", ujIds);
      const ujMap = new Map((ujData || []).map((uj: any) => [uj.id, uj]));

      let filtered = apps;
      if (filters?.unitId || filters?.unitIds || filters?.jobId || filters?.state) {
        filtered = apps.filter((a) => {
          const uj = ujMap.get(a.unit_job_id) as any;
          if (!uj) return false;
          if (filters?.unitId && uj.unit_id !== filters.unitId) return false;
          if (filters?.unitIds && filters.unitIds.length > 0 && !filters.unitIds.includes(uj.unit_id)) return false;
          if (filters?.jobId && uj.job_id !== filters.jobId) return false;
          return true;
        });
      }

      const calcDays = (a: any) => {
        return (new Date(a.updated_at).getTime() - new Date(a.created_at).getTime()) / (1000 * 60 * 60 * 24);
      };

      const overall = filtered.length > 0
        ? Math.round(filtered.reduce((s, a) => s + calcDays(a), 0) / filtered.length)
        : 0;

      // Group by unit
      const unitGroups = new Map<string, { name: string; days: number[] }>();
      const jobGroups = new Map<string, { title: string; days: number[] }>();

      filtered.forEach((a) => {
        const uj = ujMap.get(a.unit_job_id) as any;
        if (!uj) return;
        const days = calcDays(a);

        const unitKey = uj.unit_id;
        if (!unitGroups.has(unitKey)) unitGroups.set(unitKey, { name: uj.units?.name || "—", days: [] });
        unitGroups.get(unitKey)!.days.push(days);

        const jobKey = uj.job_id;
        if (!jobGroups.has(jobKey)) jobGroups.set(jobKey, { title: uj.jobs?.title || "—", days: [] });
        jobGroups.get(jobKey)!.days.push(days);
      });

      const byUnit = Array.from(unitGroups.values()).map((g) => ({
        unitName: g.name,
        avgDays: Math.round(g.days.reduce((s, d) => s + d, 0) / g.days.length),
      }));

      const byJob = Array.from(jobGroups.values()).map((g) => ({
        jobTitle: g.title,
        avgDays: Math.round(g.days.reduce((s, d) => s + d, 0) / g.days.length),
      }));

      return { overall, byUnit, byJob };
    },
  });
}

// ─── Unit Comparison ───

export function useUnitComparison(staleTimeMs?: number) {
  const { hasRole, unitIds: userUnitIds } = useAuth();
  const isGlobalAdmin = hasRole("admin");

  return useQuery({
    queryKey: ["unit_comparison", isGlobalAdmin, userUnitIds],
    staleTime: staleTimeMs,
    queryFn: async () => {
      if (!isGlobalAdmin && userUnitIds.length === 0) return [];

      let unitsQuery = supabase.from("units").select("id, name, city, state").eq("is_active", true);
      if (!isGlobalAdmin && userUnitIds.length > 0) {
        unitsQuery = unitsQuery.in("id", userUnitIds);
      }

      const [{ data: apps }, { data: ujData }, { data: units }] = await Promise.all([
        supabase.from("applications").select("id, status, created_at, updated_at, unit_job_id"),
        supabase.from("unit_jobs").select("id, unit_id"),
        unitsQuery,
      ]);

      if (!apps || !ujData || !units) return [];

      const ujMap = new Map(ujData.map((uj) => [uj.id, uj.unit_id]));
      const unitMap = new Map(units.map((u) => [u.id, u]));

      // Group apps by unit
      const unitStats = new Map<string, { total: number; hired: number; totalDays: number }>();

      apps.forEach((a) => {
        const unitId = ujMap.get(a.unit_job_id);
        if (!unitId) return;
        if (!unitStats.has(unitId)) unitStats.set(unitId, { total: 0, hired: 0, totalDays: 0 });
        const stat = unitStats.get(unitId)!;
        stat.total++;
        if (a.status === "contratado") {
          stat.hired++;
          stat.totalDays += (new Date(a.updated_at).getTime() - new Date(a.created_at).getTime()) / (1000 * 60 * 60 * 24);
        }
      });

      const rows: UnitComparisonRow[] = [];
      unitStats.forEach((stat, unitId) => {
        const unit = unitMap.get(unitId);
        if (!unit) return;
        rows.push({
          unitId,
          unitName: unit.name,
          city: unit.city,
          state: unit.state,
          totalCandidates: stat.total,
          hired: stat.hired,
          conversionRate: stat.total > 0 ? Math.round((stat.hired / stat.total) * 100) : 0,
          avgDays: stat.hired > 0 ? Math.round(stat.totalDays / stat.hired) : 0,
        });
      });

      return rows.sort((a, b) => b.conversionRate - a.conversionRate);
    },
  });
}

// ─── Gargalos Alerts ───

export function useGargalosAlerts(staleTimeMs?: number, refetchIntervalMs?: number) {
  const { hasRole, unitIds: userUnitIds } = useAuth();
  const isGlobalAdmin = hasRole("admin");

  return useQuery({
    queryKey: ["gargalos_alerts", isGlobalAdmin, userUnitIds],
    staleTime: staleTimeMs,
    refetchInterval: refetchIntervalMs,
    queryFn: async () => {
      if (!isGlobalAdmin && userUnitIds.length === 0) return [];

      // Load thresholds from CrossConfig
      const { data: settings } = await supabase
        .from("global_settings")
        .select("key, value")
        .eq("category", "dashboard");

      const config: Record<string, any> = {};
      (settings || []).forEach((s) => { config[s.key] = s.value; });

      // Item 19: alert_thresholds JSON override
      let alertOverrides: Record<string, any> = {};
      try {
        if (config.alert_thresholds && typeof config.alert_thresholds === "object") {
          alertOverrides = config.alert_thresholds;
        } else if (typeof config.alert_thresholds === "string") {
          alertOverrides = JSON.parse(config.alert_thresholds);
        }
      } catch { /* ignore parse errors */ }

      const maxDays = Number(alertOverrides.max_hiring_days_alert ?? config.max_hiring_days_alert) || 30;
      const minConversion = Number(alertOverrides.min_conversion_rate ?? config.min_conversion_rate) || 10;
      const rejectionThreshold = Number(alertOverrides.rejection_threshold ?? config.rejection_threshold) || 70;

      // Load data
      let unitsQuery = supabase.from("units").select("id, name").eq("is_active", true);
      if (!isGlobalAdmin && userUnitIds.length > 0) {
        unitsQuery = unitsQuery.in("id", userUnitIds);
      }

      const [{ data: apps }, { data: ujData }, { data: units }] = await Promise.all([
        supabase.from("applications").select("id, status, created_at, updated_at, unit_job_id"),
        supabase.from("unit_jobs").select("id, unit_id, status, created_at"),
        unitsQuery,
      ]);

      if (!apps || !ujData || !units) return [];

      const ujMap = new Map(ujData.map((uj) => [uj.id, { unitId: uj.unit_id, status: uj.status, created_at: uj.created_at }]));
      const unitMap = new Map(units.map((u) => [u.id, u.name]));

      const alerts: GargaloAlert[] = [];

      // Per-unit analysis
      const unitApps = new Map<string, typeof apps>();
      apps.forEach((a) => {
        const uj = ujMap.get(a.unit_job_id);
        if (!uj) return;
        if (!unitApps.has(uj.unitId)) unitApps.set(uj.unitId, []);
        unitApps.get(uj.unitId)!.push(a);
      });

      unitApps.forEach((uApps, unitId) => {
        const name = unitMap.get(unitId) || "Unidade";
        const total = uApps.length;
        const rejected = uApps.filter((a) => a.status === "reprovado").length;
        const hired = uApps.filter((a) => a.status === "contratado").length;
        const rejRate = total > 0 ? (rejected / total) * 100 : 0;
        const convRate = total > 0 ? (hired / total) * 100 : 0;

        if (rejRate >= rejectionThreshold) {
          alerts.push({
            level: rejRate >= 90 ? "critical" : "warning",
            message: `${name}: ${rejRate.toFixed(0)}% de standby`,
            unitName: name,
            unitId,
          });
        }

        if (total >= 5 && convRate < minConversion) {
          alerts.push({
            level: "warning",
            message: `${name}: conversão de apenas ${convRate.toFixed(0)}%`,
            unitName: name,
            unitId,
          });
        }

        // Avg hiring time per unit
        const hiredApps = uApps.filter((a) => a.status === "contratado");
        if (hiredApps.length > 0) {
          const avgDays = hiredApps.reduce((s, a) => s + (new Date(a.updated_at).getTime() - new Date(a.created_at).getTime()) / 86400000, 0) / hiredApps.length;
          if (avgDays > maxDays) {
            alerts.push({
              level: avgDays > maxDays * 1.5 ? "critical" : "warning",
              message: `${name}: tempo médio de contratação de ${Math.round(avgDays)} dias (limite: ${maxDays})`,
              unitName: name,
              unitId,
            });
          }
        }
      });

      // Old open jobs
      const now = Date.now();
      ujData.filter((uj) => uj.status === "aberta").forEach((uj) => {
        const daysOpen = (now - new Date(uj.created_at).getTime()) / 86400000;
        if (daysOpen > maxDays) {
          const name = unitMap.get(uj.unit_id) || "Unidade";
          alerts.push({
            level: daysOpen > maxDays * 2 ? "critical" : "warning",
            message: `Vaga aberta há ${Math.round(daysOpen)} dias em ${name}`,
            unitName: name,
            unitId: uj.unit_id,
          });
        }
      });

      return alerts.sort((a, b) => (a.level === "critical" ? -1 : 1) - (b.level === "critical" ? -1 : 1));
    },
  });
}

// ─── Metrics Snapshots ───

export function useMetricsSnapshots(period?: string) {
  return useQuery({
    queryKey: ["metrics_snapshots", period],
    queryFn: async () => {
      let query = supabase
        .from("metrics_snapshots")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(90);

      if (period) query = query.eq("period", period);

      const { data } = await query;
      return data || [];
    },
  });
}

// ─── Filter Options ───

export function useDashboardFilterOptions() {
  return useQuery({
    queryKey: ["dashboard_filter_options"],
    queryFn: async () => {
      const [{ data: units }, { data: jobs }] = await Promise.all([
        supabase.from("units").select("id, name, state").eq("is_active", true).order("name"),
        supabase.from("jobs").select("id, title").eq("is_active", true).order("title"),
      ]);

      const states = [...new Set((units || []).map((u) => u.state).filter(Boolean))] as string[];

      return {
        units: units || [],
        jobs: jobs || [],
        states: states.sort(),
      };
    },
  });
}

// ─── Candidate Metrics ───

export interface TimelinePhase {
  id: string;
  name: string;
  status: "completed" | "current" | "pending";
}

export function useCandidateTimeline() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["candidate_timeline", user?.id],
    enabled: !!user,
    refetchOnMount: "always",
    staleTime: 0,
    queryFn: async () => {
      // Prioritize contratado — it's the global final state
      const { data: hiredApps } = await supabase
        .from("applications")
        .select("id, status, standby_reason, created_at, current_phase, unit_job_id, work_start_at, unit_jobs(job_id, unit_id, status, jobs(id, title), units(id, name, city, state))")
        .eq("candidate_id", user!.id)
        .eq("status", "contratado")
        .limit(1);

      let app = hiredApps?.[0] ?? null;

      if (!app) {
        const { data: recentApps } = await supabase
          .from("applications")
          .select("id, status, standby_reason, created_at, current_phase, unit_job_id, work_start_at, unit_jobs(job_id, unit_id, status, jobs(id, title), units(id, name, city, state))")
          .eq("candidate_id", user!.id)
          .neq("status", "desistente")
          .order("created_at", { ascending: false })
          .limit(1);

        app = recentApps?.[0] ?? null;
      }

      // Fallback: candidato aprovado no Talent Pool sem application
      if (!app) {
        const { data: tpEntries } = await supabase
          .from("talent_pool_entries")
          .select("id, approved_job_id, test_score, jobs:approved_job_id(id, title)")
          .eq("candidate_id", user!.id)
          .eq("status", "active")
          .not("test_score", "is", null)
          .not("approved_job_id", "is", null)
          .order("created_at", { ascending: false })
          .limit(1);

        const tp = tpEntries?.[0];
        if (tp) {
          const jobTitle = (tp.jobs as any)?.title || "Cargo aprovado";

          // Última candidatura encerrada por desistência (para sinalizar ao candidato)
          const { data: withdrawn } = await supabase
            .from("applications")
            .select("id, created_at, updated_at, unit_jobs(jobs(title), units(name, city, state))")
            .eq("candidate_id", user!.id)
            .eq("status", "desistente")
            .order("updated_at", { ascending: false })
            .limit(1);
          const w = withdrawn?.[0] as any;
          const previousWithdrawn = w
            ? {
                jobTitle: w.unit_jobs?.jobs?.title || "vaga anterior",
                unitName: w.unit_jobs?.units?.name || "",
                at: w.updated_at || w.created_at,
              }
            : null;

          return {
            application: {
              id: `synthetic-${tp.id}`,
              status: "apto_para_vaga" as any,
              synthetic: true,
              approved_job_id: tp.approved_job_id,
              test_score: tp.test_score,
              unit_jobs: { job_id: tp.approved_job_id, jobs: { title: jobTitle } },
            } as any,
            phases: [
              { id: "inscricao", name: "Inscrição", status: "completed" as const },
              { id: "avaliacao", name: "Avaliação", status: "completed" as const },
              { id: "unidade", name: "Escolher unidade", status: "current" as const },
              { id: "entrevista", name: "Entrevista", status: "pending" as const },
              { id: "contratacao", name: "Contratação", status: "pending" as const },
            ],
            currentStep: 2,
            nextInterview: null,
            allInterviews: [],
            docRequest: null,
            docsUploaded: 0,
            docsTotal: 0,
            jobTitle,
            unitName: "",
            synthetic: true as const,
            previousWithdrawn,
          };
        }

        return null;
      }

      const jobId = (app.unit_jobs as any)?.job_id;

      // Load real pipeline phases
      let phases: TimelinePhase[] = [];
      let currentStep = 0;

      if (jobId) {
        const { data: pipelines } = await supabase
          .from("job_pipelines")
          .select("id")
          .eq("job_id", jobId)
          .eq("is_active", true)
          .limit(1);

        const pipelineId = pipelines?.[0]?.id;
        if (pipelineId) {
          const { data: dbPhases } = await supabase
            .from("pipeline_phases")
            .select("id, name, order_index")
            .eq("pipeline_id", pipelineId)
            .order("order_index", { ascending: true });

          if (dbPhases && dbPhases.length > 0) {
            const currentPhaseIdx = app.current_phase
              ? dbPhases.findIndex((p) => p.id === app.current_phase)
              : -1;

            const isHired = app.status === "contratado";
            const isFinalStatus = app.status === "aprovado" || app.status === "reprovado" || isHired;
            const resolvedIdx = isHired ? dbPhases.length : currentPhaseIdx >= 0 ? currentPhaseIdx : 0;

            phases = dbPhases.map((p, i) => ({
              id: p.id,
              name: p.name,
              status: isFinalStatus
                ? (app.status === "reprovado" ? "completed" as const : "completed" as const)
                : i < resolvedIdx ? "completed" as const
                : i === resolvedIdx ? "current" as const
                : "pending" as const,
            }));
            currentStep = resolvedIdx;
          }
        }
      }

      // Fetch interviews, docs, and test assignments for fallback and display
      const { data: interviews } = await supabase
        .from("interviews")
        .select("id, scheduled_date, scheduled_time, status, modality, units(name)")
        .eq("application_id", app.id)
        .order("scheduled_date", { ascending: true });

      const { data: docRequests } = await supabase
        .from("document_requests")
        .select("id, status, documents_list, custom_documents, created_at")
        .eq("application_id", app.id);

      const docRequest = docRequests?.[0];
      let docsUploaded = 0;
      let docsTotal = 0;
      if (docRequest) {
        // Considera apenas obrigatórios. documents_list/custom_documents podem
        // vir como string[] (legado, todos obrigatórios) ou {name, required}[].
        const collectRequired = (arr: any): string[] => {
          if (!Array.isArray(arr)) return [];
          return arr
            .map((item: any) => {
              if (!item) return null;
              if (typeof item === "string") return { name: item, required: true };
              if (typeof item === "object" && item.name) {
                return { name: String(item.name), required: item.required !== false };
              }
              return null;
            })
            .filter((d: any) => d && d.required)
            .map((d: any) => d.name);
        };
        const requiredDocs = Array.from(new Set([
          ...collectRequired((docRequest as any).documents_list),
          ...collectRequired((docRequest as any).custom_documents),
        ]));
        docsTotal = requiredDocs.length;

        if (requiredDocs.length > 0) {
          const { data: uploads } = await supabase
            .from("document_uploads")
            .select("document_type")
            .eq("request_id", docRequest.id)
            .eq("candidate_id", user!.id)
            .in("document_type", requiredDocs);
          const sentTypes = new Set((uploads || []).map((u: any) => u.document_type));
          docsUploaded = sentTypes.size;
        }
      }


      // Fallback: build synthetic phases from real data
      if (phases.length === 0) {
        const { data: testAssignments } = await supabase
          .from("test_assignments")
          .select("id, status")
          .eq("application_id", app.id);

        const hasTests = (testAssignments || []).length > 0;
        const testsCompleted = hasTests && (testAssignments || []).every((t: any) => t.status === "completed" || t.status === "graded");

        const hasInterviews = (interviews || []).length > 0;
        const interviewsDone = hasInterviews && (interviews || []).every((i: any) => i.status === "completed");

        const hasDocs = !!docRequest;
        const docsComplete = hasDocs && docRequest.status === "completed";

        const isHired = app.status === "contratado";
        const isRejected = app.status === "reprovado";
        const isFinal = isHired || isRejected;

        let avaliacaoStatus: "completed" | "current" | "pending" = "pending";
        let entrevistaStatus: "completed" | "current" | "pending" = "pending";
        let documentacaoStatus: "completed" | "current" | "pending" = "pending";
        let resultadoStatus: "completed" | "current" | "pending" = "pending";

        if (isFinal) {
          avaliacaoStatus = "completed";
          entrevistaStatus = "completed";
          documentacaoStatus = "completed";
          resultadoStatus = "completed";
        } else {
          avaliacaoStatus = hasTests ? (testsCompleted ? "completed" : "current") : "completed";
          entrevistaStatus = hasInterviews ? (interviewsDone ? "completed" : "current") : "pending";
          documentacaoStatus = hasDocs ? (docsComplete ? "completed" : "current") : "pending";
        }

        // Sequential consistency
        const statuses = [avaliacaoStatus, entrevistaStatus, documentacaoStatus, resultadoStatus];
        let foundCurrent = false;
        for (let i = statuses.length - 1; i >= 0; i--) {
          if (statuses[i] === "current") foundCurrent = true;
          else if (foundCurrent && statuses[i] === "pending") statuses[i] = "completed";
        }

        phases = [
          { id: "inscricao", name: "Inscrição", status: "completed" as const },
          { id: "avaliacao", name: "Avaliação", status: statuses[0] },
          { id: "entrevista", name: "Entrevista", status: statuses[1] },
          { id: "documentos", name: "Documentação", status: statuses[2] },
          { id: "resultado", name: "Resultado", status: statuses[3] },
        ];

        currentStep = phases.findIndex((p) => p.status === "current");
        if (currentStep < 0) currentStep = phases.filter((p) => p.status === "completed").length - 1;
      }

      const nextInterview = interviews?.find((i) => i.status === "confirmed");

      let currentRestartMode: string | null = null;
      try {
        const { data: activeCycle } = await supabase
          .from("application_cycles" as any)
          .select("restart_mode")
          .eq("application_id", app.id)
          .is("closed_at", null)
          .order("cycle_number", { ascending: false })
          .limit(1)
          .maybeSingle();
        currentRestartMode = ((activeCycle as any)?.restart_mode as any) || null;
      } catch (_) { /* ignore */ }

      return {
        application: { ...app, currentRestartMode } as any,
        phases,
        currentStep,
        nextInterview,
        allInterviews: interviews || [],
        docRequest: docRequest || null,
        docsUploaded,
        docsTotal,
        jobTitle: (app.unit_jobs as any)?.jobs?.title || "Vaga",
        unitName: (app.unit_jobs as any)?.units?.name || "",
      };
    },
  });
}
