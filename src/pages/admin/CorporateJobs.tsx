import { useState, useMemo, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Briefcase, Users, TrendingUp, Award, Trash2, Eye, ExternalLink, AlertTriangle, Bot, UserCheck, GraduationCap, FileText, CheckCircle, XCircle, Clock, Search as SearchIcon, CircleDot, PauseCircle, CircleOff, CircleCheckBig, Loader2, MapPin, SlidersHorizontal, Download, LayoutGrid, CalendarDays, BarChart3, UserX, Timer, Pencil, X as XIcon, Lock } from "lucide-react";
import { formatCEP } from "@/lib/masks";
import { Textarea } from "@/components/ui/textarea";
import { useUnitJobs, useCreateUnitJob, useUpdateUnitJob, useCorporateMetrics, useApplicationCountByUnitJob, useDeleteUnitJob, useUnits, useCloseJob, useUnitJobDeleteImpact } from "@/hooks/useUnitJobs";
import { useInfiniteScrollSentinel } from "@/hooks/useInfiniteScrollSentinel";
import { useJobs } from "@/hooks/useJobs";
import { useAuth } from "@/contexts/AuthContext";
import { useJobRequests, useCreateJobRequest, useReviewJobRequest, type JobRequest } from "@/hooks/useJobRequests";
import { useMyUnit } from "@/hooks/useMyUnit";
import { toast } from "sonner";
import { PageHelp } from "@/components/ui/page-help";
import { CorporateKanban } from "@/components/admin/CorporateKanban";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCorporateExtendedMetrics } from "@/hooks/useCorporateExtendedMetrics";
import { useGlobalSettings } from "@/hooks/useGlobalSettings";
import { useJobsWithTests, jobHasTest, jobHasSpecificTest } from "@/hooks/useJobsWithTests";
import { CorporateCatalogForFranchisee } from "@/components/admin/CorporateCatalogForFranchisee";
import { useCanOverrideUnitJob } from "@/hooks/useUnitOverridePolicy";
import { UnitJobInheritedSelector, UnitJobInheritedBanner } from "@/components/admin/UnitJobInheritedSelector";

const arraysEqual = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
import { useDiscoveryTraits, makeTraitLabelMap } from "@/hooks/useDiscoveryTraits";
import { dateInputToISO, isoToDateInput, formatDateBR } from "@/lib/dateUtils";
import { useDefaultJobAttributes, useDefaultJobAttributesMutations, type DefaultJobAttributeKind } from "@/hooks/useDefaultJobAttributes";
import { RecruitmentLinksDialog } from "@/components/admin/RecruitmentLinksDialog";

