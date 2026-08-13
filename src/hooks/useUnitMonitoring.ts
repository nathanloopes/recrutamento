import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface UnitMetrics {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  is_franqueadora: boolean;
  origem_unidade?: string;
  openJobs: number;
  closedJobs: number;
  totalCandidates: number;
  hired: number;
  rejected: number;
  withdrawn: number;
  conversionRate: number;
  rejectionRate: number;
  withdrawalRate: number;
  avgScore: number;
  avgDays: number;
  avgPhaseTransitionDays: number;
  stalledJobs: number;
  oldestOpenJobDays: number;
  alerts: string[];
  jobTitles: string[];
}

export interface UnitJobDetail {
  id: string;
  jobTitle: string;
  status: string;
  createdAt: string;
  candidates: number;
  isStalled: boolean;
  byStatus: Record<string, number>;
}

export function useUnitMonitoringData() {
  const { hasRole, unitIds: userUnitIds } = useAuth();
  const isGlobalAdmin = hasRole("admin");

  const { data: config } = useQuery({
    queryKey: ["unit_monitoring_config"],
    queryFn: async () => {
      const { data } = await supabase
        .from("global_settings")
        .select("key, value")
        .eq("category", "unit_monitoring");
      const map: Record<string, any> = {};
      (data || []).forEach((r: any) => { map[r.key] = r.value; });
      return {
        stalledDays: Number(map.stalled_days_threshold ?? 14),
        rejectionThreshold: Number(map.rejection_rate_threshold ?? 50),
        comparisonEnabled: map.enable_unit_comparison ?? true,
        responseDelayDays: Number(map.response_delay_threshold ?? 7),
        aiDiagnosticsEnabled: map.enable_ai_diagnostics ?? false,
        alertChannels: map.alert_channels ?? ["dashboard", "push"],
      };
    },
  });

  return useQuery({
    queryKey: ["unit_monitoring_data", config?.stalledDays, config?.rejectionThreshold, config?.responseDelayDays, isGlobalAdmin, userUnitIds],
    enabled: !!config,
    queryFn: async () => {
      const stalledDays = config!.stalledDays;
      const rejectionThreshold = config!.rejectionThreshold;
      const responseDelayDays = config!.responseDelayDays;
      const stalledDate = new Date();
      stalledDate.setDate(stalledDate.getDate() - stalledDays);
      const responseDelayDate = new Date();
      responseDelayDate.setDate(responseDelayDate.getDate() - responseDelayDays);

      // Fetch units (exclude franqueadora)
      let unitsQuery = supabase
        .from("units")
        .select("id, name, city, state, is_franqueadora, origem_unidade")
        .eq("is_active", true)
        .eq("is_franqueadora", false)
        .order("name");

      // Non-admin users: filter to only their assigned units
      if (!isGlobalAdmin && userUnitIds.length > 0) {
        unitsQuery = unitsQuery.in("id", userUnitIds);
      }

      const { data: units } = await unitsQuery;

      if (!units?.length) return { units: [] as UnitMetrics[], config: config! };

      const unitIds = units.map((u: any) => u.id);

      // Fetch all unit_jobs for these units — batch to avoid huge querystrings
      // (a single .in() with hundreds of UUIDs blows past nginx header buffers)
      let unitJobs: any[] = [];
      {
        const batchSize = 200;
        for (let i = 0; i < unitIds.length; i += batchSize) {
          const batch = unitIds.slice(i, i + batchSize);
          const { data } = await supabase
            .from("unit_jobs")
            .select("id, unit_id, status, created_at, jobs(title)")
            .in("unit_id", batch);
          if (data) unitJobs = unitJobs.concat(data);
        }
      }

      const openJobIds = unitJobs.filter((j: any) => j.status === "aberta").map((j: any) => j.id);
      const allJobIds = unitJobs.map((j: any) => j.id);

      // Fetch applications for these jobs
      let apps: any[] = [];
      if (allJobIds.length > 0) {
        const batchSize = 300;
        for (let i = 0; i < allJobIds.length; i += batchSize) {
          const batch = allJobIds.slice(i, i + batchSize);
          const { data } = await supabase
            .from("applications")
            .select("id, unit_job_id, status, total_score, created_at, updated_at")
            .in("unit_job_id", batch);
          if (data) apps = apps.concat(data);
        }
      }

      // Fetch phase transition logs (batched over all applications, not just first 500)
      let progressLogs: any[] = [];
      if (apps.length > 0) {
        const appIds = apps.map((a: any) => a.id);
        const batchSize = 300;
        for (let i = 0; i < appIds.length; i += batchSize) {
          const batch = appIds.slice(i, i + batchSize);
          const { data: logs } = await supabase
            .from("candidate_progress_logs")
            .select("application_id, phase, created_at")
            .in("application_id", batch)
            .order("created_at", { ascending: true });
          if (logs) progressLogs = progressLogs.concat(logs);
        }
      }

      // Build phase transition times per application
      const logsByApp: Record<string, any[]> = {};
      progressLogs.forEach((l: any) => {
        if (!logsByApp[l.application_id]) logsByApp[l.application_id] = [];
        logsByApp[l.application_id].push(l);
      });

      // Calculate avg time between phases (global)
      const phaseTransitionTimes: number[] = [];
      Object.values(logsByApp).forEach((logs: any[]) => {
        for (let i = 1; i < logs.length; i++) {
          const diff = (new Date(logs[i].created_at).getTime() - new Date(logs[i - 1].created_at).getTime()) / (1000 * 60 * 60 * 24);
          if (diff > 0 && diff < 365) phaseTransitionTimes.push(diff);
        }
      });
      const avgPhaseTransitionDays = phaseTransitionTimes.length > 0
        ? Math.round((phaseTransitionTimes.reduce((a, b) => a + b, 0) / phaseTransitionTimes.length) * 10) / 10
        : 0;

      // Build per-unit metrics
      const jobsByUnit: Record<string, any[]> = {};
      unitJobs.forEach((j: any) => {
        if (!jobsByUnit[j.unit_id]) jobsByUnit[j.unit_id] = [];
        jobsByUnit[j.unit_id].push(j);
      });

      const appsByJob: Record<string, any[]> = {};
      apps.forEach((a: any) => {
        if (!appsByJob[a.unit_job_id]) appsByJob[a.unit_job_id] = [];
        appsByJob[a.unit_job_id].push(a);
      });

      const metricsArr: UnitMetrics[] = units.map((u: any) => {
        const jobs = jobsByUnit[u.id] || [];
        const openJobs = jobs.filter((j: any) => j.status === "aberta");
        const closedJobs = jobs.filter((j: any) => j.status === "encerrada" || j.status === "preenchida").length;

        // Get all apps for this unit
        const unitApps: any[] = [];
        jobs.forEach((j: any) => {
          (appsByJob[j.id] || []).forEach((a: any) => unitApps.push(a));
        });

        const totalCandidates = unitApps.length;
        const hired = unitApps.filter((a: any) => a.status === "contratado").length;
        const rejected = unitApps.filter((a: any) => a.status === "standby" || a.status === "reprovado").length;
        const withdrawn = unitApps.filter((a: any) => a.status === "desistente").length;
        const conversionRate = totalCandidates > 0 ? Math.round((hired / totalCandidates) * 100) : 0;
        const rejectionRate = totalCandidates > 0 ? Math.round((rejected / totalCandidates) * 100) : 0;
        const withdrawalRate = totalCandidates > 0 ? Math.round((withdrawn / totalCandidates) * 100) : 0;

        const scores = unitApps.map((a: any) => a.total_score).filter((s: any) => s != null && s > 0);
        const avgScore = scores.length > 0 ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length) : 0;

        // Average days to hire
        const hiredApps = unitApps.filter((a: any) => a.status === "contratado");
        const avgDays = hiredApps.length > 0
          ? Math.round(hiredApps.reduce((sum: number, a: any) => {
              const created = new Date(a.created_at).getTime();
              const now = Date.now();
              return sum + (now - created) / (1000 * 60 * 60 * 24);
            }, 0) / hiredApps.length)
          : 0;

        // Job titles for this unit
        const jobTitles = [...new Set(jobs.map((j: any) => j.jobs?.title).filter(Boolean))] as string[];

        // Stalled jobs: open jobs with no application in last X days
        let stalledJobs = 0;
        const now = Date.now();
        let oldestOpenJobDays = 0;
        openJobs.forEach((j: any) => {
          const jobApps = appsByJob[j.id] || [];
          const latestApp = jobApps.length > 0
            ? jobApps.reduce((latest: any, a: any) => new Date(a.created_at) > new Date(latest.created_at) ? a : latest)
            : null;
          const refDate = latestApp ? new Date(latestApp.created_at) : new Date(j.created_at);
          if (refDate < stalledDate) stalledJobs++;
          const daysOpen = Math.floor((now - new Date(j.created_at).getTime()) / (1000 * 60 * 60 * 24));
          if (daysOpen > oldestOpenJobDays) oldestOpenJobDays = daysOpen;
        });

        // Gap 1: Detect delayed responses using response_delay_threshold
        const pendingApps = unitApps.filter((a: any) => 
          a.status === "em_andamento" && new Date(a.updated_at || a.created_at) < responseDelayDate
        );
        const hasDelayedResponse = pendingApps.length > 0;

        const alerts: string[] = [];
        if (stalledJobs > 0) alerts.push("Vaga Parada");
        if (rejectionRate > rejectionThreshold) alerts.push("Alto Standby");
        if (withdrawalRate > 30) alerts.push("Alta Desistência");
        if (hasDelayedResponse) alerts.push("Resposta Atrasada");

        return {
          id: u.id,
          name: u.name,
          city: u.city,
          state: u.state,
          is_franqueadora: u.is_franqueadora,
          origem_unidade: (u as any).origem_unidade ?? "IMPORTADA",
          openJobs: openJobs.length,
          closedJobs,
          totalCandidates,
          hired,
          rejected,
          withdrawn,
          conversionRate,
          rejectionRate,
          withdrawalRate,
          avgScore,
          avgDays,
          avgPhaseTransitionDays,
          stalledJobs,
          oldestOpenJobDays,
          alerts,
          jobTitles,
        };
      });

      // Post-process: add low conversion alert (compare each unit against network average)
      const allWithCandidates = metricsArr.filter((u) => u.totalCandidates > 0);
      if (allWithCandidates.length > 1) {
        const networkTotalHired = allWithCandidates.reduce((s, u) => s + u.hired, 0);
        const networkTotalCandidates = allWithCandidates.reduce((s, u) => s + u.totalCandidates, 0);
        const networkAvgConversion = networkTotalCandidates > 0 ? (networkTotalHired / networkTotalCandidates) * 100 : 0;
        for (const u of metricsArr) {
          if (u.totalCandidates > 0 && u.conversionRate < networkAvgConversion * 0.5) {
            u.alerts.push("Conversão Baixa");
          }
        }
      }

      return { units: metricsArr, config: config! };
    },
  });
}

