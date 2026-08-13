import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface Collaborator {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  cpf: string;
  city: string | null;
  state: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  jobTitle: string;
  departmentName: string | null;
  unitName: string;
  unitId: string | null;
  isFranqueadora: boolean;
  hiredAt: string | null;
  source: "migration" | "csv_import";
  pending?: boolean;
}

export function useCollaborators() {
  const { hasRole, unitIds } = useAuth();
  const isGlobalAdmin = hasRole("admin");

  return useQuery({
    queryKey: ["collaborators", "v4", isGlobalAdmin, unitIds],
    queryFn: async () => {
      const seen = new Set<string>();
      const result: Collaborator[] = [];

      // ===== Source 1: migration_logs completed (oficialmente contratados) =====
      let mq = supabase
        .from("migration_logs")
        .select("*, profiles:candidate_id(*), units:unit_id(*), jobs:job_id(*, departments(*))")
        .eq("status", "completed");

      if (!isGlobalAdmin && unitIds.length > 0) {
        mq = mq.in("unit_id", unitIds);
      }

      const { data: migData, error: migErr } = await mq;
      if (migErr) throw migErr;

      for (const log of migData || []) {
        const cpf = (log as any).cpf;
        if (cpf && seen.has(cpf)) continue;
        if (cpf) seen.add(cpf);

        result.push({
          id: log.id,
          fullName: (log.profiles as any)?.full_name || "Sem nome",
          email: (log.profiles as any)?.email || "",
          phone: (log.profiles as any)?.phone || null,
          cpf: (log as any).cpf,
          city: (log.profiles as any)?.city || null,
          state: (log.profiles as any)?.state || null,
          avatarUrl: (log.profiles as any)?.avatar_url || null,
          isActive: (log.profiles as any)?.is_active ?? true,
          jobTitle: (log.jobs as any)?.title || "Cargo não definido",
          departmentName: (log.jobs as any)?.departments?.name || null,
          unitName: (log.units as any)?.name || "Unidade não definida",
          unitId: (log as any).unit_id,
          isFranqueadora: (log.units as any)?.is_franqueadora ?? false,
          hiredAt: (log as any).completed_at || (log as any).created_at,
          source: "migration",
        });
      }

      // ===== Source 2: activity_logs csv_collaborator_created (importados via CSV) =====
      const { data: actData, error: actErr } = await supabase
        .from("activity_logs")
        .select("id, created_at, details")
        .eq("action", "csv_collaborator_created")
        .order("created_at", { ascending: false })
        .limit(2000);

      if (actErr) throw actErr;

      // Coletar IDs para enriquecer
      const candidateIds: string[] = [];
      const jobIds = new Set<string>();
      const unitIdsSet = new Set<string>();

      const rows = (actData || [])
        .map((r) => {
          const d = (r.details as any) || {};
          return {
            logId: r.id,
            createdAt: r.created_at,
            candidateId: d.created_user_id as string | undefined,
            cpf: d.cpf as string | undefined,
            cargo: d.cargo as string | undefined,
            jobId: d.job_id as string | undefined,
            unitId: d.unit_id as string | undefined,
            fullName: d.full_name as string | undefined,
            email: d.email as string | undefined,
            hasAdmission: d.has_admission as boolean | undefined,
          };
        })
        .filter((r) => r.candidateId);

      for (const r of rows) {
        if (r.candidateId) candidateIds.push(r.candidateId);
        if (r.jobId) jobIds.add(r.jobId);
        if (r.unitId) unitIdsSet.add(r.unitId);
      }

      // Filtro de escopo (não admin global): só unidades permitidas
      const scopeFilter = (unitId: string | undefined) => {
        if (isGlobalAdmin) return true;
        if (!unitId) return false;
        return unitIds.includes(unitId);
      };

      // Buscar dados em batch
      const [candRes, jobRes, unitRes] = await Promise.all([
        candidateIds.length
          ? supabase.from("candidates").select("id, full_name, email, phone, cpf, city, state, avatar_url, is_active").in("id", candidateIds)
          : Promise.resolve({ data: [], error: null } as any),
        jobIds.size
          ? supabase.from("jobs").select("id, title, departments(name)").in("id", Array.from(jobIds))
          : Promise.resolve({ data: [], error: null } as any),
        unitIdsSet.size
          ? supabase.from("units").select("id, name, is_franqueadora").in("id", Array.from(unitIdsSet))
          : Promise.resolve({ data: [], error: null } as any),
      ]);

      const candMap = new Map<string, any>();
      for (const c of (candRes.data as any[]) || []) candMap.set(c.id, c);
      const jobMap = new Map<string, any>();
      for (const j of (jobRes.data as any[]) || []) jobMap.set(j.id, j);
      const unitMap = new Map<string, any>();
      for (const u of (unitRes.data as any[]) || []) unitMap.set(u.id, u);

      for (const r of rows) {
        const cpf = r.cpf || "";
        if (cpf && seen.has(cpf)) continue;
        if (!scopeFilter(r.unitId)) continue;

        const cand = r.candidateId ? candMap.get(r.candidateId) : null;
        const job = r.jobId ? jobMap.get(r.jobId) : null;
        const unit = r.unitId ? unitMap.get(r.unitId) : null;

        // Pula se candidate foi excluído
        if (!cand) continue;

        if (cpf) seen.add(cpf);

        result.push({
          id: r.logId,
          fullName: cand.full_name || r.fullName || "Sem nome",
          email: cand.email || r.email || "",
          phone: cand.phone || null,
          cpf: cand.cpf || cpf,
          city: cand.city || null,
          state: cand.state || null,
          avatarUrl: cand.avatar_url || null,
          isActive: cand.is_active ?? true,
          jobTitle: job?.title || r.cargo || "Cargo não definido",
          departmentName: job?.departments?.name || null,
          unitName: unit?.name || "Unidade não definida",
          unitId: r.unitId || null,
          isFranqueadora: unit?.is_franqueadora ?? false,
          hiredAt: r.createdAt,
          source: "csv_import",
          pending: !r.hasAdmission,
        });
      }

      return result.slice().sort((a, b) =>
        (a.fullName || "").toLowerCase().localeCompare((b.fullName || "").toLowerCase(), "pt-BR")
      );
    },
  });
}