async function exportJobReport(unitJobId: string, jobTitle: string) {
  try {
    const { data: apps, error } = await supabase
      .from("applications")
      .select("id, status, total_score, created_at, candidate_id, profiles:candidate_id(full_name, email, cpf)")
      .eq("unit_job_id", unitJobId);
    if (error) throw error;
    if (!apps || apps.length === 0) {
      toast.info("Nenhum candidato para exportar.");
      return;
    }
    const SEP = ";";
    const esc = (v: any) => {
      const s = v == null ? "" : String(v);
      return `"${s.replace(/"/g, '""')}"`;
    };
    const headerCols = ["Nome", "Email", "CPF", "Status", "Score", "Data Candidatura"];
    const header = headerCols.map(esc).join(SEP);
    const rows = apps.map((a: any) => {
      const p = a.profiles;
      const cpf = p?.cpf ? p.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.***.***-$4") : "";
      return [
        p?.full_name || "",
        p?.email || "",
        cpf,
        a.status,
        a.total_score ?? "",
        new Date(a.created_at).toLocaleDateString("pt-BR"),
      ].map(esc).join(SEP);
    });
    const csv = [header, ...rows].join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `relatorio_${jobTitle.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Relatório exportado com sucesso!");
  } catch (e: any) {
    toast.error("Erro ao exportar: " + e.message);
  }
}

const STATUS_LABELS: Record<string, string> = {
  aberta: "Aberta",
  pausada: "Pausada",
  encerrada: "Encerrada",
  preenchida: "Preenchida",
};

const STATUS_COLORS: Record<string, string> = {
  aberta: "bg-success/10 text-success",
  pausada: "bg-warning/10 text-warning",
  encerrada: "bg-muted text-muted-foreground",
  preenchida: "bg-primary/10 text-primary",
};

const STATUS_ICONS: Record<string, any> = {
  aberta: CircleDot,
  pausada: PauseCircle,
  encerrada: CircleOff,
  preenchida: CircleCheckBig,
};

const WORK_MODEL_LABELS: Record<string, string> = {
  presencial: "Presencial",
  remoto: "Remoto",
  hibrido: "Híbrido",
};

const CONTRACT_TYPES = [
  { value: "clt", label: "CLT" },
  { value: "pj", label: "PJ" },
  { value: "estagio", label: "Estágio" },
  { value: "aprendiz", label: "Aprendiz" },
  { value: "temporario", label: "Temporário" },
];

const SALARY_MIN_TYPES = ["clt", "pj", "temporario"];
const SALARIO_MINIMO = 1618;

// Listas padrão de Benefícios, Responsabilidades e Requisitos agora vêm do banco
// (tabela `default_job_attributes`). Veja o hook useDefaultJobAttributes.
// Admin/rh_franqueadora podem remover itens via X de hover no próprio card de vaga (soft-delete).

function MetricCard({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string | number; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-xl font-bold text-foreground">{value}</p>
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

export default function CorporateJobs() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { hasRole, unitIds } = useAuth();

  // Role detection
  const isAdmin = hasRole("admin");
  const isAdmFranquia = hasRole("rh_franqueadora");
  const isCentral = isAdmin || isAdmFranquia;
  const isFranchisee = hasRole("franqueado") || hasRole("gestor_recrutamento");

  // Listas padrão (sugestões) carregadas do banco — somente itens ativos.
  const { data: benefitsRows } = useDefaultJobAttributes("benefit");
  const { data: responsibilitiesRows } = useDefaultJobAttributes("responsibility");
  const { data: requirementsRows } = useDefaultJobAttributes("requirement");
  const DEFAULT_BENEFITS = useMemo(() => (benefitsRows ?? []).map((r) => r.label), [benefitsRows]);
  const DEFAULT_RESPONSIBILITIES = useMemo(() => (responsibilitiesRows ?? []).map((r) => r.label), [responsibilitiesRows]);
  const DEFAULT_REQUIREMENTS = useMemo(() => (requirementsRows ?? []).map((r) => r.label), [requirementsRows]);

  // Catálogo de Características (discovery_traits) — para exibir labels herdadas.
  const { data: discoveryTraitRows } = useDiscoveryTraits(true);
  const traitLabelMap = useMemo(() => makeTraitLabelMap(discoveryTraitRows), [discoveryTraitRows]);
  const traitLabel = (id: string) => traitLabelMap.get(id) ?? id;

  // Mapa label → id por tipo, usado pelo X de exclusão (admin/rh_franqueadora).
  const labelToId = useMemo(() => {
    const m: Record<DefaultJobAttributeKind, Record<string, string>> = {
      benefit: {}, responsibility: {}, requirement: {},
    };
    (benefitsRows ?? []).forEach((r) => { m.benefit[r.label] = r.id; });
    (responsibilitiesRows ?? []).forEach((r) => { m.responsibility[r.label] = r.id; });
    (requirementsRows ?? []).forEach((r) => { m.requirement[r.label] = r.id; });
    return m;
  }, [benefitsRows, responsibilitiesRows, requirementsRows]);

  const { toggleActive: toggleDefaultActive } = useDefaultJobAttributesMutations();
  const [pendingDeleteDefault, setPendingDeleteDefault] = useState<{ kind: DefaultJobAttributeKind; id: string; label: string } | null>(null);
  const [pendingDeleteConfirmText, setPendingDeleteConfirmText] = useState("");

  const KIND_LABEL_PT: Record<DefaultJobAttributeKind, string> = {
    benefit: "benefícios",
    responsibility: "responsabilidades",
    requirement: "requisitos",
  };

  const requestDeleteDefault = (kind: DefaultJobAttributeKind, label: string) => {
    const id = labelToId[kind][label];
    if (!id) {
      toast.error("Item personalizado — só pode ser removido desmarcando o checkbox.");
      return;
    }
    setPendingDeleteDefault({ kind, id, label });
    setPendingDeleteConfirmText("");
  };

  const confirmDeleteDefault = async () => {
    if (!pendingDeleteDefault) return;
    try {
      await toggleDefaultActive.mutateAsync({
        id: pendingDeleteDefault.id,
        is_active: false,
        reason: "Removido via card de vaga",
      });
      toast.success(`"${pendingDeleteDefault.label}" removido das sugestões.`);
      setPendingDeleteDefault(null);
      setPendingDeleteConfirmText("");
    } catch (e: any) {
      toast.error(e.message || "Erro ao remover.");
    }
  };

  // Helper: can the logged-in user edit a specific unit job?
  // Admin edita tudo; ADM Franquia edita quando a personalização por unidade estiver autorizada.
  const canEditJob = (uj: any) => {
    if (isAdmin) return true;
    if (isAdmFranquia && allowUnitOverride && uj.unit_id && unitOverrideAllowedUnits.includes(uj.unit_id)) return true;
    if (isFranchisee && uj.unit_id && unitIds.includes(uj.unit_id)) return true;
    return false;
  };

  // Pode VER candidatos da vaga (admin, sede/franqueadora, ou dono da unidade)
  const canViewCandidates = (uj: any) => {
    if (isAdmin || isAdmFranquia) return true;
    if (isFranchisee && uj.unit_id && unitIds.includes(uj.unit_id)) return true;
    return false;
  };

  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterJob, setFilterJob] = useState<string>("all");
  const [filterUnit, setFilterUnit] = useState<string>("all");
  const JOBS_PAGE_SIZE = 20;
  const [visibleJobsCount, setVisibleJobsCount] = useState(JOBS_PAGE_SIZE);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({
    job_id: "", unit_id: "", salary: "", work_model: "presencial", openings: "1",
    contract_type: "clt",
    address_cep: "", address_street: "", address_number: "", address_neighborhood: "",
    address_city: "", address_state: "", address_complement: "",
    work_hours_weekly: "",
    opens_at: "", closes_at: "",
  });

  const [selectedBenefits, setSelectedBenefits] = useState<string[]>([]);
  const [customBenefit, setCustomBenefit] = useState("");
  const [responsibilities, setResponsibilities] = useState<string[]>([]);
  
  const [requirements, setRequirements] = useState<string[]>([]);
  const [newRequirement, setNewRequirement] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [deleteBlocked, setDeleteBlocked] = useState<string | null>(null);
  const [needsCloseFirst, setNeedsCloseFirst] = useState(false);
  const [closingForDelete, setClosingForDelete] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteAcknowledged, setDeleteAcknowledged] = useState(false);
  const { data: deleteImpact } = useUnitJobDeleteImpact(deleteTarget?.id);
  const [closeTarget, setCloseTarget] = useState<any>(null);
  const [fillTarget, setFillTarget] = useState<any>(null);
  const closeJob = useCloseJob();
  const [viewedJobs, setViewedJobs] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem("viewedJobs") || "{}"); } catch { return {}; }
  });
  const [addressLoading, setAddressLoading] = useState(false);
  const { data: allUnits } = useUnits();

  // Units for creation (central roles: all; franqueado/gestor: linked units)
  const createUnits = isCentral ? allUnits : allUnits?.filter((u: any) => unitIds.includes(u.id));
  // Units for filter dropdown (central roles see all; others see only linked)
  const filterUnits = isCentral ? allUnits : allUnits?.filter((u: any) => unitIds.includes(u.id));
  const { data: metrics } = useCorporateMetrics();
  const { data: extendedMetrics } = useCorporateExtendedMetrics();

  const { data: testsData } = useJobsWithTests();

  // CrossConfig: kanban_enabled + auto_publish + allow_salary_hidden
  const { data: corpSettings } = useGlobalSettings("corporate_jobs");
  const { data: unitsSettings } = useGlobalSettings("units");
  const allowUnitOverride = useMemo(() => {
    const value = unitsSettings?.find((s: any) => s.key === "allow_unit_override")?.value;
    return value === true || value === "true";
  }, [unitsSettings]);
  const unitOverrideAllowedUnits = useMemo(() => {
    const value = unitsSettings?.find((s: any) => s.key === "unit_override_allowed_units")?.value;
    return Array.isArray(value) ? (value as string[]) : [];
  }, [unitsSettings]);
  const kanbanEnabledSetting = useMemo(() => {
    const s = corpSettings?.find((s: any) => s.key === "corporate_kanban_enabled");
    return s?.value !== false && s?.value !== "false";
  }, [corpSettings]);

  // Item 16: corporate_job_auto_publish
  const autoPublishEnabled = useMemo(() => {
    const s = corpSettings?.find((s: any) => s.key === "corporate_job_auto_publish");
    return s?.value === true || s?.value === "true";
  }, [corpSettings]);

  // Item 17: allow_salary_hidden
  const allowSalaryHidden = useMemo(() => {
    const s = corpSettings?.find((s: any) => s.key === "allow_salary_hidden");
    return s?.value === true || s?.value === "true";
  }, [corpSettings]);

  // Job request state
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);
  const [requestForm, setRequestForm] = useState({ title: "", description: "", salary: "", work_model: "presencial", openings: "1" });
  // null = ainda não tocado (todos marcados por padrão); array = seleção explícita do usuário
  const [requestBenefits, setRequestBenefits] = useState<string[] | null>(null);


  const [requestResponsibilities, setRequestResponsibilities] = useState<string[]>([]);
  const [requestRequirements, setRequestRequirements] = useState<string[]>([]);
  const [requestCepRef, setRequestCepRef] = useState("");
  const [requestCepRefCoords, setRequestCepRefCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [requestCepRefLabel, setRequestCepRefLabel] = useState<string | null>(null);
  const [requestCepLoading, setRequestCepLoading] = useState(false);
  const [requestRadiusKm, setRequestRadiusKm] = useState("10");
  // requestCustomBenefit removido: franqueado não cadastra benefícios custom — apenas marca da lista padrão.
  const [selectedRequestUnit, setSelectedRequestUnit] = useState("");
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<JobRequest | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [filterRequestStatus, setFilterRequestStatus] = useState<string>("all");
  const [filterRequestUnit, setFilterRequestUnit] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"vagas" | "solicitacoes" | "talentos" | "relatorios">("vagas");

  // Reset listas ao abrir; franqueado seleciona quais aplicar
  useEffect(() => {
    if (requestDialogOpen) {
      setRequestResponsibilities([]);
      setRequestRequirements([]);
    }
  }, [requestDialogOpen]);
  const [kanbanJobId, setKanbanJobId] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<any>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editLocked, setEditLocked] = useState(false);
  const [editForm, setEditForm] = useState<any>({});
  const [editBenefits, setEditBenefits] = useState<string[]>([]);
  const [editCustomBenefit, setEditCustomBenefit] = useState("");
  const [editResponsibilities, setEditResponsibilities] = useState<string[]>([]);
  
  const [editRequirements, setEditRequirements] = useState<string[]>([]);
  const [editNewRequirement, setEditNewRequirement] = useState("");
  const [editAddressLoading, setEditAddressLoading] = useState(false);
  const [editFilterCepRef, setEditFilterCepRef] = useState("");
  const [editFilterCepRefCoords, setEditFilterCepRefCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [editFilterCepRefLabel, setEditFilterCepRefLabel] = useState<string | null>(null);
  const [editFilterRadiusKm, setEditFilterRadiusKm] = useState("10");
  const [editFilterCepLoading, setEditFilterCepLoading] = useState(false);

  // Candidate filter states (stored per job)
  const [filterCepRef, setFilterCepRef] = useState("");
  const [filterCepRefCoords, setFilterCepRefCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [filterCepRefLabel, setFilterCepRefLabel] = useState<string | null>(null);
  const [filterRadiusKm, setFilterRadiusKm] = useState("10");
  const [filterCepLoading, setFilterCepLoading] = useState(false);

  const { data: myUnits, isLoading: myUnitLoading } = useMyUnit();
  const myUnitList = Array.isArray(myUnits) ? myUnits : myUnits ? [myUnits] : [];

  useEffect(() => {
    if (myUnitList.length === 1) setSelectedRequestUnit(myUnitList[0].id);
  }, [myUnitList.length]);
  const { data: jobRequests } = useJobRequests({ status: filterRequestStatus !== "all" ? filterRequestStatus : undefined, unitId: filterRequestUnit !== "all" ? filterRequestUnit : undefined });
  const createJobRequest = useCreateJobRequest();
  const reviewJobRequest = useReviewJobRequest();

  const filters = useMemo(() => {
    const f: any = {};
    if (filterStatus !== "all") f.status = filterStatus;
    if (filterJob !== "all") f.jobId = filterJob;

    if (!isCentral) {
      // Non-central users: ALWAYS restrict to their units
      if (unitIds.length > 0) {
        if (filterUnit !== "all" && unitIds.includes(filterUnit)) {
          f.unitId = filterUnit;
        } else {
          f.unitIds = unitIds;
        }
      } else {
        // No units assigned — show nothing
        f.unitIds = ["__none__"];
      }
    } else {
      // Central users: apply unit filter only if explicitly selected
      if (filterUnit !== "all") f.unitId = filterUnit;
    }

    return f;
  }, [filterStatus, filterJob, filterUnit, isCentral, unitIds]);

  const { data: unitJobs, isLoading } = useUnitJobs(filters);

  // Reseta paginação quando filtros mudam
  useEffect(() => {
    setVisibleJobsCount(JOBS_PAGE_SIZE);
  }, [filterStatus, filterJob, filterUnit]);

  const visibleUnitJobs = useMemo(
    () => (unitJobs || []).slice(0, visibleJobsCount),
    [unitJobs, visibleJobsCount],
  );
  const hasMoreUnitJobs = (unitJobs?.length ?? 0) > visibleUnitJobs.length;
  const jobsSentinelRef = useInfiniteScrollSentinel<HTMLDivElement>(
    () => setVisibleJobsCount((c) => c + JOBS_PAGE_SIZE),
    hasMoreUnitJobs,
  );

  const { data: jobs } = useJobs(true);
  const createUnitJob = useCreateUnitJob();
  const updateUnitJob = useUpdateUnitJob();
  const deleteUnitJob = useDeleteUnitJob();

  // Trava em tempo real: vaga ativa duplicada para mesmo cargo+unidade
  const { data: duplicateActiveUnitJob } = useQuery({
    queryKey: ["unit_jobs_duplicate_check", form.job_id, form.unit_id],
    enabled: !!form.job_id && !!form.unit_id && dialogOpen,
    queryFn: async () => {
      const { data } = await supabase
        .from("unit_jobs")
        .select("id, status, job_id, unit_id, jobs(title), units(name)")
        .eq("job_id", form.job_id)
        .eq("unit_id", form.unit_id)
        .in("status", ["aberta", "pausada"] as any)
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  

  // Auto-open dialog with pre-selected job from query param
  useEffect(() => {
    const newJobId = searchParams.get("newJob");
    const jobFilterId = searchParams.get("job");
    if (jobFilterId && jobs?.some((j) => j.id === jobFilterId)) {
      setFilterJob(jobFilterId);
    }
    if (newJobId && jobs?.length) {
      const jobExists = jobs.some((j) => j.id === newJobId);
      if (jobExists) {
        setForm((f) => ({ ...f, job_id: newJobId }));
        setDialogOpen(true);
        const nextParams = new URLSearchParams(searchParams);
        nextParams.delete("newJob");
        setSearchParams(nextParams, { replace: true });
      }
    }
  }, [searchParams, jobs]);

  // Supabase Realtime subscription for live updates
  const queryClient = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel("corporate_jobs_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "unit_jobs" }, () => {
        queryClient.invalidateQueries({ queryKey: ["unit_jobs"] });
        queryClient.invalidateQueries({ queryKey: ["corporate_metrics"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "applications" }, () => {
        queryClient.invalidateQueries({ queryKey: ["app_counts_by_uj"] });
        queryClient.invalidateQueries({ queryKey: ["corporate_metrics"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const unitJobIds = useMemo(() => (unitJobs || []).map((uj: any) => uj.id), [unitJobs]);
  const { data: appCounts } = useApplicationCountByUnitJob(unitJobIds);

  const lookupAddressCEP = async (rawCep: string) => {
    const digits = rawCep.replace(/\D/g, "");
    if (digits.length !== 8) return;
    setAddressLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("lookup-cep", { body: { cep: digits } });
      if (error || !data?.found) throw new Error("not_found");
      setForm(f => ({
        ...f,
        address_street: data.street || f.address_street,
        address_neighborhood: data.neighborhood || f.address_neighborhood,
        address_city: data.city || f.address_city,
        address_state: data.state || f.address_state,
      }));
    } catch {
      toast.error("CEP não encontrado");
    } finally {
      setAddressLoading(false);
    }
  };

  const lookupFilterCEP = async (rawCep: string) => {
    const digits = rawCep.replace(/\D/g, "");
    if (digits.length !== 8) { setFilterCepRefCoords(null); setFilterCepRefLabel(null); return; }
    setFilterCepLoading(true);
    setFilterCepRefCoords(null);
    setFilterCepRefLabel(null);
    try {
      const { data, error } = await supabase.functions.invoke("lookup-cep", { body: { cep: digits } });
      if (error || !data?.found) throw new Error("not_found");
      const parts = [data.neighborhood, data.city, data.state].filter(Boolean);
      setFilterCepRefLabel(parts.join(", ") || "Endereço não disponível");
      if (data.latitude && data.longitude) {
        setFilterCepRefCoords({ lat: data.latitude, lng: data.longitude });
      }
    } catch {
      setFilterCepRefLabel("CEP inválido");
      setFilterCepRefCoords(null);
    } finally {
      setFilterCepLoading(false);
    }
  };

  const lookupRequestCEP = async (rawCep: string) => {
    const digits = rawCep.replace(/\D/g, "");
    if (digits.length !== 8) { setRequestCepRefCoords(null); setRequestCepRefLabel(null); return; }
    setRequestCepLoading(true);
    setRequestCepRefCoords(null);
    setRequestCepRefLabel(null);
    try {
      const { data, error } = await supabase.functions.invoke("lookup-cep", { body: { cep: digits } });
      if (error || !data?.found) throw new Error("not_found");
      const parts = [data.neighborhood, data.city, data.state].filter(Boolean);
      setRequestCepRefLabel(parts.join(", ") || "Endereço não disponível");
      if (data.latitude && data.longitude) {
        setRequestCepRefCoords({ lat: data.latitude, lng: data.longitude });
      }
    } catch {
      setRequestCepRefLabel("CEP inválido");
      setRequestCepRefCoords(null);
    } finally {
      setRequestCepLoading(false);
    }
  };

  // Auto-fill address when unit is selected
  const handleUnitChange = (unitId: string) => {
    setForm(f => ({ ...f, unit_id: unitId }));
    const unit = allUnits?.find((u: any) => u.id === unitId);
    if (unit) {
      setForm(f => ({
        ...f,
        unit_id: unitId,
        address_cep: unit.cep ? formatCEP(unit.cep) : f.address_cep,
        address_city: unit.city || f.address_city,
        address_state: unit.state || f.address_state,
      }));
      if (unit.cep) {
        lookupAddressCEP(unit.cep);
        // Auto-fill reference CEP with unit's CEP
        const formattedCep = formatCEP(unit.cep);
        setFilterCepRef(formattedCep);
        lookupFilterCEP(formattedCep);
      }
    }
  };

  const resetForm = () => {
    setForm({
      job_id: "", unit_id: "", salary: "", work_model: "presencial", openings: "1",
      contract_type: "clt",
      address_cep: "", address_street: "", address_number: "", address_neighborhood: "",
      address_city: "", address_state: "", address_complement: "",
      work_hours_weekly: "",
      opens_at: "", closes_at: "",
    });
    setSelectedBenefits([]);
    setResponsibilities([]);
    setRequirements([]);
    setFilterCepRef("");
    setFilterCepRefCoords(null);
    setFilterCepRefLabel(null);
    setFilterRadiusKm("10");
  };

  const handleCreate = async () => {
    if (!isAdmin) {
      toast.error("Apenas administradores da Sede podem criar vagas diretamente. Use 'Solicitar Vaga'.");
      return;
    }
    if (!form.job_id) { toast.error("Selecione um cargo."); return; }
    if (!form.unit_id) { toast.error("Selecione uma unidade."); return; }
    if (duplicateActiveUnitJob) {
      toast.error("Já existe uma vaga ativa para este cargo nessa unidade. Encerre-a antes de abrir uma nova.");
      return;
    }
    // Item 17: Block salary-hidden publication if not allowed
    const salary = form.salary ? Number(form.salary) : null;
    const salaryMax = (form as any).salary_max ? Number((form as any).salary_max) : null;
    if (!salary && !allowSalaryHidden) {
      toast.error("Configuração global exige que o salário seja informado ao publicar vaga.");
      return;
    }
    if (salary && salary < 0) {
      toast.error("Salário não pode ser negativo.");
      return;
    }
    if (salaryMax && salaryMax < 0) {
      toast.error("Salário máximo não pode ser negativo.");
      return;
    }
    if (salary && salaryMax && salaryMax < salary) {
      toast.error("Salário máximo não pode ser menor que o salário mínimo.");
      return;
    }
    if (salary && SALARY_MIN_TYPES.includes(form.contract_type) && salary < SALARIO_MINIMO) {
      toast.error(`Salário mínimo para ${form.contract_type.toUpperCase()} é R$ ${SALARIO_MINIMO.toLocaleString("pt-BR")}.`);
      return;
    }
    const hours = form.work_hours_weekly ? Number(form.work_hours_weekly) : null;
    if (hours && hours > 44) {
      toast.error("Jornada de trabalho não pode ultrapassar 44 horas semanais.");
      return;
    }
    try {
      const candidateFilters: any = {};
      if (filterCepRefCoords) { candidateFilters.cep_lat = filterCepRefCoords.lat; candidateFilters.cep_lng = filterCepRefCoords.lng; candidateFilters.cep_ref = filterCepRef.replace(/\D/g,""); candidateFilters.radius_km = Number(filterRadiusKm); }

      await createUnitJob.mutateAsync({
        job_id: form.job_id,
        unit_id: form.unit_id,
        salary,
        work_model: form.work_model,
        openings: Number(form.openings) || 1,
        candidate_filters: Object.keys(candidateFilters).length > 0 ? candidateFilters : null,
        contract_type: form.contract_type,
        address_cep: form.address_cep || null,
        address_street: form.address_street || null,
        address_number: form.address_number || null,
        address_neighborhood: form.address_neighborhood || null,
        address_city: form.address_city || null,
        address_state: form.address_state || null,
        address_complement: form.address_complement || null,
        work_hours_weekly: hours,
        opens_at: dateInputToISO(form.opens_at),
        closes_at: dateInputToISO(form.closes_at),
      });
      toast.success("Vaga corporativa criada");
      setDialogOpen(false);
      resetForm();
    } catch (e: any) { toast.error(e.message); }
  };

  const changeStatus = async (id: string, status: string) => {
    await updateUnitJob.mutateAsync({ id, status: status as any });
    toast.success("Status atualizado");
  };

  const requestStatusChange = (uj: any, newStatus: string) => {
    if (newStatus === uj.status) return;
    if (newStatus === "encerrada") {
      // Roteia para o dialog de aviso + closeJob (notifica candidatos, move para standby)
      setCloseTarget(uj);
      return;
    }
    if (newStatus === "preenchida") {
      setFillTarget(uj);
      return;
    }
    // aberta <-> pausada e demais transições seguem direto
    void changeStatus(uj.id, newStatus);
  };

  const openEditDialog = async (uj: any, locked: boolean = false) => {
    // Re-fetch fresh row to ensure we hydrate the dialog with the latest DB values
    // (defensive: avoids cached/stale data when reopening for an openings-only edit).
    let fresh = uj;
    try {
      const { data } = await supabase
        .from("unit_jobs")
        .select("*, jobs(*), units(id, name, city, state, cep)")
        .eq("id", uj.id)
        .maybeSingle();
      if (data) fresh = { ...uj, ...data, jobs: (data as any).jobs ?? uj.jobs, units: (data as any).units ?? uj.units };
    } catch {
      // fall back to in-memory uj
    }
    // Resolve sourceUnit: prefer fresh allUnits over nested join
    const sourceUnit = allUnits?.find((u: any) => u.id === fresh.unit_id) || fresh.units || null;
    const rawCep = fresh.address_cep || sourceUnit?.cep || "";
    const cepValue = rawCep ? formatCEP(rawCep) : "";
    const formData = {
      salary: fresh.salary ?? "",
      salary_max: fresh.salary_max ?? "",
      work_model: fresh.work_model || "presencial",
      contract_type: fresh.contract_type || "clt",
      openings: fresh.openings ?? 1,
      address_cep: cepValue,
      address_street: fresh.address_street || "",
      address_number: fresh.address_number || "",
      address_neighborhood: fresh.address_neighborhood || "",
      address_city: fresh.address_city || sourceUnit?.city || "",
      address_state: fresh.address_state || sourceUnit?.state || "",
      address_complement: fresh.address_complement || "",
      work_hours_weekly: fresh.work_hours_weekly ?? "",
      opens_at: isoToDateInput(fresh.opens_at),
      closes_at: isoToDateInput(fresh.closes_at),
    };
    setEditTarget(fresh);
    setEditLocked(locked);
    setEditForm(formData);
    const masterBenefits: string[] = Array.isArray(fresh.jobs?.benefits) ? fresh.jobs.benefits : [];
    const masterResp: string[] = Array.isArray(fresh.jobs?.responsibilities) ? fresh.jobs.responsibilities : [];
    const masterReq: string[] = Array.isArray(fresh.jobs?.requirements) ? fresh.jobs.requirements : [];
    setEditBenefits(Array.isArray(fresh.benefits_override) ? fresh.benefits_override.filter((x: string) => masterBenefits.includes(x)) : masterBenefits);
    setEditResponsibilities(Array.isArray(fresh.responsibilities_override) ? fresh.responsibilities_override.filter((x: string) => masterResp.includes(x)) : masterResp);
    setEditRequirements(Array.isArray(fresh.requirements_override) ? fresh.requirements_override.filter((x: string) => masterReq.includes(x)) : masterReq);
    const cf = fresh.candidate_filters as any;
    if (cf?.cep_ref) {
      setEditFilterCepRef(formatCEP(cf.cep_ref));
      setEditFilterCepRefCoords(cf.cep_lat && cf.cep_lng ? { lat: cf.cep_lat, lng: cf.cep_lng } : null);
      setEditFilterRadiusKm(String(cf.radius_km ?? 10));
    } else {
      setEditFilterCepRef("");
      setEditFilterCepRefCoords(null);
      setEditFilterCepRefLabel(null);
      setEditFilterRadiusKm("10");
    }
    setEditDialogOpen(true);
  };

  useEffect(() => {
    const shouldOpenEdit = searchParams.get("openEdit") === "1";
    const jobId = searchParams.get("job");
    if (!shouldOpenEdit || !jobId || editDialogOpen || !unitJobs?.length) return;
    const target = unitJobs.find((uj: any) => uj.job_id === jobId && canEditJob(uj));
    if (!target) return;

    const counts = appCounts?.[target.id];
    void openEditDialog(target, (counts?.total ?? 0) > 0);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("openEdit");
    setSearchParams(nextParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, unitJobs, appCounts, editDialogOpen]);

  // Hidratação pós-abertura: dispara lookups APÓS o estado do form estar comprometido,
  // evitando race condition com o setEditForm inicial.
  useEffect(() => {
    if (!editDialogOpen) return;
    if (
      editForm.address_cep &&
      (!editForm.address_street || !editForm.address_neighborhood)
    ) {
      lookupEditAddressCEP(editForm.address_cep);
    }
    if (editFilterCepRef && !editFilterCepRefCoords) {
      lookupEditFilterCEP(editFilterCepRef);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editDialogOpen]);

  const lookupEditAddressCEP = async (rawCep: string) => {
    const digits = rawCep.replace(/\D/g, "");
    if (digits.length !== 8) return;
    setEditAddressLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("lookup-cep", { body: { cep: digits } });
      if (error || !data?.found) throw new Error("not_found");
      setEditForm((f: any) => ({
        ...f,
        address_street: data.street || f.address_street,
        address_neighborhood: data.neighborhood || f.address_neighborhood,
        address_city: data.city || f.address_city,
        address_state: data.state || f.address_state,
      }));
    } catch {
      toast.error("CEP não encontrado");
    } finally {
      setEditAddressLoading(false);
    }
  };

  const lookupEditFilterCEP = async (rawCep: string) => {
    const digits = rawCep.replace(/\D/g, "");
    if (digits.length !== 8) { setEditFilterCepRefCoords(null); setEditFilterCepRefLabel(null); return; }
    setEditFilterCepLoading(true);
    setEditFilterCepRefCoords(null);
    setEditFilterCepRefLabel(null);
    try {
      const { data, error } = await supabase.functions.invoke("lookup-cep", { body: { cep: digits } });
      if (error || !data?.found) throw new Error("not_found");
      const parts = [data.neighborhood, data.city, data.state].filter(Boolean);
      setEditFilterCepRefLabel(parts.join(", ") || "Endereço não disponível");
      if (data.latitude && data.longitude) {
        setEditFilterCepRefCoords({ lat: data.latitude, lng: data.longitude });
      }
    } catch {
      setEditFilterCepRefLabel("CEP inválido");
      setEditFilterCepRefCoords(null);
    } finally {
      setEditFilterCepLoading(false);
    }
  };

  const canOverride = useCanOverrideUnitJob(editTarget?.unit_id ?? null);
  const masterBenefitsForSave: string[] = Array.isArray(editTarget?.jobs?.benefits) ? editTarget.jobs.benefits : [];
  const masterResponsibilitiesForSave: string[] = Array.isArray(editTarget?.jobs?.responsibilities) ? editTarget.jobs.responsibilities : [];
  const masterRequirementsForSave: string[] = Array.isArray(editTarget?.jobs?.requirements) ? editTarget.jobs.requirements : [];

  const handleEditSave = async () => {
    if (!editTarget) return;
    const overridePayload = canOverride.canEdit ? {
      benefits_override: arraysEqual(editBenefits, masterBenefitsForSave) ? null : editBenefits,
      responsibilities_override: arraysEqual(editResponsibilities, masterResponsibilitiesForSave) ? null : editResponsibilities,
      requirements_override: arraysEqual(editRequirements, masterRequirementsForSave) ? null : editRequirements,
    } : {};
    if (editLocked) {
      // PARTIAL UPDATE — vaga já tem candidatos.
      // Enviamos APENAS campos seguros: quantidade e, quando autorizado,
      // as marcações herdadas do Cargo. Dados operacionais continuam travados.
      const newOpenings = Number(editForm.openings) || 1;
      if (newOpenings < 1) { toast.error("Quantidade de posições deve ser maior que zero."); return; }
      try {
        const lockedPayload = Object.freeze({ id: editTarget.id, openings: newOpenings, ...overridePayload });
        await updateUnitJob.mutateAsync(lockedPayload as any);
        toast.success(canOverride.canEdit ? "Vaga atualizada com sucesso" : "Quantidade de posições atualizada");
        setEditDialogOpen(false);
        setEditTarget(null);
        setEditLocked(false);
      } catch (e: any) {
        toast.error(e.message);
      }
      return;
    }
    const salary = editForm.salary ? Number(editForm.salary) : null;
    const salaryMax = editForm.salary_max ? Number(editForm.salary_max) : null;
    if (salary && salary < 0) { toast.error("Salário não pode ser negativo."); return; }
    if (salaryMax && salaryMax < 0) { toast.error("Salário máximo não pode ser negativo."); return; }
    if (salary && salaryMax && salaryMax < salary) { toast.error("Salário máximo não pode ser menor que o mínimo."); return; }
    if (salary && SALARY_MIN_TYPES.includes(editForm.contract_type) && salary < SALARIO_MINIMO) {
      toast.error(`Salário mínimo para ${editForm.contract_type.toUpperCase()} é R$ ${SALARIO_MINIMO.toLocaleString("pt-BR")}.`);
      return;
    }
    const hours = editForm.work_hours_weekly ? Number(editForm.work_hours_weekly) : null;
    if (hours && hours > 44) { toast.error("Jornada não pode ultrapassar 44 horas semanais."); return; }
    try {
      const candidateFilters: any = {};
      if (editFilterCepRefCoords) {
        candidateFilters.cep_lat = editFilterCepRefCoords.lat;
        candidateFilters.cep_lng = editFilterCepRefCoords.lng;
        candidateFilters.cep_ref = editFilterCepRef.replace(/\D/g, "");
        candidateFilters.radius_km = Number(editFilterRadiusKm);
      }
      await updateUnitJob.mutateAsync({
        id: editTarget.id,
        salary,
        salary_max: salaryMax,
        work_model: editForm.work_model,
        openings: Number(editForm.openings) || 1,
        contract_type: editForm.contract_type,
        address_cep: editForm.address_cep || null,
        address_street: editForm.address_street || null,
        address_number: editForm.address_number || null,
        address_neighborhood: editForm.address_neighborhood || null,
        address_city: editForm.address_city || null,
        address_state: editForm.address_state || null,
        address_complement: editForm.address_complement || null,
        work_hours_weekly: hours,
        candidate_filters: Object.keys(candidateFilters).length > 0 ? candidateFilters : null,
        opens_at: dateInputToISO(editForm.opens_at),
        closes_at: dateInputToISO(editForm.closes_at),
        ...overridePayload,
      } as any);
      toast.success("Vaga atualizada com sucesso");
      setEditDialogOpen(false);
      setEditTarget(null);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleDeleteUnitJob = (uj: any) => {
    setDeleteTarget(uj);
    setDeleteBlocked(null);
    setNeedsCloseFirst(false);
    setDeleteConfirmText("");
    setDeleteAcknowledged(false);
  };

  const confirmDeleteUnitJob = async () => {
    if (!deleteTarget) return;
    try {
      const result: any = await deleteUnitJob.mutateAsync(deleteTarget.id);
      const apps = result?.impact?.applications || 0;
      toast.success(apps > 0 ? `Vaga e ${apps} candidatura(s) excluídas` : "Vaga excluída com sucesso");
      setDeleteTarget(null);
      setNeedsCloseFirst(false);
      setDeleteConfirmText("");
      setDeleteAcknowledged(false);
    } catch (e: any) {
      if (e.message === "BLOCKED:NEEDS_CLOSE") {
        setNeedsCloseFirst(true);
      } else if (e.message?.startsWith("BLOCKED:")) {
        setDeleteBlocked(e.message.replace("BLOCKED:", ""));
      } else {
        toast.error(e.message);
        setDeleteTarget(null);
      }
    }
  };

  const handleCloseAndDelete = async () => {
    if (!deleteTarget) return;
    setClosingForDelete(true);
    try {
      const result = await closeJob.mutateAsync(deleteTarget.id);
      toast.success(`Vaga encerrada. ${result.notified} candidato(s) notificado(s).`);
      // Após encerrar, NÃO excluir direto: cair no Estado B (aviso de cascata + CONFIRMAR)
      setNeedsCloseFirst(false);
      setDeleteConfirmText("");
      setDeleteAcknowledged(false);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setClosingForDelete(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold text-foreground">Vagas Corporativas</h2>
        <div className="flex items-center gap-2">
        <PageHelp />
        {isAdmin && (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="whitespace-nowrap"><Plus className="h-4 w-4 mr-2 shrink-0" />Nova Vaga Corporativa</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Nova Vaga Corporativa</DialogTitle></DialogHeader>
            <div className="space-y-5">
              {/* Cargo (read-only selection) */}
              <div>
                <Label>Cargo <span className="text-destructive">*</span></Label>
                <Select value={form.job_id} onValueChange={(v) => setForm({ ...form, job_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecionar cargo" /></SelectTrigger>
                  <SelectContent>{jobs?.map((j) => <SelectItem key={j.id} value={j.id}>{j.title}</SelectItem>)}</SelectContent>
                </Select>
                {form.job_id && (() => {
                  const selectedJob = jobs?.find((j) => j.id === form.job_id);
                  if (!selectedJob) return null;
                  return (
                    <Card className="mt-2 bg-muted/50 border-dashed">
                      <CardContent className="p-3 space-y-2">
                        <p className="text-xs font-medium text-foreground">{selectedJob.title}</p>
                        {selectedJob.description && (
                          <p className="text-xs text-muted-foreground line-clamp-3">{selectedJob.description}</p>
                        )}
                        <div className="flex flex-wrap gap-1.5">
                          {selectedJob.requires_ai_interview && <Badge variant="outline" className="text-[10px] gap-1"><Bot className="h-3 w-3" />Entrevista IA</Badge>}
                          {selectedJob.requires_human_interview && <Badge variant="outline" className="text-[10px] gap-1"><UserCheck className="h-3 w-3" />Entrevista Humana</Badge>}
                          {selectedJob.allows_career_plan && <Badge variant="outline" className="text-[10px] gap-1"><GraduationCap className="h-3 w-3" />Plano de Carreira</Badge>}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })()}
                <p className="text-[11px] text-muted-foreground mt-1">Título e descrição são definidos no cadastro de cargos e não podem ser editados aqui.</p>
              </div>

              {/* Unidade */}
              <div>
                <Label>Unidade <span className="text-destructive">*</span></Label>
                <Select value={form.unit_id} onValueChange={handleUnitChange}>
                  <SelectTrigger><SelectValue placeholder="Selecionar unidade" /></SelectTrigger>
                  <SelectContent>
                    {(() => {
                      const sede = createUnits?.filter((u: any) => u.is_franqueadora) || [];
                      const demais = createUnits?.filter((u: any) => !u.is_franqueadora) || [];
                      return (
                        <>
                          {sede.length > 0 && (
                            <SelectGroup>
                              <SelectLabel>Sede</SelectLabel>
                              {sede.map((u: any) => <SelectItem key={u.id} value={u.id}>🏢 {u.name} — {u.city}/{u.state}</SelectItem>)}
                            </SelectGroup>
                          )}
                          {sede.length > 0 && demais.length > 0 && <SelectSeparator />}
                          <SelectGroup>
                            <SelectLabel>Unidades</SelectLabel>
                            {demais.map((u: any) => <SelectItem key={u.id} value={u.id}>{u.name} — {u.city}/{u.state}</SelectItem>)}
                          </SelectGroup>
                        </>
                      );
                    })()}
                  </SelectContent>
                </Select>
                {duplicateActiveUnitJob && (
                  <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-foreground flex gap-2">
                    <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                    <div>
                      Já existe uma vaga <strong>{(duplicateActiveUnitJob as any).status}</strong> de{" "}
                      <strong>"{(duplicateActiveUnitJob as any).jobs?.title || "este cargo"}"</strong> na unidade{" "}
                      <strong>{(duplicateActiveUnitJob as any).units?.name || "selecionada"}</strong>. Encerre a vaga atual antes de abrir uma nova.
                    </div>
                  </div>
                )}
              </div>

              {/* Quantidade + Regime de Contratação */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>Quantidade de Posições <span className="text-destructive">*</span></Label>
                  <Input type="number" min={1} value={form.openings} onChange={(e) => setForm({ ...form, openings: e.target.value })} />
                </div>
                <div>
                  <Label>Regime de Contratação <span className="text-destructive">*</span></Label>
                  <Select value={form.contract_type} onValueChange={(v) => setForm({ ...form, contract_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CONTRACT_TYPES.map((ct) => <SelectItem key={ct.value} value={ct.value}>{ct.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Endereço */}
              <div className="space-y-3">
                <Label className="text-base font-semibold flex items-center gap-2"><MapPin className="h-4 w-4 text-primary" />Endereço</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-sm">CEP</Label>
                    <div className="relative">
                      <Input
                        value={form.address_cep}
                        maxLength={9}
                        placeholder="00000-000"
                        onChange={(e) => {
                          const formatted = formatCEP(e.target.value);
                          setForm({ ...form, address_cep: formatted });
                          if (formatted.replace(/\D/g, "").length === 8) lookupAddressCEP(formatted);
                        }}
                        className="pr-7"
                      />
                      {addressLoading && <Loader2 className="absolute right-2 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />}
                    </div>
                  </div>
                  <div>
                    <Label className="text-sm">Número</Label>
                    <Input value={form.address_number} onChange={(e) => setForm({ ...form, address_number: e.target.value })} placeholder="123" />
                  </div>
                </div>
                <div>
                  <Label className="text-sm">Rua</Label>
                  <Input value={form.address_street} onChange={(e) => setForm({ ...form, address_street: e.target.value })} placeholder="Rua / Avenida" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-sm">Bairro</Label>
                    <Input value={form.address_neighborhood} onChange={(e) => setForm({ ...form, address_neighborhood: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-sm">Complemento</Label>
                    <Input value={form.address_complement} onChange={(e) => setForm({ ...form, address_complement: e.target.value })} placeholder="Sala, andar..." />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-sm">Cidade</Label>
                    <Input value={form.address_city} onChange={(e) => setForm({ ...form, address_city: e.target.value })} />
                  </div>
                  <div>
                    <Label className="text-sm">Estado</Label>
                    <Input value={form.address_state} onChange={(e) => setForm({ ...form, address_state: e.target.value })} maxLength={2} placeholder="SP" />
                  </div>
                </div>
              </div>

              {/* Jornada de Trabalho */}
              <div>
                <Label>Jornada de Trabalho (horas/semana)</Label>
                <Input
                  type="number" min={1} max={44}
                  value={form.work_hours_weekly}
                  onChange={(e) => setForm({ ...form, work_hours_weekly: e.target.value })}
                  placeholder="Ex: 40"
                />
                {Number(form.work_hours_weekly) > 44 && (
                  <p className="text-xs text-destructive mt-1">Jornada não pode ultrapassar 44 horas semanais.</p>
                )}
              </div>

              {/* Salário / Faixa Salarial */}
              <div className="space-y-3">
                <Label className="text-base font-semibold">Salário</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-sm">Salário mínimo (R$)</Label>
                    <Input
                      type="number"
                      value={form.salary}
                      onChange={(e) => setForm({ ...form, salary: e.target.value })}
                      placeholder="Ex: 1800"
                    />
                    {form.salary && SALARY_MIN_TYPES.includes(form.contract_type) && Number(form.salary) < SALARIO_MINIMO && (
                      <p className="text-xs text-destructive mt-1">
                        Para {form.contract_type.toUpperCase()}, o valor mínimo é R$ {SALARIO_MINIMO.toLocaleString("pt-BR")}.
                      </p>
                    )}
                  </div>
                  <div>
                    <Label className="text-sm">Salário máximo (R$)</Label>
                    <Input
                      type="number"
                      value={(form as any).salary_max || ""}
                      onChange={(e) => setForm({ ...form, salary_max: e.target.value } as any)}
                      placeholder="Ex: 2500"
                    />
                    {form.salary && (form as any).salary_max && Number((form as any).salary_max) < Number(form.salary) && (
                      <p className="text-xs text-destructive mt-1">
                        Salário máximo não pode ser menor que o mínimo.
                      </p>
                    )}
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">"A combinar" se ambos estiverem em branco.</p>
              </div>

              {/* Modelo de Trabalho */}
              <div>
                <Label>Modelo de Trabalho</Label>
                <Select value={form.work_model} onValueChange={(v) => setForm({ ...form, work_model: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="presencial">Presencial</SelectItem>
                    <SelectItem value="remoto">Remoto</SelectItem>
                    <SelectItem value="hibrido">Híbrido</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Período de Candidatura */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>Início das candidaturas</Label>
                  <Input
                    type="date"
                    value={form.opens_at}
                    onChange={(e) => setForm({ ...form, opens_at: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Encerramento das candidaturas</Label>
                  <Input
                    type="date"
                    value={form.closes_at}
                    onChange={(e) => setForm({ ...form, closes_at: e.target.value })}
                  />
                  {form.opens_at && form.closes_at && form.closes_at < form.opens_at && (
                    <p className="text-xs text-destructive mt-1">A data de encerramento deve ser posterior à de início.</p>
                  )}
                </div>
              </div>

              {/* Itens herdados do Cargo (somente leitura) */}
              {(() => {
                const selectedJob: any = jobs?.find((j: any) => j.id === form.job_id);
                if (!selectedJob) return null;
                const ib: string[] = Array.isArray(selectedJob.benefits) ? selectedJob.benefits : [];
                const ir: string[] = Array.isArray(selectedJob.responsibilities) ? selectedJob.responsibilities : [];
                const iq: string[] = Array.isArray(selectedJob.requirements) ? selectedJob.requirements : [];
                const it: string[] = Array.isArray(selectedJob.discovery_traits) ? selectedJob.discovery_traits : [];
                if (!ib.length && !ir.length && !iq.length && !it.length) return null;
                return (
                  <>
                    <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground flex items-start gap-2">
                      <Lock className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span>Benefícios, Responsabilidades, Requisitos e Características são herdados do Cargo. Edite-os em /admin/cargos.</span>
                    </div>
                    {ib.length > 0 && (
                      <div>
                        <Label className="text-base font-semibold flex items-center gap-2"><Lock className="h-3.5 w-3.5 text-muted-foreground" />Benefícios herdados</Label>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {ib.map((b) => <Badge key={b} variant="outline" className="text-xs">{b}</Badge>)}
                        </div>
                      </div>
                    )}
                    {ir.length > 0 && (
                      <div>
                        <Label className="text-base font-semibold flex items-center gap-2"><Lock className="h-3.5 w-3.5 text-muted-foreground" />Responsabilidades herdadas</Label>
                        <ul className="mt-2 list-disc pl-5 space-y-1 text-sm">{ir.map((r) => <li key={r}>{r}</li>)}</ul>
                      </div>
                    )}
                    {iq.length > 0 && (
                      <div>
                        <Label className="text-base font-semibold flex items-center gap-2"><Lock className="h-3.5 w-3.5 text-muted-foreground" />Requisitos herdados</Label>
                        <ul className="mt-2 list-disc pl-5 space-y-1 text-sm">{iq.map((r) => <li key={r}>{r}</li>)}</ul>
                      </div>
                    )}
                    {it.length > 0 && (
                      <div>
                        <Label className="text-base font-semibold flex items-center gap-2"><Lock className="h-3.5 w-3.5 text-muted-foreground" />Características que combinam com esse cargo</Label>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {it.map((t) => <Badge key={t} variant="outline" className="text-xs">{traitLabel(t)}</Badge>)}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}

              {/* CEP de referência */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-primary" />
                  <Label className="text-base font-semibold">Localização de Referência</Label>
                </div>
                <p className="text-xs text-muted-foreground">CEP de referência para busca de candidatos próximos.</p>

                {/* CEP de referência + raio */}
                <div className="space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <Label className="text-sm flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />CEP de referência</Label>
                      <div className="relative mt-1">
                        <Input
                          value={filterCepRef}
                          maxLength={9}
                          placeholder="00000-000"
                          onChange={(e) => {
                            const formatted = formatCEP(e.target.value);
                            setFilterCepRef(formatted);
                            if (formatted.replace(/\D/g,"").length === 8) lookupFilterCEP(formatted);
                            else { setFilterCepRefCoords(null); setFilterCepRefLabel(null); }
                          }}
                          className="pr-7"
                        />
                        {filterCepLoading && <Loader2 className="absolute right-2 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />}
                        {!filterCepLoading && filterCepRefCoords && <MapPin className="absolute right-2 top-2.5 h-4 w-4 text-success" />}
                      </div>
                    </div>
                    <div>
                      <Label className="text-sm">Raio (km)</Label>
                      <Select value={filterRadiusKm} onValueChange={setFilterRadiusKm} disabled={!filterCepRefCoords}>
                        <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="5">5 km</SelectItem>
                          <SelectItem value="10">10 km</SelectItem>
                          <SelectItem value="20">20 km</SelectItem>
                          <SelectItem value="30">30 km</SelectItem>
                          <SelectItem value="50">50 km</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {filterCepRefLabel && !filterCepLoading && (
                    <div className={`flex items-center gap-1.5 text-xs rounded px-2 py-1 ${
                      filterCepRefCoords ? "text-success bg-success/10" : "text-warning bg-warning/10"
                    }`}>
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span>{filterCepRefLabel}</span>
                    </div>
                  )}
                </div>
              </div>

              <Button
                onClick={handleCreate}
                className="w-full"
                disabled={createUnitJob.isPending || !!duplicateActiveUnitJob}
                title={duplicateActiveUnitJob ? "Já existe uma vaga ativa para este cargo nessa unidade" : undefined}
              >
                {createUnitJob.isPending ? "Criando vaga..." : duplicateActiveUnitJob ? "Vaga já existe nesta unidade" : "Criar Vaga"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        )}
        {((isFranchisee && !isCentral) || isAdmFranquia) && (
          <Button className="whitespace-nowrap" onClick={() => setRequestDialogOpen(true)}>
            <FileText className="h-4 w-4 mr-2 shrink-0" />Solicitar Vaga
          </Button>
        )}
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        <MetricCard icon={Briefcase} label="Vagas Ativas" value={metrics?.activeJobs ?? 0} />
        <MetricCard icon={Users} label="Total Candidatos" value={metrics?.totalCandidates ?? 0} />
        <MetricCard icon={TrendingUp} label="Taxa de Conversão" value={`${metrics?.conversionRate ?? 0}%`} />
        <MetricCard icon={Award} label="Score Médio" value={metrics?.avgScore ?? 0} />
        <MetricCard icon={UserX} label="Taxa Reprovação" value={`${extendedMetrics?.rejectionRate ?? 0}%`} />
        <MetricCard icon={Timer} label="Tempo Médio" value={`${extendedMetrics?.avgAdvanceTimeHours ?? 0}h`} sub="avanço" />
      </div>

      {/* View Mode Toggle */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant={viewMode === "vagas" ? "default" : "outline"} size="sm" onClick={() => setViewMode("vagas")} className="text-xs">
          <Briefcase className="h-3.5 w-3.5 mr-1" />Vagas
        </Button>
        <Button variant={viewMode === "solicitacoes" ? "default" : "outline"} size="sm" onClick={() => setViewMode("solicitacoes")} className="text-xs">
          <FileText className="h-3.5 w-3.5 mr-1" />Solicitações
          {(jobRequests?.filter((r) => r.status === "pendente").length ?? 0) > 0 && (
            <Badge variant="secondary" className="ml-1.5 h-5 min-w-[1.25rem] px-1 text-[10px]">
              {jobRequests?.filter((r) => r.status === "pendente").length}
            </Badge>
          )}
        </Button>
        <Button variant="outline" size="sm" onClick={() => navigate("/admin/banco-de-talentos")} className="text-xs">
          <Users className="h-3.5 w-3.5 mr-1" />Banco de Talentos
        </Button>
        <Button variant={viewMode === "relatorios" ? "default" : "outline"} size="sm" onClick={() => setViewMode("relatorios")} className="text-xs">
          <BarChart3 className="h-3.5 w-3.5 mr-1" />Relatórios
        </Button>
      </div>

      {/* Filters */}
      {viewMode === "vagas" && (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterJob} onValueChange={setFilterJob}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Cargo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os cargos</SelectItem>
            {jobs?.map((j) => <SelectItem key={j.id} value={j.id}>{j.title}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterUnit} onValueChange={setFilterUnit}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Unidade" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as unidades</SelectItem>
            {(() => {
              const sede = filterUnits?.filter((u: any) => u.is_franqueadora) || [];
              const demais = filterUnits?.filter((u: any) => !u.is_franqueadora) || [];
              return (
                <>
                  {sede.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Sede</SelectLabel>
                      {sede.map((u: any) => (
                        <SelectItem key={u.id} value={u.id}>🏢 {u.name} — {u.city}/{u.state}</SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  {sede.length > 0 && demais.length > 0 && <SelectSeparator />}
                  <SelectGroup>
                    <SelectLabel>Unidades</SelectLabel>
                    {demais.map((u: any) => (
                      <SelectItem key={u.id} value={u.id}>{u.name} — {u.city}/{u.state}</SelectItem>
                    ))}
                  </SelectGroup>
                </>
              );
            })()}
          </SelectContent>
        </Select>
      </div>
      )}

      {viewMode === "vagas" && isFranchisee && (
        <CorporateCatalogForFranchisee />
      )}

      {viewMode === "vagas" && (isLoading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>
      ) : (
        <div className="space-y-3">
          {visibleUnitJobs.map((uj: any) => {
            const benefits = Array.isArray(uj.jobs?.benefits) ? uj.jobs.benefits : [];
            const counts = appCounts?.[uj.id];
            const workModel = uj.work_model || "presencial";
            const openings = uj.openings || 1;
            return (
              <div key={uj.id} className="space-y-0">
                <Card>
                  <CardContent className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-foreground">{uj.jobs?.title}</h3>
                        <Badge variant="outline" className="text-[10px]">{WORK_MODEL_LABELS[workModel] || workModel}</Badge>
                        {uj.contract_type && <Badge variant="outline" className="text-[10px]">{CONTRACT_TYPES.find(c => c.value === uj.contract_type)?.label || uj.contract_type}</Badge>}
                        {openings > 1 && <Badge variant="secondary" className="text-[10px]">{openings} vagas</Badge>}
                        {uj.opens_at && <Badge variant="outline" className="text-[10px] gap-1"><CalendarDays className="h-3 w-3" />{formatDateBR(uj.opens_at)}</Badge>}
                        {uj.closes_at && <Badge variant="outline" className="text-[10px] gap-1">até {formatDateBR(uj.closes_at)}</Badge>}
                        {uj.jobs?.is_active === false && (
                          <Badge variant="destructive" className="text-[10px] gap-1"><AlertTriangle className="h-3 w-3" />Cargo inativo</Badge>
                        )}
                        {!jobHasSpecificTest(uj.job_id, testsData) && !testsData?.hasGlobalTemplate && (
                          <Link to="/admin/testes">
                            <Badge variant="destructive" className="text-[10px] gap-1 cursor-pointer"><AlertTriangle className="h-3 w-3" />Sem teste — invisível para candidatos</Badge>
                          </Link>
                        )}
                        {!jobHasSpecificTest(uj.job_id, testsData) && testsData?.hasGlobalTemplate && (
                          <Link to="/admin/testes">
                            <Badge className="text-[10px] gap-1 bg-amber-500/15 text-amber-700 border-amber-300 cursor-pointer hover:bg-amber-500/20"><AlertTriangle className="h-3 w-3" />Sem teste próprio — usando template global</Badge>
                          </Link>
                        )}
                        <Link to="/admin/cargos" className="inline-flex items-center gap-0.5 text-[10px] text-primary hover:underline" title="Ver cargo">
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      </div>
                      <p className="text-sm text-muted-foreground">{uj.units?.name} — {uj.units?.city}/{uj.units?.state}</p>
                      <div className="flex items-center gap-3 flex-wrap">
                        {(uj.salary || uj.salary_min) && (
                          <span className="text-sm font-medium text-primary">
                            R$ {Number(uj.salary || uj.salary_min).toLocaleString("pt-BR")}
                            {uj.salary_max ? ` – R$ ${Number(uj.salary_max).toLocaleString("pt-BR")}` : ""}
                          </span>
                        )}
                        {counts && <span className="text-xs text-muted-foreground">{counts.total} candidato{counts.total !== 1 ? "s" : ""}</span>}
                        {(() => {
                          const hired = counts?.byStatus?.contratado || 0;
                          return hired > 0 || openings > 1 ? (
                            <Badge variant="outline" className={`text-[10px] ${hired >= openings ? "bg-primary/10 text-primary" : ""}`}>
                              {hired}/{openings} contratado{hired !== 1 ? "s" : ""}
                            </Badge>
                          ) : null;
                        })()}
                      </div>
                      {benefits.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {benefits.slice(0, 5).map((b: string, i: number) => (
                            <Badge key={i} variant="outline" className="text-[10px]">{b}</Badge>
                          ))}
                          {benefits.length > 5 && <Badge variant="outline" className="text-[10px]">+{benefits.length - 5}</Badge>}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {canViewCandidates(uj) && (
                      <Button variant="outline" size="sm" onClick={() => {
                        if (counts?.total) {
                          const updated = { ...viewedJobs, [uj.id]: counts.total };
                          setViewedJobs(updated);
                          localStorage.setItem("viewedJobs", JSON.stringify(updated));
                        }
                        navigate(`/admin/vagas/${uj.id}/candidatos`);
                      }} className="text-xs">
                        <Eye className="h-3.5 w-3.5 mr-1" /> Candidatos
                        <Badge
                          variant={counts?.total > 0 && counts.total !== viewedJobs[uj.id] ? "default" : "secondary"}
                          className="ml-1.5 h-5 w-5 min-w-5 px-0 py-0 text-[10px] font-semibold inline-flex items-center justify-center leading-none tabular-nums rounded-full"
                        >
                          {counts?.total ?? 0}
                        </Badge>
                      </Button>
                      )}
                      {canViewCandidates(uj) && counts?.total > 0 && kanbanEnabledSetting && (
                        <Button
                          variant={kanbanJobId === uj.id ? "default" : "outline"}
                          size="sm"
                          className="text-xs"
                          onClick={() => setKanbanJobId(kanbanJobId === uj.id ? null : uj.id)}
                        >
                          <LayoutGrid className="h-3.5 w-3.5 mr-1" /> Kanban
                        </Button>
                      )}
                      {/* Status da vaga: um único controle. Quem pode editar usa um seletor
                          colorido que INDICA e ALTERA o status (inclui Encerrar via
                          "Encerrada" → mesmo fluxo de aviso). Quem não edita vê só o selo. */}
                      {canEditJob(uj) ? (
                        <Select value={uj.status} onValueChange={(v) => requestStatusChange(uj, v)}>
                          <SelectTrigger className={`w-full sm:w-36 h-8 text-xs font-medium border-0 gap-1.5 ${STATUS_COLORS[uj.status] || ""}`}>
                            {STATUS_ICONS[uj.status] && (() => { const Icon = STATUS_ICONS[uj.status]; return <Icon className="h-3.5 w-3.5 shrink-0" />; })()}
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>{Object.entries(STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                        </Select>
                      ) : (
                        <Badge className={`${STATUS_COLORS[uj.status] || ""} gap-1`}>
                          {STATUS_ICONS[uj.status] && (() => { const Icon = STATUS_ICONS[uj.status]; return <Icon className="h-3 w-3" />; })()}
                          {STATUS_LABELS[uj.status] || uj.status}
                        </Badge>
                      )}
                      {canEditJob(uj) && (
                      <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        title={counts?.total > 0 ? "Vaga com candidatos — somente quantidade de posições pode ser alterada" : "Editar vaga"}
                        onClick={() => openEditDialog(uj, (counts?.total ?? 0) > 0)}
                      >
                        <Pencil className="h-3.5 w-3.5 mr-1" /> Editar
                      </Button>
                      {uj.status === "aberta" && uj.job_id && uj.unit_id && (
                        <RecruitmentLinksDialog
                          jobId={uj.job_id}
                          unitId={uj.unit_id}
                          unitJobId={uj.id}
                          jobTitle={uj.jobs?.title || "Vaga"}
                          unitName={uj.units?.name || "Unidade"}
                        />
                      )}
                      {(uj.status === "encerrada" || uj.status === "preenchida") && (
                        <Button variant="outline" size="sm" className="text-xs" onClick={() => exportJobReport(uj.id, uj.jobs?.title || "vaga")}>
                          <Download className="h-3.5 w-3.5 mr-1" /> Relatório
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" onClick={() => handleDeleteUnitJob(uj)} title={uj.status === "aberta" && (counts?.total || 0) > 0 ? "Encerre a vaga antes de excluir" : "Excluir vaga"} className="text-destructive hover:text-destructive h-8 w-8">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                      </>
                      )}
                    </div>
                  </CardContent>
                </Card>
                {kanbanJobId === uj.id && (
                  <div className="mt-2 mb-4">
                    <CorporateKanban unitJobId={uj.id} kanbanEnabled={kanbanEnabledSetting} />
                  </div>
                )}
              </div>
            );
          })}
          {unitJobs?.length === 0 && <p className="text-center text-muted-foreground py-8">Nenhuma vaga corporativa encontrada.</p>}
          {(unitJobs?.length ?? 0) > 0 && (
            <div className="flex flex-col items-center justify-center gap-2 pt-2">
              <p className="text-xs text-muted-foreground">
                Mostrando <span className="font-medium text-foreground">{visibleUnitJobs.length}</span> de{" "}
                <span className="font-medium text-foreground">{unitJobs?.length ?? 0}</span> vaga(s)
              </p>
              {hasMoreUnitJobs && (
                <>
                  <div ref={jobsSentinelRef} aria-hidden className="h-1 w-full" />
                  <p className="text-xs text-muted-foreground flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin" /> Carregando mais…
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      ))}

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setDeleteBlocked(null); setNeedsCloseFirst(false); setDeleteConfirmText(""); setDeleteAcknowledged(false); } }}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {deleteBlocked ? (
                <>Exclusão bloqueada</>
              ) : needsCloseFirst ? (
                <>Encerre a vaga antes de excluir</>
              ) : (deleteImpact?.applications || 0) > 0 ? (
                <><AlertTriangle className="h-5 w-5 text-destructive" /> Atenção: exclusão definitiva</>
              ) : (
                <>Excluir vaga</>
              )}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {deleteBlocked ? (
                  <span className="text-destructive">{deleteBlocked}</span>
                ) : needsCloseFirst ? (
                  <span>
                    A vaga <strong>"{deleteTarget?.jobs?.title}"</strong> ainda está aberta com candidatos ativos. Para excluir é preciso encerrá-la primeiro — os candidatos serão notificados e movidos para standby. Em seguida você verá o resumo do que será apagado.
                  </span>
                ) : (deleteImpact?.applications || 0) > 0 ? (
                  <>
                    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-foreground">
                      <p className="mb-2">
                        Esta vaga já teve candidatos. Ao excluir <strong>"{deleteTarget?.jobs?.title}"</strong>, <strong>todos os dados e processos vinculados serão apagados em definitivo</strong> e não poderão ser recuperados.
                      </p>
                      <ul className="list-disc pl-5 space-y-0.5 text-xs">
                        <li>{deleteImpact?.applications || 0} candidatura(s) ({deleteImpact?.candidates || 0} candidato(s))</li>
                        <li>{deleteImpact?.step_responses || 0} resposta(s) de etapa</li>
                        <li>{deleteImpact?.test_assignments || 0} execução(ões) de teste</li>
                        <li>{deleteImpact?.interviews || 0} entrevista(s) (incluindo agendadas)</li>
                        <li>{deleteImpact?.document_requests || 0} solicitação(ões) de documento</li>
                        <li>{deleteImpact?.ai_evaluations || 0} avaliação(ões) de IA</li>
                        <li>Logs de progresso e decisão dos candidatos</li>
                      </ul>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Preservados: notificações já entregues e logs de auditoria/migração.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Para confirmar, digite <strong>CONFIRMAR</strong></Label>
                      <Input
                        value={deleteConfirmText}
                        onChange={(e) => setDeleteConfirmText(e.target.value)}
                        placeholder="CONFIRMAR"
                        autoFocus
                      />
                      <label className="flex items-start gap-2 text-xs cursor-pointer">
                        <Checkbox
                          checked={deleteAcknowledged}
                          onCheckedChange={(v) => setDeleteAcknowledged(!!v)}
                          className="mt-0.5"
                        />
                        <span>Entendo que esta ação é irreversível e apagará todos os dados dos candidatos desta vaga.</span>
                      </label>
                    </div>
                  </>
                ) : (
                  <span>Tem certeza que deseja excluir a vaga <strong>"{deleteTarget?.jobs?.title}"</strong>? Esta ação é irreversível.</span>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={closingForDelete || deleteUnitJob.isPending}>Cancelar</AlertDialogCancel>
            {!deleteBlocked && !needsCloseFirst && (deleteImpact?.applications || 0) > 0 && (
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); confirmDeleteUnitJob(); }}
                disabled={
                  deleteUnitJob.isPending ||
                  deleteConfirmText.trim().toUpperCase() !== "CONFIRMAR" ||
                  !deleteAcknowledged
                }
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleteUnitJob.isPending ? "Excluindo..." : "Excluir tudo"}
              </AlertDialogAction>
            )}
            {!deleteBlocked && !needsCloseFirst && (deleteImpact?.applications || 0) === 0 && (
              <AlertDialogAction onClick={confirmDeleteUnitJob} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Excluir
              </AlertDialogAction>
            )}
            {needsCloseFirst && (
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); handleCloseAndDelete(); }}
                disabled={closingForDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {closingForDelete ? "Encerrando..." : "Encerrar vaga"}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Close Job Confirmation */}
      <AlertDialog open={!!closeTarget} onOpenChange={(open) => { if (!open) setCloseTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Encerrar vaga</AlertDialogTitle>
            <AlertDialogDescription>
              Ao encerrar a vaga <strong>"{closeTarget?.jobs?.title}"</strong>, todos os candidatos ativos serão notificados e suas candidaturas encerradas. Eles poderão se manter no Banco de Talentos para futuras oportunidades.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-warning text-warning-foreground hover:bg-warning/90"
              onClick={async () => {
                if (!closeTarget) return;
                try {
                  const result = await closeJob.mutateAsync(closeTarget.id);
                  toast.success(`Vaga encerrada. ${result.notified} candidato(s) notificado(s).`);
                } catch (e: any) {
                  toast.error(e.message);
                }
                setCloseTarget(null);
              }}
            >
              Encerrar Vaga
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Mark as Filled Confirmation */}
      <AlertDialog open={!!fillTarget} onOpenChange={(open) => { if (!open) setFillTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Marcar vaga como preenchida</AlertDialogTitle>
            <AlertDialogDescription>
              Ao marcar <strong>"{fillTarget?.jobs?.title}"</strong> como <strong>preenchida</strong>, ela sai de divulgação e entra em estado terminal. Candidaturas em andamento <strong>não</strong> serão automaticamente notificadas — para isso use a opção <strong>Encerrar</strong>. Use esta opção apenas quando todas as posições já foram efetivamente contratadas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={async () => {
                if (!fillTarget) return;
                try {
                  await changeStatus(fillTarget.id, "preenchida");
                } catch (e: any) {
                  toast.error(e.message);
                }
                setFillTarget(null);
              }}
            >
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={editDialogOpen} onOpenChange={(open) => { if (!open) { setEditDialogOpen(false); setEditTarget(null); setEditLocked(false); } }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Editar Vaga</DialogTitle></DialogHeader>
          {editTarget && (
          <div className="space-y-5">
            {editLocked && (
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning-foreground flex items-start gap-2">
                <Lock className="h-3.5 w-3.5 mt-0.5 shrink-0 text-warning" />
                <span>
                  Esta vaga já possui candidatos no processo. Apenas a <strong>Quantidade de Posições</strong>
                  {canOverride.canEdit ? " e as marcações herdadas autorizadas" : ""} pode ser alterada.
                  <strong> Os demais dados permanecem como estão</strong> — nenhum campo será apagado ao salvar.
                </span>
              </div>
            )}

            {/* Cargo + Unidade (readonly) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-sm text-muted-foreground">Cargo</Label>
                <p className="text-sm font-medium text-foreground">{editTarget.jobs?.title}</p>
              </div>
              <div>
                <Label className="text-sm text-muted-foreground">Unidade</Label>
                <p className="text-sm font-medium text-foreground">{editTarget.units?.name} — {editTarget.units?.city}/{editTarget.units?.state}</p>
              </div>
            </div>

            {/* Quantidade (sempre editável) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Quantidade de Posições</Label>
                <Input type="number" min={1} value={editForm.openings} onChange={(e) => setEditForm({ ...editForm, openings: e.target.value })} />
              </div>
              <div>
                <Label>Regime de Contratação</Label>
                <Select value={editForm.contract_type} onValueChange={(v) => setEditForm({ ...editForm, contract_type: v })} disabled={editLocked}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CONTRACT_TYPES.map((ct) => <SelectItem key={ct.value} value={ct.value}>{ct.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            <fieldset disabled={editLocked} className="contents">

            {/* Endereço */}
            <div className="space-y-3">
              <Label className="text-base font-semibold flex items-center gap-2"><MapPin className="h-4 w-4 text-primary" />Endereço</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm">CEP</Label>
                  <div className="relative">
                    <Input
                      value={editForm.address_cep}
                      maxLength={9}
                      placeholder="00000-000"
                      onChange={(e) => {
                        const formatted = formatCEP(e.target.value);
                        setEditForm({ ...editForm, address_cep: formatted });
                        if (formatted.replace(/\D/g, "").length === 8) lookupEditAddressCEP(formatted);
                      }}
                      className="pr-7"
                    />
                    {editAddressLoading && <Loader2 className="absolute right-2 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />}
                  </div>
                </div>
                <div>
                  <Label className="text-sm">Número</Label>
                  <Input value={editForm.address_number} onChange={(e) => setEditForm({ ...editForm, address_number: e.target.value })} placeholder="123" />
                </div>
              </div>
              <div>
                <Label className="text-sm">Rua</Label>
                <Input value={editForm.address_street} onChange={(e) => setEditForm({ ...editForm, address_street: e.target.value })} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm">Bairro</Label>
                  <Input value={editForm.address_neighborhood} onChange={(e) => setEditForm({ ...editForm, address_neighborhood: e.target.value })} />
                </div>
                <div>
                  <Label className="text-sm">Complemento</Label>
                  <Input value={editForm.address_complement} onChange={(e) => setEditForm({ ...editForm, address_complement: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm">Cidade</Label>
                  <Input value={editForm.address_city} onChange={(e) => setEditForm({ ...editForm, address_city: e.target.value })} />
                </div>
                <div>
                  <Label className="text-sm">Estado</Label>
                  <Input value={editForm.address_state} onChange={(e) => setEditForm({ ...editForm, address_state: e.target.value })} maxLength={2} />
                </div>
              </div>
            </div>

            {/* Jornada */}
            <div>
              <Label>Jornada de Trabalho (horas/semana)</Label>
              <Input type="number" min={1} max={44} value={editForm.work_hours_weekly} onChange={(e) => setEditForm({ ...editForm, work_hours_weekly: e.target.value })} placeholder="Ex: 40" />
              {Number(editForm.work_hours_weekly) > 44 && <p className="text-xs text-destructive mt-1">Jornada não pode ultrapassar 44 horas semanais.</p>}
            </div>

            {/* Salário */}
            <div className="space-y-3">
              <Label className="text-base font-semibold">Salário</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm">Salário mínimo (R$)</Label>
                  <Input type="number" value={editForm.salary} onChange={(e) => setEditForm({ ...editForm, salary: e.target.value })} placeholder="Ex: 1800" />
                  {editForm.salary && SALARY_MIN_TYPES.includes(editForm.contract_type) && Number(editForm.salary) < SALARIO_MINIMO && (
                    <p className="text-xs text-destructive mt-1">Para {editForm.contract_type.toUpperCase()}, o valor mínimo é R$ {SALARIO_MINIMO.toLocaleString("pt-BR")}.</p>
                  )}
                </div>
                <div>
                  <Label className="text-sm">Salário máximo (R$)</Label>
                  <Input type="number" value={editForm.salary_max || ""} onChange={(e) => setEditForm({ ...editForm, salary_max: e.target.value })} placeholder="Ex: 2500" />
                  {editForm.salary && editForm.salary_max && Number(editForm.salary_max) < Number(editForm.salary) && (
                    <p className="text-xs text-destructive mt-1">Salário máximo não pode ser menor que o mínimo.</p>
                  )}
                </div>
              </div>
            </div>

            {/* Modelo de Trabalho */}
            <div>
              <Label>Modelo de Trabalho</Label>
              {isCentral ? (
                <Select value={editForm.work_model} onValueChange={(v) => setEditForm({ ...editForm, work_model: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="presencial">Presencial</SelectItem>
                    <SelectItem value="remoto">Remoto</SelectItem>
                    <SelectItem value="hibrido">Híbrido</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <div className="flex h-10 w-full items-center rounded-md border border-input bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                  {WORK_MODEL_LABELS[editForm.work_model as keyof typeof WORK_MODEL_LABELS] || "Presencial"}
                </div>
              )}
            </div>


            {/* Período */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Início das candidaturas</Label>
                <Input type="date" value={editForm.opens_at} onChange={(e) => setEditForm({ ...editForm, opens_at: e.target.value })} />
              </div>
              <div>
                <Label>Encerramento das candidaturas</Label>
                <Input type="date" value={editForm.closes_at} onChange={(e) => setEditForm({ ...editForm, closes_at: e.target.value })} />
              </div>
            </div>

            </fieldset>

            {/* Itens herdados do Cargo — checkboxes quando override estiver habilitado */}
            {(() => {
              const ib: string[] = Array.isArray(editTarget?.jobs?.benefits) ? editTarget.jobs.benefits : [];
              const ir: string[] = Array.isArray(editTarget?.jobs?.responsibilities) ? editTarget.jobs.responsibilities : [];
              const iq: string[] = Array.isArray(editTarget?.jobs?.requirements) ? editTarget.jobs.requirements : [];
              const it: string[] = Array.isArray(editTarget?.jobs?.discovery_traits) ? editTarget.jobs.discovery_traits : [];
              if (!ib.length && !ir.length && !iq.length && !it.length) return null;
              return (
                <>
                  <UnitJobInheritedBanner reason={canOverride.reason} />
                  <UnitJobInheritedSelector
                    title="Benefícios"
                    inherited={ib}
                    selected={editBenefits}
                    canEdit={canOverride.canEdit}
                    onChange={setEditBenefits}
                    icon="badge"
                  />
                  <UnitJobInheritedSelector
                    title="Responsabilidades"
                    inherited={ir}
                    selected={editResponsibilities}
                    canEdit={canOverride.canEdit}
                    onChange={setEditResponsibilities}
                    icon="list"
                  />
                  <UnitJobInheritedSelector
                    title="Requisitos"
                    inherited={iq}
                    selected={editRequirements}
                    canEdit={canOverride.canEdit}
                    onChange={setEditRequirements}
                    icon="list"
                  />
                  {it.length > 0 && (
                    <div>
                      <Label className="text-base font-semibold flex items-center gap-2"><Lock className="h-3.5 w-3.5 text-muted-foreground" />Características que combinam com esse cargo</Label>
                      <div className="mt-2 flex flex-wrap gap-1.5">{it.map((t) => <Badge key={t} variant="outline" className="text-xs">{traitLabel(t)}</Badge>)}</div>
                    </div>
                  )}
                </>
              );
            })()}

            {/* CEP de referência */}
            <fieldset disabled={editLocked} className="contents">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-primary" />
                <Label className="text-base font-semibold">Localização de Referência</Label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />CEP de referência</Label>
                  <div className="relative mt-1">
                    <Input
                      value={editFilterCepRef}
                      maxLength={9}
                      placeholder="00000-000"
                      onChange={(e) => {
                        const formatted = formatCEP(e.target.value);
                        setEditFilterCepRef(formatted);
                        if (formatted.replace(/\D/g, "").length === 8) lookupEditFilterCEP(formatted);
                        else { setEditFilterCepRefCoords(null); setEditFilterCepRefLabel(null); }
                      }}
                      className="pr-7"
                    />
                    {editFilterCepLoading && <Loader2 className="absolute right-2 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />}
                    {!editFilterCepLoading && editFilterCepRefCoords && <MapPin className="absolute right-2 top-2.5 h-4 w-4 text-success" />}
                  </div>
                </div>
                <div>
                  <Label className="text-sm">Raio (km)</Label>
                  <Select value={editFilterRadiusKm} onValueChange={setEditFilterRadiusKm} disabled={!editFilterCepRefCoords}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="5">5 km</SelectItem>
                      <SelectItem value="10">10 km</SelectItem>
                      <SelectItem value="20">20 km</SelectItem>
                      <SelectItem value="30">30 km</SelectItem>
                      <SelectItem value="50">50 km</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {editFilterCepRefLabel && !editFilterCepLoading && (
                <div className={`flex items-center gap-1.5 text-xs rounded px-2 py-1 ${editFilterCepRefCoords ? "text-success bg-success/10" : "text-warning bg-warning/10"}`}>
                  <MapPin className="h-3 w-3 shrink-0" />
                  <span>{editFilterCepRefLabel}</span>
                </div>
              )}
            </div>
            </fieldset>

            <Button onClick={handleEditSave} className="w-full" disabled={updateUnitJob.isPending}>
              {updateUnitJob.isPending ? "Salvando..." : editLocked ? "Salvar Quantidade" : "Salvar Alterações"}
            </Button>
          </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Job Requests Panel ── */}
      {viewMode === "solicitacoes" ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-foreground">Solicitações de Vagas</h3>
            {isCentral && (
              <Badge variant="secondary">
                {jobRequests?.filter((r) => r.status === "pendente").length ?? 0} pendente(s)
              </Badge>
            )}
          </div>

          {/* Request Filters */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select value={filterRequestStatus} onValueChange={setFilterRequestStatus}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                <SelectItem value="pendente">Pendente</SelectItem>
                <SelectItem value="em_analise">Em Análise</SelectItem>
                <SelectItem value="aprovada">Aprovada</SelectItem>
                <SelectItem value="reprovada">Não Aprovada</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterRequestUnit} onValueChange={setFilterRequestUnit}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Unidade" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as unidades</SelectItem>
                {(() => {
                  const sede = filterUnits?.filter((u: any) => u.is_franqueadora) || [];
                  const demais = filterUnits?.filter((u: any) => !u.is_franqueadora) || [];
                  return (
                    <>
                      {sede.length > 0 && (
                        <SelectGroup>
                          <SelectLabel>Sede</SelectLabel>
                          {sede.map((u: any) => (
                            <SelectItem key={u.id} value={u.id}>🏢 {u.name} — {u.city}/{u.state}</SelectItem>
                          ))}
                        </SelectGroup>
                      )}
                      {sede.length > 0 && demais.length > 0 && <SelectSeparator />}
                      <SelectGroup>
                        <SelectLabel>Unidades</SelectLabel>
                        {demais.map((u: any) => (
                          <SelectItem key={u.id} value={u.id}>{u.name} — {u.city}/{u.state}</SelectItem>
                        ))}
                      </SelectGroup>
                    </>
                  );
                })()}
              </SelectContent>
            </Select>
          </div>

          {(jobRequests?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Nenhuma solicitação encontrada.</p>
          ) : (
            jobRequests?.map((req) => {
            const statusConfig: Record<string, { color: string; icon: React.ElementType; label: string }> = {
              pendente: { color: "bg-warning/10 border-warning/30 text-warning", icon: Clock, label: "Pendente" },
              em_analise: { color: "bg-blue-500/10 border-blue-500/30 text-blue-600", icon: SearchIcon, label: "Em Análise" },
              aprovada: { color: "bg-success/10 border-success/30 text-success", icon: CheckCircle, label: "Aprovada" },
              reprovada: { color: "bg-yellow-500/10 border-yellow-500/30 text-yellow-700", icon: Clock, label: "Não Aprovada" },
            };
            const sc = statusConfig[req.status] || statusConfig.pendente;
            const StatusIcon = sc.icon;
            return (
              <Card key={req.id} className={`border ${req.status === "pendente" ? "border-warning/30" : req.status === "em_analise" ? "border-blue-500/30" : req.status === "aprovada" ? "border-success/30" : "border-destructive/30"}`}>
                <CardContent className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-semibold text-foreground">{req.title}</h4>
                      <Badge className={sc.color}>
                        <StatusIcon className="h-3 w-3 mr-1" />{sc.label}
                      </Badge>
                    </div>
                    {req.description && <p className="text-sm text-muted-foreground line-clamp-2">{req.description}</p>}
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      {req.unit && <span>{req.unit.name} — {req.unit.city}/{req.unit.state}</span>}
                      {req.salary && <span>R$ {Number(req.salary).toLocaleString("pt-BR")}</span>}
                      <span>{req.openings} vaga(s)</span>
                      <span>{new Date(req.created_at).toLocaleDateString("pt-BR")}</span>
                    </div>
                    {req.requester && <p className="text-xs text-muted-foreground">Solicitado por: {req.requester.full_name}</p>}
                    {req.review_note && <p className="text-xs text-muted-foreground italic">Nota: {req.review_note}</p>}
                  </div>
                  {isCentral && (req.status === "pendente" || req.status === "em_analise") && (
                    <div className="flex items-center gap-2 shrink-0">
                      {req.status === "pendente" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs text-blue-600"
                          onClick={() => reviewJobRequest.mutate({ id: req.id, status: "em_analise" })}
                        >
                          <SearchIcon className="h-3.5 w-3.5 mr-1" />Analisar
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs text-success"
                        onClick={() => { setReviewTarget(req); setReviewNote(""); setReviewDialogOpen(true); }}
                      >
                        <CheckCircle className="h-3.5 w-3.5 mr-1" />Aprovar
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs text-destructive"
                        onClick={() => { setReviewTarget({ ...req, status: "reprovada" } as any); setReviewNote(""); setReviewDialogOpen(true); }}
                      >
                        <XCircle className="h-3.5 w-3.5 mr-1" />Não Aprovar
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )})
          )}
        </div>
      ) : null}

      {/* Banco de Talentos Tab */}
      {viewMode === "talentos" && (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-6 text-center space-y-3">
              <Users className="h-10 w-10 text-primary mx-auto" />
              <h3 className="text-lg font-semibold text-foreground">Banco de Talentos Corporativo</h3>
              <p className="text-sm text-muted-foreground">
                Acesse o banco de talentos unificado para visualizar candidatos disponíveis para vagas corporativas.
              </p>
              <Button onClick={() => navigate("/admin/banco-de-talentos")}>
                <Users className="h-4 w-4 mr-2" />Acessar Banco de Talentos
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Relatórios Tab */}
      {viewMode === "relatorios" && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-foreground">Relatórios de Vagas Corporativas</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
            <MetricCard icon={Briefcase} label="Vagas Ativas" value={metrics?.activeJobs ?? 0} />
            <MetricCard icon={Users} label="Total Candidatos" value={metrics?.totalCandidates ?? 0} />
            <MetricCard icon={TrendingUp} label="Conversão" value={`${metrics?.conversionRate ?? 0}%`} />
            <MetricCard icon={Award} label="Score Médio" value={metrics?.avgScore ?? 0} />
            <MetricCard icon={UserX} label="Reprovação" value={`${extendedMetrics?.rejectionRate ?? 0}%`} />
            <MetricCard icon={Timer} label="Tempo Médio" value={`${extendedMetrics?.avgAdvanceTimeHours ?? 0}h`} sub="avanço" />
          </div>

          {/* Conversion by status breakdown */}
          {extendedMetrics?.conversionByStatus && Object.keys(extendedMetrics.conversionByStatus).length > 0 && (
            <Card>
              <CardContent className="p-4 space-y-3">
                <h4 className="text-sm font-semibold text-foreground">Distribuição por Status</h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {Object.entries(extendedMetrics.conversionByStatus).map(([status, count]) => (
                    <div key={status} className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2">
                      <span className="text-xs text-muted-foreground capitalize">{status.replace(/_/g, " ")}</span>
                      <Badge variant="secondary" className="text-xs">{count as number}</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Export all reports */}
          <Card>
            <CardContent className="p-4 space-y-3">
              <h4 className="text-sm font-semibold text-foreground">Exportar Relatórios</h4>
              <p className="text-xs text-muted-foreground">Exporte relatórios individuais por vaga na aba "Vagas" usando o botão "Relatório" em vagas encerradas ou preenchidas.</p>
              {unitJobs && unitJobs.filter((uj: any) => uj.status === "encerrada" || uj.status === "preenchida").length > 0 && (
                <div className="space-y-1.5">
                  {unitJobs.filter((uj: any) => uj.status === "encerrada" || uj.status === "preenchida").map((uj: any) => (
                    <Button key={uj.id} variant="outline" size="sm" className="text-xs mr-2" onClick={() => exportJobReport(uj.id, uj.jobs?.title || "vaga")}>
                      <Download className="h-3.5 w-3.5 mr-1" />{uj.jobs?.title}
                    </Button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Request Dialog (Franchisee) ── */}
      <Dialog open={requestDialogOpen} onOpenChange={setRequestDialogOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Solicitar Vaga</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Cargo</Label>
              <Select
                value={requestForm.title}
                onValueChange={(v) => {
                  setRequestForm({ ...requestForm, title: v });
                  setRequestBenefits(null);
                }}
              >
                <SelectTrigger><SelectValue placeholder="Selecione um cargo existente" /></SelectTrigger>
                <SelectContent>
                  {jobs?.map((j) => (
                    <SelectItem key={j.id} value={j.title}>{j.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Unidade</Label>
              {(() => {
                const requestUnitOptions: any[] = isAdmFranquia ? (allUnits || []) : myUnitList;
                const isLoadingOptions = isAdmFranquia ? !allUnits : myUnitLoading;
                if (isLoadingOptions) {
                  return <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">Carregando unidade...</div>;
                }
                if (requestUnitOptions.length === 0) {
                  return <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">Nenhuma unidade disponível.</div>;
                }
                return (
                  <Select value={selectedRequestUnit} onValueChange={setSelectedRequestUnit}>
                    <SelectTrigger><SelectValue placeholder="Selecionar unidade" /></SelectTrigger>
                    <SelectContent>
                      {requestUnitOptions.map((u: any) => (
                        <SelectItem key={u.id} value={u.id}>{u.name} — {u.city}/{u.state}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                );
              })()}
            </div>
            <div>
              <Label>Descrição / Justificativa</Label>
              <Textarea
                value={requestForm.description}
                onChange={(e) => setRequestForm({ ...requestForm, description: e.target.value })}
                placeholder="Descreva o motivo da solicitação e detalhes da vaga..."
                rows={4}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Salário</Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  value={requestForm.salary}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/[^\d]/g, "");
                    setRequestForm({ ...requestForm, salary: digits });
                  }}
                  placeholder="Ex: 1800"
                />
              </div>
              <div>
                <Label>Qtd. de Vagas</Label>
                <Input
                  type="number"
                  min={1}
                  value={requestForm.openings}
                  onChange={(e) => setRequestForm({ ...requestForm, openings: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label>Modelo de Trabalho</Label>
              <div className="flex h-10 w-full items-center rounded-md border border-input bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                Presencial
              </div>
            </div>

            {(() => {
              const selectedJob: any = jobs?.find((j: any) => j.title === requestForm.title);
              if (!selectedJob) return null;
              const inheritedBenefits: string[] = Array.isArray(selectedJob?.benefits) ? selectedJob.benefits : [];
              const inheritedResponsibilities: string[] = Array.isArray(selectedJob?.responsibilities) ? selectedJob.responsibilities : [];
              const inheritedRequirements: string[] = Array.isArray(selectedJob?.requirements) ? selectedJob.requirements : [];
              const inheritedTraits: string[] = Array.isArray(selectedJob?.discovery_traits) ? selectedJob.discovery_traits : [];
              if (!inheritedBenefits.length && !inheritedResponsibilities.length && !inheritedRequirements.length && !inheritedTraits.length) return null;
              return (
                <>



                  {inheritedBenefits.length > 0 && (
                    <div>
                      <Label className="text-base font-semibold flex items-center gap-2">
                        <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                        Benefícios herdados do Cargo
                      </Label>
                      <p className="text-xs text-muted-foreground mt-1">Desmarque os benefícios que não devem aparecer para o candidato. Por padrão, todos vêm marcados.</p>
                      <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {inheritedBenefits.map((b) => {
                          const current = requestBenefits ?? inheritedBenefits;
                          const checked = current.includes(b);
                          return (
                            <label key={b} className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm cursor-pointer hover:bg-muted/40">
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(v) => {
                                  setRequestBenefits((prev) => {
                                    const base = prev ?? inheritedBenefits;
                                    return v
                                      ? Array.from(new Set([...base, b]))
                                      : base.filter((x) => x !== b);
                                  });
                                }}
                              />
                              <span>{b}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {inheritedResponsibilities.length > 0 && (
                    <div>
                      <Label className="text-base font-semibold flex items-center gap-2">
                        <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                        Responsabilidades herdadas do Cargo
                      </Label>
                      <ul className="mt-2 list-disc pl-5 space-y-1 text-sm text-foreground">
                        {inheritedResponsibilities.map((r) => (
                          <li key={r} className="leading-tight">{r}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {inheritedRequirements.length > 0 && (
                    <div>
                      <Label className="text-base font-semibold flex items-center gap-2">
                        <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                        Requisitos herdados do Cargo
                      </Label>
                      <ul className="mt-2 list-disc pl-5 space-y-1 text-sm text-foreground">
                        {inheritedRequirements.map((r) => (
                          <li key={r} className="leading-tight">{r}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {inheritedTraits.length > 0 && (
                    <div>
                      <Label className="text-base font-semibold flex items-center gap-2">
                        <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                        Características que combinam com esse cargo
                      </Label>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {inheritedTraits.map((t) => (
                          <Badge key={t} variant="outline" className="text-xs">{traitLabel(t)}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              );
            })()}

            {/* Localização de Referência */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-primary" />
                <Label className="text-base font-semibold">Localização de Referência</Label>
              </div>
              <p className="text-xs text-muted-foreground">CEP de referência para busca de candidatos próximos.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />CEP de referência</Label>
                  <div className="relative mt-1">
                    <Input
                      value={requestCepRef}
                      maxLength={9}
                      placeholder="00000-000"
                      onChange={(e) => {
                        const formatted = formatCEP(e.target.value);
                        setRequestCepRef(formatted);
                        if (formatted.replace(/\D/g, "").length === 8) lookupRequestCEP(formatted);
                        else { setRequestCepRefCoords(null); setRequestCepRefLabel(null); }
                      }}
                      className="pr-7"
                    />
                    {requestCepLoading && <Loader2 className="absolute right-2 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />}
                    {!requestCepLoading && requestCepRefCoords && <MapPin className="absolute right-2 top-2.5 h-4 w-4 text-success" />}
                  </div>
                </div>
                <div>
                  <Label className="text-sm">Raio (km)</Label>
                  <Select value={requestRadiusKm} onValueChange={setRequestRadiusKm} disabled={!requestCepRefCoords}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="5">5 km</SelectItem>
                      <SelectItem value="10">10 km</SelectItem>
                      <SelectItem value="20">20 km</SelectItem>
                      <SelectItem value="30">30 km</SelectItem>
                      <SelectItem value="50">50 km</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {requestCepRefLabel && !requestCepLoading && (
                <div className={`flex items-center gap-1.5 text-xs rounded px-2 py-1 ${
                  requestCepRefCoords ? "text-success bg-success/10" : "text-warning bg-warning/10"
                }`}>
                  <MapPin className="h-3 w-3 shrink-0" />
                  <span>{requestCepRefLabel}</span>
                </div>
              )}
            </div>

            <Button
              className="w-full"
              disabled={createJobRequest.isPending || (!isAdmFranquia && (myUnitLoading || myUnitList.length === 0)) || !selectedRequestUnit}
              onClick={async () => {
                if (!requestForm.title.trim()) {
                  toast.error("Informe o título da vaga.");
                  return;
                }
                 const effectiveUnitId = selectedRequestUnit || myUnitList[0]?.id;
                if (!effectiveUnitId) {
                  toast.error("Unidade não identificada. Contate o administrador.");
                  return;
                }
                try {
                  await createJobRequest.mutateAsync({
                    unit_id: effectiveUnitId,
                    job_id: (jobs?.find((j: any) => j.title === requestForm.title)?.id as string | undefined) ?? null,
                    title: requestForm.title.trim(),
                    description: requestForm.description.trim() || undefined,
                    salary: requestForm.salary ? Number(requestForm.salary) : null,
                    work_model: requestForm.work_model,
                    openings: Number(requestForm.openings) || 1,
                    benefits: requestBenefits ?? ((jobs?.find((j: any) => j.title === requestForm.title) as any)?.benefits ?? []),
                    responsibilities: requestResponsibilities,
                    requirements: requestRequirements,
                    reference_cep: requestCepRef ? requestCepRef.replace(/\D/g, "") : null,
                    reference_radius_km: requestCepRefCoords ? Number(requestRadiusKm) : null,
                    reference_lat: requestCepRefCoords?.lat ?? null,
                    reference_lng: requestCepRefCoords?.lng ?? null,
                  });
                  toast.success("Solicitação enviada! A central irá analisar.");
                  setRequestDialogOpen(false);
                  setRequestForm({ title: "", description: "", salary: "", work_model: "presencial", openings: "1" });
                  setRequestBenefits(null);
                  setRequestResponsibilities([]);
                  setRequestRequirements([]);
                  setRequestCepRef("");
                  setRequestCepRefCoords(null);
                  setRequestCepRefLabel(null);
                  setRequestRadiusKm("10");
                } catch (e: any) {
                  toast.error(e.message);
                }
              }}
            >
              {createJobRequest.isPending ? "Enviando..." : "Enviar Solicitação"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Review Dialog (Admin) ── */}
      <AlertDialog open={reviewDialogOpen} onOpenChange={(open) => { if (!open) { setReviewDialogOpen(false); setReviewTarget(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {reviewTarget?.status === "reprovada" ? "Não Aprovar" : "Aprovar"} solicitação
            </AlertDialogTitle>
            <AlertDialogDescription>
              Vaga: <strong>{reviewTarget?.title}</strong>
              {reviewTarget?.unit && <> — {reviewTarget.unit.name}</>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Nota (opcional)</Label>
              <Textarea
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                placeholder="Observações sobre a decisão..."
                rows={3}
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className={reviewTarget?.status === "reprovada" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : "bg-success text-success-foreground hover:bg-success/90"}
              onClick={async () => {
                if (!reviewTarget) return;
                const targetStatus = reviewTarget.status === "reprovada" ? "reprovada" : "aprovada";
                try {
                  await reviewJobRequest.mutateAsync({
                    id: reviewTarget.id,
                    status: targetStatus,
                    review_note: reviewNote.trim() || undefined,
                  });
                  toast.success(`Solicitação ${targetStatus === "aprovada" ? "aprovada" : "reprovada"} com sucesso.`);
                } catch (e: any) {
                  toast.error(e.message);
                }
                setReviewDialogOpen(false);
                setReviewTarget(null);
              }}
            >
              {reviewTarget?.status === "reprovada" ? "Não Aprovar" : "Aprovar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmação: remover item da lista padrão (soft-delete) */}
      <AlertDialog open={!!pendingDeleteDefault} onOpenChange={(open) => { if (!open) { setPendingDeleteDefault(null); setPendingDeleteConfirmText(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Remover da lista de {pendingDeleteDefault ? KIND_LABEL_PT[pendingDeleteDefault.kind] : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-foreground">"{pendingDeleteDefault?.label}"</strong> deixará de aparecer como sugestão nas próximas vagas.
              Vagas <strong>já criadas</strong> que usam esse item <strong>não são afetadas</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">
              Digite <code className="text-foreground font-mono">CONFIRMAR</code> para prosseguir
            </Label>
            <Input
              value={pendingDeleteConfirmText}
              onChange={(e) => setPendingDeleteConfirmText(e.target.value)}
              placeholder="CONFIRMAR"
              autoFocus
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteDefault}
              disabled={pendingDeleteConfirmText.trim().toUpperCase() !== "CONFIRMAR" || toggleDefaultActive.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