export function useUnitDetail(unitId: string | null) {
  return useQuery({
    queryKey: ["unit_detail", unitId],
    enabled: !!unitId,
    queryFn: async () => {
      const { data } = await supabase
        .from("units")
        .select("id, name, code, city, state, cep, is_active, is_franqueadora")
        .eq("id", unitId!)
        .single();
      return data;
    },
  });
}

export function useUnitJobDetail(unitId: string | null) {
  const { data: config } = useQuery({
    queryKey: ["unit_monitoring_config"],
    queryFn: async () => {
      const { data } = await supabase
        .from("global_settings")
        .select("key, value")
        .eq("category", "unit_monitoring");
      const map: Record<string, any> = {};
      (data || []).forEach((r: any) => { map[r.key] = r.value; });
      return { stalledDays: Number(map.stalled_days_threshold ?? 14) };
    },
  });

  return useQuery({
    queryKey: ["unit_job_detail", unitId, config?.stalledDays],
    enabled: !!unitId && !!config,
    queryFn: async () => {
      const stalledDays = config!.stalledDays;
      const stalledDate = new Date();
      stalledDate.setDate(stalledDate.getDate() - stalledDays);

      const { data: jobs } = await supabase
        .from("unit_jobs")
        .select("id, status, created_at, jobs(title)")
        .eq("unit_id", unitId!)
        .order("created_at", { ascending: false });

      if (!jobs?.length) return [];

      const jobIds = jobs.map((j: any) => j.id);
      const { data: apps } = await supabase
        .from("applications")
        .select("unit_job_id, status, created_at")
        .in("unit_job_id", jobIds);

      const appsByJob: Record<string, any[]> = {};
      (apps || []).forEach((a: any) => {
        if (!appsByJob[a.unit_job_id]) appsByJob[a.unit_job_id] = [];
        appsByJob[a.unit_job_id].push(a);
      });

      return jobs.map((j: any): UnitJobDetail => {
        const jobApps = appsByJob[j.id] || [];
        const byStatus: Record<string, number> = {};
        jobApps.forEach((a: any) => { byStatus[a.status] = (byStatus[a.status] || 0) + 1; });

        const latestApp = jobApps.length > 0
          ? jobApps.reduce((latest: any, a: any) => new Date(a.created_at) > new Date(latest.created_at) ? a : latest)
          : null;
        const refDate = latestApp ? new Date(latestApp.created_at) : new Date(j.created_at);
        const isStalled = j.status === "aberta" && refDate < stalledDate;

        return {
          id: j.id,
          jobTitle: j.jobs?.title || "Sem título",
          status: j.status,
          createdAt: j.created_at,
          candidates: jobApps.length,
          isStalled,
          byStatus,
        };
      });
    },
  });
}

export interface UnitCandidateSummary {
  applicationId: string;
  candidateName: string;
  candidateCity: string | null;
  candidateState: string | null;
  jobTitle: string;
  unitJobId: string;
  status: string;
  appliedAt: string;
}

/**
 * Returns all applications for a given unit, with candidate name and job title.
 * Used in the "Comparativo de Unidades" summary panel in DashboardAnalytics.
 */
export function useUnitCandidateSummary(unitId: string | null) {
  return useQuery({
    queryKey: ["unit_candidate_summary", unitId],
    enabled: !!unitId,
    queryFn: async () => {
      // 1. Get all unit_jobs for this unit
      const { data: unitJobs, error: ujErr } = await supabase
        .from("unit_jobs")
        .select("id, jobs(title)")
        .eq("unit_id", unitId!);

      if (ujErr || !unitJobs?.length) return [] as UnitCandidateSummary[];

      const jobTitleMap: Record<string, string> = {};
      unitJobs.forEach((uj: any) => {
        jobTitleMap[uj.id] = uj.jobs?.title || "Sem título";
      });

      const jobIds = unitJobs.map((uj: any) => uj.id);

      // 2. Fetch all applications with candidate profile
      const { data: apps, error: appErr } = await supabase
        .from("applications")
        .select("id, status, created_at, unit_job_id, candidate_id, profiles(full_name, city, state)")
        .in("unit_job_id", jobIds)
        .order("created_at", { ascending: false });

      if (appErr || !apps) return [] as UnitCandidateSummary[];

      return apps.map((a: any): UnitCandidateSummary => ({
        applicationId: a.id,
        candidateName: a.profiles?.full_name || "Candidato",
        candidateCity: a.profiles?.city || null,
        candidateState: a.profiles?.state || null,
        jobTitle: jobTitleMap[a.unit_job_id] || "—",
        unitJobId: a.unit_job_id,
        status: a.status,
        appliedAt: a.created_at,
      }));
    },
  });
}
