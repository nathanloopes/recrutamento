import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ymdToLocalDate, dateTimeLocalInputToISO, isoToDateTimeLocalInput, formatDateTimeBR } from "@/lib/dateUtils";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";

import { ArrowLeft, ThumbsUp, FileText, Video, XCircle, Mail, Phone, FolderOpen, AlertTriangle, LayoutGrid, List, Pause, Search, CalendarIcon, FilterX, UserCheck, UserX, Users, MapPin, Loader2, SlidersHorizontal, Send, Clock, RotateCcw, MessageCircle } from "lucide-react";
import { useInfiniteScrollSentinel } from "@/hooks/useInfiniteScrollSentinel";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCandidatesByJob, useUnitJobDetail, useUpdateApplicationStatus, useCandidateDocProgress, useExistingDocRequest, usePauseCandidate, useCandidateInterviews, useApplyJobDecisionAfterDismissal, useSetWorkStartAt } from "@/hooks/useCandidatesByJob";
import { useAdminInviteToTalentPool, useUnitJobInvites, useCancelStandbyInvite } from "@/hooks/useTalentPool";
import { formatCEP, isValidCEP } from "@/lib/masks";
import { toDocMetas, mergeDocMetas } from "@/lib/docNames";
import { useJobAutoApprovesTest } from "@/hooks/useJobAutoApprovesTest";
import { autoApproveIfNoTest } from "@/lib/pipelineProgression";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { jobHasAnyTest } from "@/lib/jobHasAnyTest";
import { useSendNotification } from "@/hooks/useNotifications";
import { useOpenThreadForApplication } from "@/hooks/useConversations";
import { InterviewScheduler } from "@/components/candidate/InterviewScheduler";
import { CandidateDetailPanel } from "@/components/admin/CandidateDetailPanel";
import { ResumeInviteDialog } from "@/components/admin/ResumeInviteDialog";
import { WhatsAppMessageDialog } from "@/components/admin/WhatsAppMessageDialog";
import { DocumentRequestDialog } from "@/components/admin/DocumentRequestDialog";
import { HireButton } from "@/components/admin/HireButton";
import { TestAssignDialog } from "@/components/admin/TestAssignDialog";
import { CandidateOriginBadge } from "@/components/admin/CandidateOriginBadge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getCandidateStatus } from "@/lib/candidateStatus";


const NOTIFICATION_MESSAGES: Record<string, { title: string; body: string }> = {
  candidate_liked: { title: "Seu perfil chamou atenção!", body: "O recrutador curtiu seu perfil para a vaga {{job_title}}" },
  test_assigned: { title: "Teste enviado", body: "Um teste escrito foi enviado para a vaga {{job_title}}" },
  candidate_approved: { title: "Você avançou de etapa! 🎉", body: "Boa notícia! Seu perfil avançou no processo da vaga {{job_title}}. O próximo passo é a entrevista — em breve enviaremos as instruções." },
  candidate_rejected: { title: "Atualização da candidatura", body: "Seu perfil foi direcionado para novas oportunidades. Acompanhe pelo app." },
  interview_scheduled: { title: "Entrevista agendada", body: "Sua entrevista para a vaga {{job_title}} foi agendada" },
  interview_rescheduled: { title: "Entrevista reagendada", body: "Sua entrevista para a vaga {{job_title}} foi reagendada. Confira a nova data no app" },
  documents_requested: { title: "Documentos solicitados", body: "Você está na etapa de envio de documentos. Acesse o app para enviar os arquivos solicitados." },
};

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calcAge(birthDate: string | null | undefined): number | null {
  const dob = ymdToLocalDate(birthDate);
  if (!dob) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age;
}

function normalizeCoordinate(value: unknown): number | null {
  if (value == null || value === "") return null;
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function resolveCandidateCoordinates(
  profile: any,
  cepCoordsMap?: Record<string, { lat: number; lng: number }>,
): { lat: number; lng: number } | null {
  const cep = (profile?.cep || "").toString().replace(/\D/g, "");
  const geo = cep && cepCoordsMap ? cepCoordsMap[cep] : null;
  const lat = normalizeCoordinate(geo?.lat ?? profile?.latitude);
  const lng = normalizeCoordinate(geo?.lng ?? profile?.longitude);
  return lat == null || lng == null ? null : { lat, lng };
}

type PendingAction = {
  app: any;
  eventType: string;
  candidateName: string;
  defaultTitle: string;
  defaultBody: string;
  preAction?: () => Promise<void>;
};

export default function CandidatesByJob() {
  const { unitJobId } = useParams<{ unitJobId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { hasRole, unitIds } = useAuth();
  const isSuperAdmin = hasRole("admin");
  const { data: candidates, isLoading } = useCandidatesByJob(unitJobId || "");
  const { data: unitJob } = useUnitJobDetail(unitJobId || "");

  // Redireciona se o usuário não-admin tentar acessar candidatos de vaga de outra unidade
  useEffect(() => {
    if (!unitJob || isSuperAdmin) return;
    const jobUnitId = (unitJob as any)?.units?.id || (unitJob as any)?.unit_id;
    if (jobUnitId && !unitIds.includes(jobUnitId)) {
      navigate("/admin/vagas", { replace: true });
    }
  }, [unitJob, isSuperAdmin, unitIds, navigate]);

  const updateStatus = useUpdateApplicationStatus();
  const setWorkStartAt = useSetWorkStartAt();
  const pauseCandidate = usePauseCandidate();
  const sendNotification = useSendNotification();
  const qc = useQueryClient();
  const jobId = (unitJob as any)?.jobs?.id || (unitJob as any)?.job_id;
  const { autoApproves } = useJobAutoApprovesTest(jobId);

  // Quando o auto-approval está DESLIGADO e a vaga não tem teste algum,
  // libera o botão Aprovar manual após a triagem (caso contrário, o
  // candidato ficaria preso em em_andamento sem ação possível).
  const { data: manualApprovalUnlocked = false } = useQuery({
    queryKey: ["manual_approval_unlock", jobId],
    enabled: !!jobId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: setting } = await supabase
        .from("global_settings" as any)
        .select("value")
        .eq("category", "pipelines")
        .eq("key", "auto_approve_test_if_not_exists")
        .maybeSingle();
      const raw = (setting as any)?.value;
      const enabled = raw === true || raw === "true";
      if (enabled) return false;
      const hasTest = await jobHasAnyTest(jobId);
      return !hasTest;
    },
  });

  // Backfill: quando a flag está ligada e a vaga não tem teste, libera
  // automaticamente todas as candidaturas legadas que ainda dependem de
  // aprovação manual. Usa um Set por id para evitar loop (falha do trigger
  // de min_score reinvalidava o cache e re-disparava o effect).
  const backfillAttemptedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!autoApproves || !candidates) return;
    const eligible = (candidates as any[]).filter(
      (a) =>
        ["pendente", "em_andamento", "em_avaliacao"].includes(a.status) &&
        !backfillAttemptedRef.current.has(a.id),
    );
    if (eligible.length === 0) return;
    eligible.forEach((a) => backfillAttemptedRef.current.add(a.id));
    Promise.allSettled(eligible.map((a) => autoApproveIfNoTest(a.id))).then(() => {
      qc.invalidateQueries({ queryKey: ["candidates_by_job"] });
    });
  }, [autoApproves, candidates, qc]);

  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<any>(null);
  const [isRescheduling, setIsRescheduling] = useState(false);
  const [detailApp, setDetailApp] = useState<any>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [docRequestApp, setDocRequestApp] = useState<any>(null);
  const [testAssignApp, setTestAssignApp] = useState<any>(null);
  const [hireTarget, setHireTarget] = useState<any>(null);
  // Data-hora de início do trabalhador (opcional) — valor do <input datetime-local>.
  const [hireStartAt, setHireStartAt] = useState("");
  // Edição pós-contratação da data de início.
  const [editStartTarget, setEditStartTarget] = useState<any>(null);
  const [editStartValue, setEditStartValue] = useState("");
  const [dismissTarget, setDismissTarget] = useState<any>(null);
  const [reopenDecisionOpen, setReopenDecisionOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");

  // Filter states
  const [searchName, setSearchName] = useState("");
  const [sortBy, setSortBy] = useState("name_asc");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterInterview, setFilterInterview] = useState("all");
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();

  // Demographic / location filter states
  const [filterGender, setFilterGender] = useState<string[]>([]);
  const [ageFilterEnabled, setAgeFilterEnabled] = useState(false);
  const [ageMin, setAgeMin] = useState<number | "">("");
  const [ageMax, setAgeMax] = useState<number | "">("");
  const [filterCep, setFilterCep] = useState("");
  const [filterCepCoords, setFilterCepCoords] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [filterRadiusKm, setFilterRadiusKm] = useState<number | "">("");
  const [cepLoading, setCepLoading] = useState(false);

  // Talent pool invite state
  const [talentPoolTarget, setTalentPoolTarget] = useState<any>(null);
  const inviteToTalentPool = useAdminInviteToTalentPool();

  // Standby resume-invite state
  const [resumeInviteTarget, setResumeInviteTarget] = useState<any>(null);
  const { data: ujInvites } = useUnitJobInvites(unitJobId);
  const cancelResumeInvite = useCancelStandbyInvite();

  // Map: candidateId -> latest MANUAL invite (channel='sistema') for this unit_job.
  // Invites criados pelo motor automático (channel != 'sistema') não devem afetar
  // o estado do botão "Convidar para retomar" do admin.
  const latestInviteByCandidate = useMemo(() => {
    const m = new Map<string, any>();
    for (const inv of (ujInvites || [])) {
      if ((inv as any).channel !== "sistema") continue;
      if (!m.has(inv.candidate_id)) m.set(inv.candidate_id, inv);
    }
    return m;
  }, [ujInvites]);

  // Pre-populate demographic filters from job's candidate_filters
  useEffect(() => {
    const cf = (unitJob as any)?.candidate_filters;
    if (!cf) return;
    if (Array.isArray(cf.genders) && cf.genders.length > 0) setFilterGender(cf.genders);
    else if (cf.gender && cf.gender !== "all") setFilterGender([cf.gender]);
    if (cf.age_min != null && cf.age_max != null) {
      setAgeMin(cf.age_min);
      setAgeMax(cf.age_max);
      setAgeFilterEnabled(true);
    }
  
  }, [unitJob]);

  const candidateIds = useMemo(
    () => (candidates || []).map((c: any) => c.candidate_id).filter(Boolean),
    [candidates]
  );
  const { data: docProgress } = useCandidateDocProgress(candidateIds, candidates);

  const applicationIds = useMemo(
    () => (candidates || []).map((c: any) => c.id).filter(Boolean),
    [candidates]
  );
  const { data: interviewMap } = useCandidateInterviews(applicationIds);

  // Marcação explícita "teste pós-entrevista atribuído" vem direto da
  // candidatura (applications.post_interview_test_assigned). Não é mais
  // derivada em tempo real de test_assignments.

  // Geocodifica CEPs de candidatos sem latitude/longitude (candidate_profiles
  // guarda CEP mas nem sempre coordenadas). Só roda quando o filtro de CEP
  // está ativo, para evitar chamadas desnecessárias.
  // Geocodifica TODOS os CEPs válidos quando o filtro está ativo. O lat/lng
  // salvo em `candidates` muitas vezes é um centroide de cidade (impreciso),
  // então damos preferência ao CEP real do candidato.
  const cepsToGeocode = useMemo(() => {
    if (!filterCepCoords || !candidates) return [] as string[];
    const set = new Set<string>();
    for (const c of candidates as any[]) {
      const cep = (c.profiles?.cep || "").toString().replace(/\D/g, "");
      if (cep.length === 8) set.add(cep);
    }
    return Array.from(set).sort();
  }, [candidates, filterCepCoords]);

  const { data: cepCoordsMap } = useQuery({
    queryKey: ["cep_geocode_batch", cepsToGeocode],
    enabled: cepsToGeocode.length > 0,
    staleTime: 24 * 60 * 60 * 1000,
    queryFn: async () => {
      const result: Record<string, { lat: number; lng: number }> = {};
      await Promise.all(
        cepsToGeocode.map(async (cep) => {
          try {
            const { data } = await supabase.functions.invoke("lookup-cep", {
              body: { cep, allowApproximateCoordinates: false },
            });
            const j: any = data;
            if (j?.found && j.latitude && j.longitude) {
              result[cep] = { lat: Number(j.latitude), lng: Number(j.longitude) };
            }
          } catch { /* ignore */ }
        })
      );
      return result;
    },
  });

  const lookupCep = async (cep: string) => {
    const cleaned = cep.replace(/\D/g, "");
    if (cleaned.length !== 8) return;
    setCepLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("lookup-cep", {
        body: { cep: cleaned, allowApproximateCoordinates: false },
      });
      if (error) throw new Error("Erro ao buscar CEP");
      const json: any = data;
      if (!json?.found) {
        throw new Error(
          json?.error_type === "provider_unavailable"
            ? "Serviço de CEP indisponível, tente novamente"
            : "CEP não encontrado"
        );
      }
      const lat = normalizeCoordinate(json.latitude);
      const lng = normalizeCoordinate(json.longitude);
      if (lat == null || lng == null) throw new Error("CEP sem coordenadas precisas para filtro de distância");
      const parts = [json.neighborhood, json.city, json.state].filter(Boolean);
      setFilterCepCoords({ lat, lng, label: parts.join(", ") });
    } catch (e: any) {
      toast.error(e.message || "Erro ao buscar CEP");
      setFilterCepCoords(null);
      setFilterRadiusKm("");
    } finally {
      setCepLoading(false);
    }
  };

  const hasActiveFilters = searchName || sortBy !== "name_asc" || filterStatus !== "all" || filterInterview !== "all" || dateFrom || dateTo || filterGender.length > 0 || ageFilterEnabled || filterCepCoords;

  const clearFilters = () => {
    setSearchName("");
    setSortBy("newest");
    setFilterStatus("all");
    setFilterInterview("all");
    setDateFrom(undefined);
    setDateTo(undefined);
    setFilterGender([]);
    setAgeFilterEnabled(false);
    setAgeMin("");
    setAgeMax("");
    setFilterCep("");
    setFilterCepCoords(null);
    setFilterRadiusKm("");
  };

  const filteredCandidates = useMemo(() => {
    if (!candidates) return [];
    let filtered = [...candidates];

    if (searchName.trim()) {
      const q = searchName.toLowerCase().trim();
      filtered = filtered.filter((c: any) =>
        (c.profiles?.full_name || "").toLowerCase().includes(q)
      );
    }

    if (filterStatus !== "all") {
      filtered = filtered.filter((c: any) => c.status === filterStatus);
    }

    if (filterInterview !== "all") {
      filtered = filtered.filter((c: any) => {
        const iv = interviewMap?.[c.id];
        const st = iv?.status as string | undefined;
        switch (filterInterview) {
          case "sem_entrevista": return !iv;
          case "agendada": return st === "confirmed" || st === "rescheduled";
          case "pending_approval": return st === "pending_approval";
          case "reagendamento": return st === "reschedule_requested";
          case "realizada": return st === "completed";
          case "no_show": return st === "no_show";
          default: return true;
        }
      });
    }

    if (dateFrom) {
      filtered = filtered.filter((c: any) => new Date(c.created_at) >= dateFrom);
    }
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      filtered = filtered.filter((c: any) => new Date(c.created_at) <= end);
    }

    if (filterGender.length > 0) {
      const KNOWN = ["masculino","feminino","nao_binario","nao_declarar"];
      filtered = filtered.filter((c: any) => {
        const g = (c.profiles?.gender || "").toLowerCase().trim();
        if (!g) return false;
        return filterGender.some(sel => {
          if (sel === "outro") return !KNOWN.includes(g);
          return g === sel;
        });
      });
    }

    if (ageFilterEnabled) {
      const minAge = ageMin === "" ? 0 : Number(ageMin);
      const maxAge = ageMax === "" ? 120 : Number(ageMax);
      filtered = filtered.filter((c: any) => {
        const age = calcAge(c.profiles?.birth_date);
        if (age === null) return false;
        return age >= minAge && age <= maxAge;
      });
    }

    if (filterCepCoords && filterRadiusKm !== "") {
      filtered = filtered.filter((c: any) => {
        // Resolução de coordenadas em ordem de precisão:
        // 1) lookup preciso por CEP (cepCoordsMap)
        // 2) lat/lng já salvos no perfil/candidate
        // 3) lat/lng preservados em address_json
        const candidateCep = (c.profiles?.cep || "").toString().replace(/\D/g, "");
        const fromCep = candidateCep.length === 8 ? (cepCoordsMap?.[candidateCep] ?? null) : null;
        const coords = fromCep ?? resolveCandidateCoordinates(c.profiles, undefined);
        if (!coords) return false;
        return haversineKm(filterCepCoords.lat, filterCepCoords.lng, coords.lat, coords.lng) <= Number(filterRadiusKm) + 3;
      });
    }

    filtered.sort((a: any, b: any) => {
      switch (sortBy) {
        case "oldest":
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        case "name_asc":
          return (a.profiles?.full_name || "").localeCompare(b.profiles?.full_name || "", "pt-BR");
        case "name_desc":
          return (b.profiles?.full_name || "").localeCompare(a.profiles?.full_name || "", "pt-BR");
        case "score_desc":
          return (b.total_score || 0) - (a.total_score || 0);
        case "score_asc":
          return (a.total_score || 0) - (b.total_score || 0);
        case "newest":
        default:
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
    });

    return filtered;
  }, [candidates, searchName, sortBy, filterStatus, filterInterview, interviewMap, dateFrom, dateTo, filterGender, ageFilterEnabled, ageMin, ageMax, filterCepCoords, filterRadiusKm, cepCoordsMap]);

  // Paginação por scroll: renderiza 20 candidatos por vez, carrega mais ao chegar no fim.
  const CAND_PAGE_SIZE = 20;
  const [visibleCandCount, setVisibleCandCount] = useState(CAND_PAGE_SIZE);
  useEffect(() => {
    setVisibleCandCount(CAND_PAGE_SIZE);
  }, [searchName, sortBy, filterStatus, filterInterview, dateFrom, dateTo, filterGender, ageFilterEnabled, ageMin, ageMax, filterCepCoords, filterRadiusKm]);
  const visibleCandidates = useMemo(
    () => filteredCandidates.slice(0, visibleCandCount),
    [filteredCandidates, visibleCandCount],
  );
  const hasMoreCandidates = filteredCandidates.length > visibleCandidates.length;
  const candSentinelRef = useInfiniteScrollSentinel<HTMLDivElement>(
    () => setVisibleCandCount((c) => c + CAND_PAGE_SIZE),
    hasMoreCandidates,
  );

  const statusCounts = useMemo(() => {
    const counts = { em_andamento: 0, apto_para_vaga: 0, em_avaliacao: 0, aprovado: 0, reprovado: 0, contratado: 0, desistente: 0, desligado: 0, pausado: 0, standby: 0 };
    (candidates || []).forEach((c: any) => {
      if (counts[c.status as keyof typeof counts] !== undefined) counts[c.status as keyof typeof counts]++;
    });
    return counts;
  }, [candidates]);

  const STATUS_FILTER_OPTIONS = useMemo(() => ([
    { value: "em_andamento", label: "Em andamento" },
    { value: "apto_para_vaga", label: "Apto para vaga" },
    { value: "em_avaliacao", label: "Em Avaliação" },
    { value: "aprovado", label: "Aprovado" },
    { value: "contratado", label: "Contratado" },
    { value: "desistente", label: "Desistente" },
    { value: "desligado", label: "Desligado" },
    { value: "pausado", label: "Pausado" },
    { value: "standby", label: "Lista de Oportunidade" },
  ]), []);

  const availableStatusOptions = useMemo(
    () => STATUS_FILTER_OPTIONS.filter((s) => (statusCounts as any)[s.value] > 0),
    [STATUS_FILTER_OPTIONS, statusCounts]
  );

  const INTERVIEW_FILTER_OPTIONS = useMemo(() => ([
    { value: "agendada", label: "Agendada", match: (st?: string, iv?: any) => !!iv && (st === "confirmed" || st === "rescheduled") },
    { value: "pending_approval", label: "Aguardando aprovação", match: (st?: string, iv?: any) => !!iv && st === "pending_approval" },
    { value: "reagendamento", label: "Aguardando reagendamento", match: (st?: string, iv?: any) => !!iv && st === "reschedule_requested" },
    { value: "realizada", label: "Realizada", match: (st?: string, iv?: any) => !!iv && st === "completed" },
    { value: "no_show", label: "Não compareceu", match: (st?: string, iv?: any) => !!iv && st === "no_show" },
    { value: "sem_entrevista", label: "Sem entrevista", match: (_st?: string, iv?: any) => !iv },
  ]), []);

  const interviewCounts = useMemo(() => {
    const counts: Record<string, number> = { agendada: 0, pending_approval: 0, reagendamento: 0, realizada: 0, no_show: 0, sem_entrevista: 0 };
    (candidates || []).forEach((c: any) => {
      const iv = interviewMap?.[c.id];
      const st = iv?.status as string | undefined;
      for (const opt of INTERVIEW_FILTER_OPTIONS) {
        if (opt.match(st, iv)) { counts[opt.value]++; break; }
      }
    });
    return counts;
  }, [candidates, interviewMap, INTERVIEW_FILTER_OPTIONS]);

  const availableInterviewOptions = useMemo(
    () => INTERVIEW_FILTER_OPTIONS.filter((o) => interviewCounts[o.value] > 0),
    [INTERVIEW_FILTER_OPTIONS, interviewCounts]
  );

  useEffect(() => {
    if (filterStatus !== "all" && !availableStatusOptions.some((s) => s.value === filterStatus)) {
      setFilterStatus("all");
    }
  }, [availableStatusOptions, filterStatus]);

  useEffect(() => {
    if (filterInterview !== "all" && !availableInterviewOptions.some((o) => o.value === filterInterview)) {
      setFilterInterview("all");
    }
  }, [availableInterviewOptions, filterInterview]);

  const applyJobDecision = useApplyJobDecisionAfterDismissal();

  const jobTitle = unitJob?.jobs?.title || "";

  const resolveTemplate = useCallback((eventType: string) => {
    const msg = NOTIFICATION_MESSAGES[eventType];
    if (!msg) return { title: "", body: "" };
    return {
      title: msg.title,
      body: msg.body.replace(/\{\{(\w+)\}\}/g, (_, k) => (k === "job_title" ? jobTitle : "")),
    };
  }, [jobTitle]);

  const openMessageDialog = (app: any, eventType: string, preAction?: () => Promise<void>) => {
    const name = app.profiles?.full_name || "Candidato";
    const { title, body } = resolveTemplate(eventType);
    setPendingAction({ app, eventType, candidateName: name, defaultTitle: title, defaultBody: body, preAction });
  };

  const handleConfirmSend = async (customTitle: string, customBody: string) => {
    if (!pendingAction) return;
    const { app, eventType, candidateName, preAction } = pendingAction;
    if (preAction) await preAction();
    const payload = {
      candidate_name: candidateName,
      job_title: jobTitle,
      _title: customTitle,
      _body: customBody,
    };
    sendNotification.mutate({ eventType, recipientId: app.candidate_id, payload, channel: "whatsapp" });
    const actionLabels: Record<string, string> = {
      candidate_liked: `Curtida enviada para ${candidateName}`,
      test_assigned: `Teste enviado para ${candidateName}`,
      candidate_approved: `${candidateName} foi aprovado(a)`,
      candidate_rejected: `${candidateName} foi movido(a) para Lista de Oportunidade`,
      interview_scheduled: `Entrevista agendada e ${candidateName} notificado`,
      interview_rescheduled: `Entrevista reagendada e ${candidateName} notificado`,
    };
    toast.success(actionLabels[eventType] || "Mensagem enviada");
    setPendingAction(null);
    if (eventType === "candidate_rejected") {
      setTalentPoolTarget(app);
    }
  };

  const handleLike = (app: any) => openMessageDialog(app, "candidate_liked");
  const handleSendTest = (app: any) => setTestAssignApp(app);
  const openThread = useOpenThreadForApplication();
  const handleOpenChat = async (app: any) => {
    try {
      const id = await openThread.mutateAsync(app.id);
      navigate(`/admin/mensagens/${id}`, { state: { from: location.pathname + location.search } });
    } catch (e: any) {
      toast.error(e.message || "Não foi possível abrir a conversa");
    }
  };
  const handleScheduleInterview = async (app: any, rescheduleInterviewId?: string) => {
    if (rescheduleInterviewId) {
      // RESCHEDULE: Only update status and notify candidate — do NOT open scheduler
      try {
        await supabase.from("interviews").update({ status: "reschedule_requested" } as any).eq("id", rescheduleInterviewId);
        const candidateName = app.profiles?.full_name || "Candidato";
        sendNotification.mutate({
          eventType: "interview_reschedule_requested",
          recipientId: app.candidate_id,
          payload: {
            nome: candidateName,
            cargo: app.unit_jobs?.jobs?.title || "",
            _title: "Reagendamento de entrevista",
            _body: `Sua entrevista para ${app.unit_jobs?.jobs?.title || "a vaga"} precisa ser reagendada. Acesse suas candidaturas para escolher um novo horário.`,
            application_id: app.id,
          },
        });
        toast.success("Reagendamento solicitado ao candidato");
      } catch (e: any) {
        toast.error(e.message || "Erro ao solicitar reagendamento");
      }
      return; // STOP — no scheduler, no modal
    }
    // FIRST-TIME scheduling only
    setIsRescheduling(false);
    setSelectedCandidate(app);
    setSchedulerOpen(true);
  };
  const handleReject = (app: any) => {
    openMessageDialog(app, "candidate_standby", async () => {
      await updateStatus.mutateAsync({ applicationId: app.id, status: "standby", unitJobId: unitJobId || "" });
      // Move to talent pool
      try {
        const { moveToStandby } = await import("@/lib/moveToStandby");
        await moveToStandby(app.candidate_id, "Decisão do recrutador", app.unit_jobs?.job_id);
      } catch (e) { console.error("[CandidatesByJob] moveToStandby error:", e); }
    });
  };
  const handleApprove = (app: any) => {
    const inEvaluation = app.status === "em_avaliacao";
    const triagemDone = app.total_score != null;
    const unlockedNoTest =
      manualApprovalUnlocked &&
      triagemDone &&
      ["pendente", "em_andamento", "apto_para_vaga"].includes(app.status);
    if (!inEvaluation && !unlockedNoTest) {
      toast.error("O candidato precisa estar 'Em Avaliação' para ser aprovado.");
      return;
    }
    openMessageDialog(app, "candidate_approved", async () => {
      await updateStatus.mutateAsync({ applicationId: app.id, status: "aprovado", unitJobId: unitJobId || "" });
    });
  };
  const handleStandby = async (app: any) => {
    if (!confirm("Mover candidato para Lista de Oportunidade (Standby)?")) return;
    try {
      await updateStatus.mutateAsync({ applicationId: app.id, status: "standby", unitJobId: unitJobId || "" });
      sendNotification.mutate({
        eventType: "candidate_standby",
        recipientId: app.candidate_id,
        payload: {
          nome: app.profiles?.full_name || "",
          cargo: app.unit_jobs?.jobs?.title || "",
          _title: "Candidatura em standby",
          _body: `Sua candidatura para a vaga ${app.unit_jobs?.jobs?.title || ""} foi colocada em standby. Entraremos em contato em breve.`,
        },
      });
      toast.success("Candidato movido para Lista de Oportunidade");
    } catch (e: any) { toast.error(e.message); }
  };

  const handlePause = async (app: any) => {
    const reason = prompt("Informe o motivo da pausa:");
    if (!reason) return;
    try {
      await pauseCandidate.mutateAsync({
        applicationId: app.id,
        candidateId: app.candidate_id,
        reason,
        unitJobId: unitJobId || "",
      });
      toast.success("Candidato pausado com sucesso");
    } catch (e: any) { toast.error(e.message); }
  };

  const confirmHire = async () => {
    if (!hireTarget) return;
    // Server-side guard: documents are a parallel pendency that blocks final hire.
    // Regra: para contratar é OBRIGATÓRIO existir uma solicitação de documentos
    // E todos os documentos estarem aprovados. Sem solicitação => bloqueado.
    try {
      const { data: reqs } = await supabase
        .from("document_requests")
        .select("id, documents_list, custom_documents, status")
        .eq("application_id", hireTarget.id)
        .neq("status", "cancelled");
      const activeReqs = reqs || [];
      if (activeReqs.length === 0) {
        toast.error("Envie a solicitação de documentos antes de contratar.");
        setHireTarget(null);
        return;
      }
      // Source-of-truth: global_settings.required_documents indicates which
      // names are optional. Legacy string entries default to required=true,
      // so we override using the global map when available.
      const { data: gs } = await supabase
        .from("global_settings")
        .select("key, value")
        .eq("category", "documents")
        .eq("key", "required_documents")
        .maybeSingle();
      const sourceMap = new Map(
        toDocMetas((gs as any)?.value).map((m) => [m.name, m.required] as const)
      );

      const ids: string[] = [];
      const merged: { name: string; required: boolean }[] = [];
      for (const r of activeReqs) {
        ids.push(r.id);
        const reqMetas = mergeDocMetas(
          toDocMetas(r.documents_list),
          toDocMetas(r.custom_documents),
        );
        for (const m of reqMetas) merged.push(m);
      }
      const dedup = new Map<string, boolean>();
      for (const m of merged) {
        const required = m.required && (sourceMap.get(m.name) !== false);
        const prev = dedup.get(m.name);
        dedup.set(m.name, prev === undefined ? required : (prev || required));
      }
      const requiredDocs = Array.from(dedup.entries())
        .filter(([, req]) => req)
        .map(([name]) => name);

      if (requiredDocs.length === 0) {
        // Nenhum obrigatório — libera contratação direto.
      } else {
        const { data: ups } = await supabase
          .from("document_uploads")
          .select("document_type, status")
          .in("request_id", ids);
        const byType: Record<string, string[]> = {};
        (ups || []).forEach((u: any) => { (byType[u.document_type] ||= []).push(u.status); });
        const stillPending = requiredDocs.some((n) => !(byType[n]?.includes("approved")));
        if (stillPending) {
          toast.error("Documentos obrigatórios pendentes — não é possível contratar agora.");
          setHireTarget(null);
          return;
        }
      }

    } catch (e) {
      console.error("[confirmHire] doc check failed", e);
      toast.error("Não foi possível validar os documentos. Tente novamente.");
      setHireTarget(null);
      return;
    }
    try {
      await updateStatus.mutateAsync({
        applicationId: hireTarget.id,
        status: "contratado",
        unitJobId: unitJobId || "",
        previousStatus: hireTarget.status,
        workStartAt: dateTimeLocalInputToISO(hireStartAt),
      });
      sendNotification.mutate({
        eventType: "candidate_hired",
        recipientId: hireTarget.candidate_id,
        payload: {
          candidate_name: hireTarget.profiles?.full_name || "",
          job_title: jobTitle,
          application_id: hireTarget.id,
          unit_job_id: unitJobId || "",
          _title: "Parabéns! Você foi contratado(a)! 🎉",
          _body: `Sua contratação para a vaga ${jobTitle} foi confirmada. Bem-vindo(a) à equipe!`,
        },
      });
      toast.success(`${hireTarget.profiles?.full_name || "Candidato"} foi contratado(a)!`);
    } catch (e: any) {
      toast.error(e.message);
    }
    setHireTarget(null);
  };

  const confirmDismiss = async () => {
    if (!dismissTarget) return;
    try {
      await updateStatus.mutateAsync({
        applicationId: dismissTarget.id,
        status: "desligado",
        unitJobId: unitJobId || "",
        previousStatus: dismissTarget.status,
      });
      sendNotification.mutate({
        eventType: "candidate_dismissed",
        recipientId: dismissTarget.candidate_id,
        payload: {
          candidate_name: dismissTarget.profiles?.full_name || "",
          job_title: jobTitle,
          _title: "Atualização sobre sua contratação",
          _body: `Sua contratação para a vaga ${jobTitle} foi encerrada. Para mais informações, entre em contato.`,
        },
      });
      toast.success(`${dismissTarget.profiles?.full_name || "Candidato"} foi desligado(a)`);
      // Se a vaga estava preenchida e vai ficar com menos contratados do que openings,
      // mostra dialog para o admin decidir: reabrir ou pausar a vaga
      const willDropBelowOpenings = (statusCounts.contratado - 1) < (unitJob?.openings || 1);
      if (unitJob?.status === "preenchida" && willDropBelowOpenings) {
        setReopenDecisionOpen(true);
      }
    } catch (e: any) {
      toast.error(e.message);
    }
    setDismissTarget(null);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="icon" onClick={() => navigate("/admin/vagas")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h2 className="text-2xl font-bold text-foreground">
            {unitJob?.jobs?.title || "Carregando..."}
          </h2>
          <p className="text-sm text-muted-foreground">
            {unitJob?.units?.name} — {unitJob?.units?.city}/{unitJob?.units?.state}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <div className="flex items-center border border-border rounded-lg p-0.5">
            <Button
              variant={viewMode === "cards" ? "default" : "ghost"}
              size="icon"
              className="h-7 w-7"
              onClick={() => setViewMode("cards")}
              title="Visualização em cards"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant={viewMode === "table" ? "default" : "ghost"}
              size="icon"
              className="h-7 w-7"
              onClick={() => setViewMode("table")}
              title="Visualização em tabela"
            >
              <List className="h-3.5 w-3.5" />
            </Button>
          </div>
          <Badge variant="outline">{candidates?.length || 0} candidato(s)</Badge>
          {statusCounts.em_andamento > 0 && (
            <Badge className="bg-warning/10 text-warning border-warning/20">{statusCounts.em_andamento} em andamento</Badge>
          )}
          {statusCounts.aprovado > 0 && (
            <Badge className="bg-success/10 text-success border-success/20">{statusCounts.aprovado} aprovado(s)</Badge>
          )}
          {statusCounts.reprovado > 0 && (
            <Badge className="bg-yellow-100 text-yellow-700 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-700">{statusCounts.reprovado} em standby</Badge>
          )}
          {statusCounts.contratado > 0 && (
            <Badge className="bg-primary/10 text-primary border-primary/20">
              <UserCheck className="h-3 w-3 mr-1" />
              {statusCounts.contratado}/{unitJob?.openings || 1} contratado(s)
            </Badge>
          )}
          {statusCounts.contratado === 0 && unitJob?.openings && (
            <Badge variant="outline" className="text-muted-foreground">
              0/{unitJob.openings} contratado(s)
            </Badge>
          )}
          {statusCounts.desistente > 0 && (
            <Badge className="bg-muted text-muted-foreground border-border">
              <AlertTriangle className="h-3 w-3 mr-1" />{statusCounts.desistente} desistente(s)
            </Badge>
          )}
        </div>
      </div>

      {/* Filter Bar */}
      {candidates && candidates.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 items-end">
              {/* Search by name */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Buscar por nome</label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Nome do candidato..."
                    value={searchName}
                    onChange={(e) => setSearchName(e.target.value)}
                    className="pl-8 h-9 text-sm"
                  />
                </div>
              </div>

              {/* Sort */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Ordenar por</label>
                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">Mais recentes</SelectItem>
                    <SelectItem value="oldest">Mais antigos</SelectItem>
                    <SelectItem value="name_asc">Nome A→Z</SelectItem>
                    <SelectItem value="name_desc">Nome Z→A</SelectItem>
                    <SelectItem value="score_desc">Maior score</SelectItem>
                    <SelectItem value="score_asc">Menor score</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Status filter */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Status</label>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os status</SelectItem>
                    {availableStatusOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label} ({(statusCounts as any)[opt.value]})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Interview filter */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Entrevista</label>
                <Select value={filterInterview} onValueChange={setFilterInterview}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as entrevistas</SelectItem>
                    {availableInterviewOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label} ({interviewCounts[opt.value]})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>


              {/* Date from */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">De</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("h-9 w-full justify-start text-left text-sm font-normal", !dateFrom && "text-muted-foreground")}>
                      <CalendarIcon className="h-3.5 w-3.5 mr-1.5" />
                      {dateFrom ? format(dateFrom, "dd/MM/yyyy") : "Data início"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={dateFrom} onSelect={setDateFrom} locale={ptBR} initialFocus className="p-3 pointer-events-auto" />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Date to */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Até</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("h-9 w-full justify-start text-left text-sm font-normal", !dateTo && "text-muted-foreground")}>
                      <CalendarIcon className="h-3.5 w-3.5 mr-1.5" />
                      {dateTo ? format(dateTo, "dd/MM/yyyy") : "Data fim"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={dateTo} onSelect={setDateTo} locale={ptBR} initialFocus className="p-3 pointer-events-auto" />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Clear filters */}
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9 text-xs gap-1 text-muted-foreground">
                  <FilterX className="h-3.5 w-3.5" /> Limpar
                </Button>
              )}
            </div>

            {/* Demographic filters */}
            <div className="border-t border-border mt-3 pt-3">
              <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                <SlidersHorizontal className="h-3 w-3" /> Filtros demográficos
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
                {/* Gender */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">
                    Gênero{filterGender.length > 0 && (
                      <button type="button" onClick={() => setFilterGender([])} className="ml-2 text-[10px] text-muted-foreground hover:text-destructive underline">limpar</button>
                    )}
                  </label>
                  <div className="flex flex-col gap-1">
                    {[
                      { value: "masculino", label: "Masculino" },
                      { value: "feminino", label: "Feminino" },
                      { value: "nao_binario", label: "Não-binário" },
                      { value: "nao_declarar", label: "Prefiro não declarar" },
                      { value: "outro", label: "Outro" },
                    ].map((g) => (
                      <label key={g.value} className="flex items-center gap-1.5 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          className="h-3 w-3 rounded border-border"
                          checked={filterGender.includes(g.value)}
                          onChange={(e) => setFilterGender(prev => e.target.checked ? [...prev, g.value] : prev.filter(x => x !== g.value))}
                        />
                        {g.label}
                      </label>
                    ))}
                  </div>
                </div>

                {/* Age range */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={ageFilterEnabled}
                      onChange={(e) => setAgeFilterEnabled(e.target.checked)}
                      className="h-3 w-3 rounded border-border"
                    />
                    Idade: {ageFilterEnabled ? `${ageMin === "" ? "—" : ageMin} – ${ageMax === "" ? "—" : ageMax} anos` : "desativado"}
                  </label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      value={ageMin}
                      onChange={(e) => setAgeMin(e.target.value === "" ? "" : Number(e.target.value))}
                      disabled={!ageFilterEnabled}
                      className="h-9 text-sm w-full"
                      placeholder="Mín"
                    />
                    <span className="text-muted-foreground text-xs shrink-0">→</span>
                    <Input
                      type="number"
                      min={0}
                      max={120}
                      value={ageMax}
                      onChange={(e) => setAgeMax(e.target.value === "" ? "" : Number(e.target.value))}
                      disabled={!ageFilterEnabled}
                      className="h-9 text-sm w-full"
                      placeholder="Máx"
                    />
                  </div>
                </div>

                {/* CEP reference */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                    <MapPin className="h-3 w-3" /> CEP de referência
                  </label>
                  <div className="relative">
                    <Input
                      placeholder="Ex: 04552-000"
                      value={filterCep}
                      onChange={(e) => {
                        const formatted = formatCEP(e.target.value);
                        setFilterCep(formatted);
                        setFilterCepCoords(null);
                        setFilterRadiusKm("");
                      }}
                      onBlur={() => lookupCep(filterCep)}
                      className="h-9 text-sm pr-8"
                      maxLength={9}
                    />
                    {cepLoading && (
                      <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    )}
                  </div>
                </div>

                {/* Radius */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Raio de distância</label>
                  <Select
                    value={filterRadiusKm === "" ? "" : String(filterRadiusKm)}
                    onValueChange={(v) => setFilterRadiusKm(Number(v))}
                    disabled={!filterCepCoords}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="5">até 5 km</SelectItem>
                      <SelectItem value="10">até 10 km</SelectItem>
                      <SelectItem value="20">até 20 km</SelectItem>
                      <SelectItem value="30">até 30 km</SelectItem>
                      <SelectItem value="50">até 50 km</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Results count */}
            {hasActiveFilters && (
              <p className="text-xs text-muted-foreground mt-2">
                {filteredCandidates.length} de {candidates.length} candidato(s) encontrado(s)
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      ) : candidates?.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Nenhum candidato se inscreveu nesta vaga ainda.
          </CardContent>
        </Card>
      ) : filteredCandidates.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Nenhum candidato encontrado com os filtros aplicados.
          </CardContent>
        </Card>
      ) : (
        <>
        {viewMode === "cards" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {visibleCandidates.map((app: any) => {
              const profile = app.profiles;
              const phase = app.pipeline_phases;
              const initials = (profile?.full_name || "?")
                .split(" ")
                .map((n: string) => n[0])
                .join("")
                .slice(0, 2)
                .toUpperCase();

              const dp = docProgress?.[app.candidate_id];
              const docTotal = dp?.total || 0;
              const docUploaded = dp?.uploaded || 0;
              const docPercent = docTotal > 0 ? Math.round((docUploaded / docTotal) * 100) : 0;

              // Derive display status via fonte única (candidateStatus)
              const docApproved = dp?.approved || 0;
              const hasPostInterviewAssigned = app.post_interview_test_assigned === true;
              const activeInterview = interviewMap?.[app.id];
              const candStatus = getCandidateStatus({
                application: app,
                interviews: activeInterview ? [activeInterview] : null,
                docContext: { docTotal, docApproved, docUploaded, hasPostInterviewTestAssigned: hasPostInterviewAssigned },
              });
              const displayStatus = candStatus.code;

              const isWithdrawn = app.status === "desistente" || app.status === "pausado";
              const canManageInterview = app.status === "pendente" || app.status === "em_andamento" || app.status === "apto_para_vaga";
              const hasLockedInterviewState = activeInterview?.status === "completed" || activeInterview?.status === "no_show";
              const canShowScheduleButton = canManageInterview && !hasLockedInterviewState;
              const restartMode = (app as any).currentRestartMode as string | null;
              const isDocsRestart = app.status === "em_andamento" && restartMode === "documentacao";
              const isInterviewRestart = app.status === "em_andamento" && restartMode === "entrevista";

              return (
                <div
                  key={app.id}
                  className={cn(
                    "group relative rounded-2xl bg-card border border-border/50 p-5 transition-all duration-500 hover:shadow-xl hover:shadow-primary/5 hover:-translate-y-1 overflow-hidden cursor-pointer",
                    isWithdrawn && "opacity-60"
                  )}
                  onClick={() => setDetailApp(app)}
                >
                  {/* Animated Grid Background */}
                  <div className="absolute inset-0 overflow-hidden opacity-0 group-hover:opacity-100 transition-opacity duration-700">
                    <div
                      className="absolute inset-0"
                      style={{
                        backgroundImage:
                          "linear-gradient(hsl(var(--muted-foreground) / 0.06) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--muted-foreground) / 0.06) 1px, transparent 1px)",
                        backgroundSize: "40px 40px",
                        animation: "gridMove 4s linear infinite",
                      }}
                    />
                  </div>

                  <div className="relative z-10 flex flex-col items-center text-center">
                    {/* Status indicator */}
                    <div className="absolute top-0 right-0">
                      <div className="relative flex items-center gap-1.5">
                        <div className={cn("h-2.5 w-2.5 rounded-full", candStatus.dotClassName)} />
                        {app.status === "em_andamento" && (
                          <div className={cn("absolute inset-0 h-2.5 w-2.5 rounded-full animate-ping opacity-75", candStatus.dotClassName)} />
                        )}
                      </div>
                    </div>

                    {/* Avatar with glow ring */}
                    <div className="relative mb-3">
                      <div className="relative transition-transform duration-500 group-hover:scale-105">
                        <Avatar className="h-16 w-16 border-2 border-border shadow-lg">
                          <AvatarImage src={profile?.avatar_url || undefined} alt={profile?.full_name} />
                          <AvatarFallback className="text-base font-bold bg-muted text-muted-foreground">
                            {initials}
                          </AvatarFallback>
                        </Avatar>
                        <div className="absolute -inset-1 rounded-full bg-gradient-to-r from-primary/40 to-primary/20 opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-sm -z-10" />
                      </div>
                    </div>

                    {/* Name */}
                    <div className="mb-2 transition-all duration-300 group-hover:translate-y-[-2px]">
                      <h3 className="font-semibold text-sm text-foreground truncate max-w-[180px] name-display">
                        {profile?.full_name || "Sem nome"}
                      </h3>
                    </div>

                    {/* Contact */}
                    <div className="flex flex-col items-center gap-0.5 text-[11px] text-muted-foreground mb-2">
                      {profile?.email && (
                        <span className="flex items-center gap-1 truncate max-w-[180px]">
                          <Mail className="h-3 w-3 shrink-0" /> {profile.email}
                        </span>
                      )}
                      {profile?.phone && (
                        <span className="flex items-center gap-1">
                          <Phone className="h-3 w-3 shrink-0" /> {profile.phone}
                        </span>
                      )}
                    </div>

                    {/* Badges */}
                    <div className="flex flex-wrap justify-center gap-1.5 mb-3">
                      <Badge className={cn("text-[10px] border", candStatus.className)}>
                        {candStatus.label}
                      </Badge>
                      {phase && !(
                        /teste\s*p[oó]s[\s-]*entrevista/i.test(phase.name || "") &&
                        !hasPostInterviewAssigned
                      ) && (
                        <Badge variant="outline" className="text-[10px]">
                          {phase.name}
                        </Badge>
                      )}
                      {app.total_score != null && (() => {
                        const minScore = Number((unitJob as any)?.jobs?.min_score ?? 0);
                        const belowMin = Number(app.total_score) < minScore;
                        return (
                          <Badge
                            variant={belowMin ? "outline" : "secondary"}
                            className={cn(
                              "text-[10px]",
                              belowMin && "bg-destructive/10 text-destructive border-destructive/30"
                            )}
                            title={belowMin ? `Abaixo do mínimo (${minScore})` : undefined}
                          >
                            Score: {app.total_score}{belowMin ? ` / ${minScore}` : ""}
                          </Badge>
                        );
                      })()}
                      {app.status === "desistente" && (
                        <Badge variant="outline" className="text-[10px] text-destructive border-destructive/30">
                          <AlertTriangle className="h-3 w-3 mr-0.5" />
                          Desistente
                        </Badge>
                      )}
                      {app.status === "pausado" && (
                        <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">
                          <Pause className="h-3 w-3 mr-0.5" />
                          Pausado
                        </Badge>
                      )}
                    </div>

                    {app.origin_channel && (
                      <div className="flex justify-center mb-3 max-w-full px-1">
                        <CandidateOriginBadge channel={app.origin_channel} campaign={app.origin_campaign} />
                      </div>
                    )}

                    {/* Interview Info */}
                    {activeInterview && (() => {
                      const st = activeInterview.status;
                      const dateStr = format(ymdToLocalDate(activeInterview.scheduled_date) ?? new Date(), "dd/MM", { locale: ptBR });
                      const timeStr = activeInterview.scheduled_time?.slice(0, 5);
                      let label = `Entrevista marcada — ${dateStr} às ${timeStr}`;
                      let cls = "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-700";
                      if (st === "pending_approval") { label = `Aguardando aprovação — ${dateStr} às ${timeStr}`; cls = "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-700"; }
                      else if (st === "completed") { label = `Entrevista realizada em ${dateStr} às ${timeStr}`; cls = "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-700"; }
                      else if (st === "no_show") { label = `Não compareceu — ${dateStr} às ${timeStr}`; cls = "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-700"; }
                      else if (st === "reschedule_requested") { label = `Reagendamento solicitado — ${dateStr} às ${timeStr}`; cls = "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-700"; }
                      return (
                        <div className="w-full mb-3">
                          <Badge variant="outline" className={`text-[10px] w-full justify-center ${cls}`}>
                            <CalendarIcon className="h-3 w-3 mr-1" />
                            {label}
                          </Badge>
                        </div>
                      );
                    })()}

                    {/* Pending resume invite indicator (visible em qualquer status) */}
                    {(() => {
                      const inv = latestInviteByCandidate.get(app.candidate_id);
                      if (!inv) return null;
                      if (inv.status === "pending") {
                        return (
                          <div className="w-full mb-3 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                            <Badge variant="outline" className="flex-1 justify-center text-[10px] border-amber-300 text-amber-700 bg-amber-50 gap-1">
                              <Clock className="h-3 w-3" /> Convite de retomada enviado — aguardando resposta
                            </Badge>
                            <Button variant="outline" size="sm" onClick={() => cancelResumeInvite.mutate(inv.id)} className="h-7 px-2 text-[10px]" disabled={cancelResumeInvite.isPending}>
                              Cancelar
                            </Button>
                          </div>
                        );
                      }
                      if (inv.status === "declined") {
                        return (
                          <div className="w-full mb-3">
                            <Badge variant="outline" className="w-full justify-center text-[10px] border-rose-300 text-rose-700 bg-rose-50">
                              Candidato recusou o convite de retomada
                            </Badge>
                          </div>
                        );
                      }
                      return null;
                    })()}

                    {/* Document Progress */}
                    {docTotal > 0 && (
                      <div className="w-full mb-3 space-y-1">
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <FolderOpen className="h-3 w-3" /> Documentos
                          </span>
                          <span className="font-medium text-foreground">{docUploaded}/{docTotal}</span>
                        </div>
                        <Progress value={docPercent} className="h-1.5" />
                      </div>
                    )}

                    {/* Withdrawal reason */}
                    {isWithdrawn && app.withdrawal_reason && (
                      <p className="text-[10px] text-destructive/80 italic mb-3 truncate max-w-[200px]" title={app.withdrawal_reason}>
                        Motivo: {app.withdrawal_reason}
                      </p>
                    )}

                    {/* Action Buttons - hidden for withdrawn and finalized statuses */}
                    {!isWithdrawn && app.status !== "desligado" && (
                      <div className="flex flex-wrap justify-center gap-1.5 w-full" onClick={(e) => e.stopPropagation()}>
                        {app.status !== "contratado" && (
                          <>
                            <Button variant="outline" size="sm" onClick={() => handleLike(app)} title="Curtir" className="h-8 px-2 text-[10px]">
                              <ThumbsUp className="h-3 w-3" />
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => handleSendTest(app)} title="Enviar teste" className="h-8 px-2 text-[10px]">
                              <FileText className="h-3 w-3" />
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => handleOpenChat(app)} title="Mensagem" className="h-8 px-2 text-[10px]">
                              <MessageCircle className="h-3 w-3" />
                            </Button>
                            {canShowScheduleButton && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleScheduleInterview(app, activeInterview?.id)}
                                title={activeInterview?.status === "reschedule_requested" ? "Aguardando candidato reagendar" : activeInterview ? "Reagendar entrevista" : "Agendar entrevista"}
                                className="h-8 px-2 text-[10px]"
                                disabled={activeInterview?.status === "reschedule_requested"}
                              >
                                <Video className="h-3 w-3" />{activeInterview?.status === "reschedule_requested" ? " Aguardando" : activeInterview ? " Reagendar" : ""}
                              </Button>
                            )}
                          </>
                        )}
                        {(app.status === "pendente" || app.status === "em_andamento" || app.status === "apto_para_vaga" || app.status === "em_avaliacao" || app.status === "aprovado") && (
                          <Button variant="outline" size="sm" onClick={() => setDocRequestApp(app)} title="Solicitar documentos" className="h-8 px-2 text-[10px]">
                            <FolderOpen className="h-3 w-3" />
                          </Button>
                        )}
                        {(app.status === "pendente" || app.status === "em_andamento" || app.status === "apto_para_vaga") && !isDocsRestart && !isInterviewRestart && (
                          <>
                            {manualApprovalUnlocked && app.total_score != null && (
                              <Button variant="default" size="sm" onClick={() => handleApprove(app)} className="h-8 px-2 text-[10px]">
                                Aprovar
                              </Button>
                            )}
                            <Button variant="outline" size="sm" onClick={() => handlePause(app)} title="Pausar" className="h-8 px-2 text-[10px] text-amber-600 border-amber-300 hover:bg-amber-50">
                              <Pause className="h-3 w-3" />
                            </Button>
                            <Button variant="destructive" size="sm" onClick={() => handleReject(app)} className="h-8 px-2 text-[10px]">
                              <XCircle className="h-3 w-3" />
                            </Button>
                          </>
                        )}
                        {isInterviewRestart && (
                          <>
                            <Button variant="outline" size="sm" onClick={() => handlePause(app)} title="Pausar" className="h-8 px-2 text-[10px] text-amber-600 border-amber-300 hover:bg-amber-50">
                              <Pause className="h-3 w-3" />
                            </Button>
                            <Button variant="destructive" size="sm" onClick={() => handleReject(app)} className="h-8 px-2 text-[10px]">
                              <XCircle className="h-3 w-3" />
                            </Button>
                          </>
                        )}
                        {app.status === "em_avaliacao" && (
                          <>
                            {!autoApproves && !isDocsRestart && !isInterviewRestart && (
                              <Button variant="default" size="sm" onClick={() => handleApprove(app)} className="h-8 px-2 text-[10px]">
                                Aprovar
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleScheduleInterview(app, undefined)}
                              title="Agendar nova entrevista"
                              className="h-8 px-2 text-[10px]"
                            >
                              <Video className="h-3 w-3 mr-0.5" /> Nova Entrevista
                            </Button>
                            <Button variant="destructive" size="sm" onClick={() => handleReject(app)} className="h-8 px-2 text-[10px]">
                              <XCircle className="h-3 w-3" />
                            </Button>
                          </>
                        )}
                        {(app.status === "aprovado" || isDocsRestart) && (
                          <>
                            <HireButton
                              applicationId={app.id}
                              candidateId={app.candidate_id}
                              onClick={() => { setHireStartAt(isoToDateTimeLocalInput(app.work_start_at)); setHireTarget(app); }}
                              className="h-8 px-2 text-[10px]"
                            />
                            <Button variant="destructive" size="sm" onClick={() => handleReject(app)} className="h-8 px-2 text-[10px]">
                              <XCircle className="h-3 w-3" />
                            </Button>
                          </>
                        )}
                        {app.status === "contratado" && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => { setEditStartValue(isoToDateTimeLocalInput(app.work_start_at)); setEditStartTarget(app); }}
                              className="h-8 px-2 text-[10px]"
                            >
                              <CalendarIcon className="h-3 w-3 mr-1" />
                              {app.work_start_at ? `Início: ${formatDateTimeBR(app.work_start_at)}` : "Definir início"}
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => setDismissTarget(app)} className="h-8 px-2 text-[10px] text-rose-600 border-rose-300 hover:bg-rose-50">
                              <UserX className="h-3 w-3 mr-1" /> Desligar
                            </Button>
                          </>
                        )}
                        {app.status === "standby" && (() => {
                          const inv = latestInviteByCandidate.get(app.candidate_id);
                          if (inv?.status === "pending") {
                            // já exibido pelo banner do meio do card
                            return null;
                          }
                          if (inv?.status === "declined") {
                            return (
                              <Button variant="default" size="sm" onClick={() => setResumeInviteTarget(app)} className="h-8 px-2 text-[10px] bg-emerald-600 hover:bg-emerald-700">
                                <RotateCcw className="h-3 w-3 mr-1" /> Convidar novamente
                              </Button>
                            );
                          }
                          return (
                            <Button variant="default" size="sm" onClick={() => setResumeInviteTarget(app)} className="h-8 px-2 text-[10px] bg-emerald-600 hover:bg-emerald-700" title="Convidar a retomar a candidatura">
                              <Send className="h-3 w-3 mr-1" /> Convidar para retomar
                            </Button>
                          );
                        })()}
                      </div>
                    )}
                  </div>

                  {/* Animated border on hover */}
                  <div className="absolute inset-0 rounded-2xl border-2 border-transparent group-hover:border-primary/20 transition-colors duration-500 pointer-events-none" />
                </div>
              );
            })}
          </div>
        ) : (
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Contato</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Fase</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Documentos</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleCandidates.map((app: any) => {
                    const profile = app.profiles;
                    const phase = app.pipeline_phases;
                    const initials = (profile?.full_name || "?")
                      .split(" ")
                      .map((n: string) => n[0])
                      .join("")
                      .slice(0, 2)
                      .toUpperCase();
                    const dp = docProgress?.[app.candidate_id];
                    const docTotal = dp?.total || 0;
                    const docUploaded = dp?.uploaded || 0;
                    const docApprovedTbl = dp?.approved || 0;
                    const hasPostInterviewAssignedTbl = app.post_interview_test_assigned === true;
                    const activeInterviewTbl = interviewMap?.[app.id];
                    const candStatusTbl = getCandidateStatus({
                      application: app,
                      interviews: activeInterviewTbl ? [activeInterviewTbl] : null,
                      docContext: { docTotal, docApproved: docApprovedTbl, docUploaded, hasPostInterviewTestAssigned: hasPostInterviewAssignedTbl },
                    });
                    const displayStatusTbl = candStatusTbl.code;
                    const isWithdrawn = app.status === "desistente" || app.status === "pausado";
                    const canManageInterviewTbl = app.status === "pendente" || app.status === "em_andamento" || app.status === "apto_para_vaga";
                    const hasLockedInterviewStateTbl = activeInterviewTbl?.status === "completed" || activeInterviewTbl?.status === "no_show";
                    const canShowScheduleButtonTbl = canManageInterviewTbl && !hasLockedInterviewStateTbl;
                    const restartModeTbl = (app as any).currentRestartMode as string | null;
                    const isDocsRestartTbl = app.status === "em_andamento" && restartModeTbl === "documentacao";
                    const isInterviewRestartTbl = app.status === "em_andamento" && restartModeTbl === "entrevista";

                    return (
                      <TableRow
                        key={app.id}
                        className={cn("cursor-pointer", isWithdrawn && "opacity-60")}
                        onClick={() => setDetailApp(app)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="h-8 w-8">
                              <AvatarImage src={profile?.avatar_url || undefined} />
                              <AvatarFallback className="text-xs bg-muted text-muted-foreground">{initials}</AvatarFallback>
                            </Avatar>
                            <span className="font-medium text-sm name-display">{profile?.full_name || "Sem nome"}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                            {profile?.email && <span className="truncate max-w-[180px]">{profile.email}</span>}
                            {profile?.phone && <span>{profile.phone}</span>}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={cn("text-[10px] border", candStatusTbl.className)}>
                            {candStatusTbl.label}
                          </Badge>
                          {activeInterviewTbl && (() => {
                            const st = activeInterviewTbl.status;
                            const dateStr = format(ymdToLocalDate(activeInterviewTbl.scheduled_date) ?? new Date(), "dd/MM");
                            const timeStr = activeInterviewTbl.scheduled_time?.slice(0, 5);
                            let label = `Entrevista ${dateStr} às ${timeStr}`;
                            let cls = "text-blue-600 dark:text-blue-400";
                            if (st === "completed") { label = `Realizada ${dateStr} às ${timeStr}`; cls = "text-emerald-600 dark:text-emerald-400"; }
                            else if (st === "no_show") { label = `Não compareceu ${dateStr}`; cls = "text-red-600 dark:text-red-400"; }
                            else if (st === "reschedule_requested") { label = `Reagendar ${dateStr} às ${timeStr}`; cls = "text-amber-600 dark:text-amber-400"; }
                            return <span className={`block text-[10px] mt-0.5 ${cls}`}>{label}</span>;
                          })()}
                        </TableCell>
                        <TableCell>
                          {phase && !(
                            /teste\s*p[oó]s[\s-]*entrevista/i.test(phase.name || "") &&
                            !hasPostInterviewAssignedTbl
                          ) ? (
                            <Badge variant="outline" className="text-[10px]">{phase.name}</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {app.total_score != null ? (() => {
                            const minScore = Number((unitJob as any)?.jobs?.min_score ?? 0);
                            const belowMin = Number(app.total_score) < minScore;
                            return (
                              <Badge
                                variant={belowMin ? "outline" : "secondary"}
                                className={cn(
                                  "text-[10px]",
                                  belowMin && "bg-destructive/10 text-destructive border-destructive/30"
                                )}
                                title={belowMin ? `Abaixo do mínimo (${minScore})` : undefined}
                              >
                                {app.total_score}{belowMin ? ` / ${minScore}` : ""}
                              </Badge>
                            );
                          })() : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {docTotal > 0 ? (
                            <div className="flex items-center gap-2 min-w-0">
                              <Progress value={Math.round((docUploaded / docTotal) * 100)} className="h-1.5 flex-1" />
                              <span className="text-[10px] text-muted-foreground whitespace-nowrap">{docUploaded}/{docTotal}</span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {!isWithdrawn && app.status !== "desligado" && (() => {
                            const invTbl = latestInviteByCandidate.get(app.candidate_id);
                            if (invTbl?.status === "pending") {
                              return (
                                <div className="flex items-center justify-end gap-1.5 mb-1" onClick={(e) => e.stopPropagation()}>
                                  <Badge variant="outline" className="h-7 px-2 text-[10px] border-amber-300 text-amber-700 bg-amber-50 gap-1">
                                    <Clock className="h-3 w-3" /> Convite enviado
                                  </Badge>
                                  <Button variant="outline" size="sm" onClick={() => cancelResumeInvite.mutate(invTbl.id)} className="h-7 px-2 text-[10px]" disabled={cancelResumeInvite.isPending}>
                                    Cancelar
                                  </Button>
                                </div>
                              );
                            }
                            return null;
                          })()}
                          {!isWithdrawn && app.status !== "desligado" && (
                            <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                              {app.status !== "contratado" && (
                                <>
                                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleLike(app)} title="Curtir">
                                    <ThumbsUp className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleSendTest(app)} title="Enviar teste">
                                    <FileText className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleOpenChat(app)} title="Mensagem">
                                    <MessageCircle className="h-3.5 w-3.5" />
                                  </Button>
                                  {canShowScheduleButtonTbl && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7"
                                      onClick={() => handleScheduleInterview(app, activeInterviewTbl?.id)}
                                      title={activeInterviewTbl?.status === "reschedule_requested" ? "Aguardando candidato reagendar" : activeInterviewTbl ? "Reagendar entrevista" : "Agendar entrevista"}
                                      disabled={activeInterviewTbl?.status === "reschedule_requested"}
                                    >
                                      <Video className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
                                </>
                              )}
                              {(app.status === "pendente" || app.status === "em_andamento" || app.status === "em_avaliacao" || app.status === "aprovado") && (
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDocRequestApp(app)} title="Solicitar documentos">
                                  <FolderOpen className="h-3.5 w-3.5" />
                                </Button>
                              )}
                              {(app.status === "pendente" || app.status === "em_andamento") && !isDocsRestartTbl && !isInterviewRestartTbl && (
                                <>
                                  {manualApprovalUnlocked && app.total_score != null && (
                                    <Button variant="default" size="sm" className="h-7 px-2 text-[10px]" onClick={() => handleApprove(app)}>
                                      Aprovar
                                    </Button>
                                  )}
                                  <Button variant="ghost" size="icon" className="h-7 w-7 text-amber-600" onClick={() => handlePause(app)} title="Pausar">
                                     <Pause className="h-3.5 w-3.5" />
                                   </Button>
                                  <Button variant="outline" size="icon" className="h-7 w-7 border-yellow-400 text-yellow-600 hover:bg-yellow-50" onClick={() => handleReject(app)} title="Mover para Standby">
                                    <XCircle className="h-3.5 w-3.5" />
                                  </Button>
                                </>
                              )}
                              {isInterviewRestartTbl && (
                                <>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 text-amber-600" onClick={() => handlePause(app)} title="Pausar">
                                    <Pause className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button variant="outline" size="icon" className="h-7 w-7 border-yellow-400 text-yellow-600 hover:bg-yellow-50" onClick={() => handleReject(app)} title="Mover para Standby">
                                    <XCircle className="h-3.5 w-3.5" />
                                  </Button>
                                </>
                              )}
                              {app.status === "em_avaliacao" && (
                                <>
                                  {!autoApproves && !isDocsRestartTbl && !isInterviewRestartTbl && (
                                    <Button variant="default" size="sm" className="h-7 px-2 text-[10px]" onClick={() => handleApprove(app)}>
                                      Aprovar
                                    </Button>
                                  )}
                                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleScheduleInterview(app, undefined)} title="Agendar nova entrevista">
                                    <Video className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button variant="outline" size="icon" className="h-7 w-7 border-yellow-400 text-yellow-600 hover:bg-yellow-50" onClick={() => handleReject(app)} title="Mover para Standby">
                                    <XCircle className="h-3.5 w-3.5" />
                                  </Button>
                                </>
                              )}
                              {(app.status === "aprovado" || isDocsRestartTbl) && (
                                <>
                                  <HireButton
                                    applicationId={app.id}
                                    candidateId={app.candidate_id}
                                    onClick={() => { setHireStartAt(isoToDateTimeLocalInput(app.work_start_at)); setHireTarget(app); }}
                                    className="h-7 px-2 text-[10px]"
                                  />
                                  <Button variant="outline" size="icon" className="h-7 w-7 border-yellow-400 text-yellow-600 hover:bg-yellow-50" onClick={() => handleReject(app)} title="Mover para Standby">
                                    <XCircle className="h-3.5 w-3.5" />
                                  </Button>
                                </>
                              )}
                              {app.status === "contratado" && (
                                <Button variant="outline" size="sm" className="h-7 px-2 text-[10px] text-rose-600 border-rose-300 hover:bg-rose-50" onClick={() => setDismissTarget(app)}>
                                  <UserX className="h-3.5 w-3.5 mr-1" /> Desligar
                                </Button>
                              )}
                              {app.status === "standby" && (() => {
                                const inv = latestInviteByCandidate.get(app.candidate_id);
                                if (inv?.status === "pending") {
                                  // já exibido no badge acima desta célula
                                  return null;
                                }
                                if (inv?.status === "declined") {
                                  return (
                                    <Button variant="default" size="sm" onClick={() => setResumeInviteTarget(app)} className="h-7 px-2 text-[10px] bg-emerald-600 hover:bg-emerald-700">
                                      <RotateCcw className="h-3 w-3 mr-1" /> Convidar novamente
                                    </Button>
                                  );
                                }
                                return (
                                  <Button variant="default" size="sm" onClick={() => setResumeInviteTarget(app)} className="h-7 px-2 text-[10px] bg-emerald-600 hover:bg-emerald-700">
                                    <Send className="h-3 w-3 mr-1" /> Convidar para retomar
                                  </Button>
                                );
                              })()}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
        {hasMoreCandidates && (
          <div className="flex flex-col items-center justify-center gap-2 pt-4">
            <div ref={candSentinelRef} aria-hidden className="h-1 w-full" />
            <p className="text-xs text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" /> Carregando mais…
            </p>
          </div>
        )}
        </>
      )}

      {/* Interview Scheduler */}
      {selectedCandidate && unitJob && (
        <InterviewScheduler
          applicationId={selectedCandidate.id}
          unitId={unitJob.units?.id}
          candidateId={selectedCandidate.candidate_id}
          jobTitle={unitJob.jobs?.title}
          jobDescription={unitJob.jobs?.description}
          jobId={unitJob.jobs?.id}
          open={schedulerOpen}
          onOpenChange={setSchedulerOpen}
          onScheduled={() => {
            setSchedulerOpen(false);
            openMessageDialog(selectedCandidate, isRescheduling ? "interview_rescheduled" : "interview_scheduled");
            setIsRescheduling(false);
          }}
        />
      )}

      {/* Candidate Detail Panel */}
      <CandidateDetailPanel
        application={detailApp}
        open={!!detailApp}
        onOpenChange={(open) => !open && setDetailApp(null)}
        unitJob={unitJob}
      />

      {/* WhatsApp Message Dialog */}
      {pendingAction && (
        <WhatsAppMessageDialog
          open={!!pendingAction}
          onOpenChange={(open) => !open && setPendingAction(null)}
          candidateName={pendingAction.candidateName}
          eventType={pendingAction.eventType}
          defaultTitle={pendingAction.defaultTitle}
          defaultBody={pendingAction.defaultBody}
          onConfirm={handleConfirmSend}
        />
      )}

      {/* Document Request Dialog */}
      {docRequestApp && unitJob && (
        <DocumentRequestDialog
          open={!!docRequestApp}
          onOpenChange={(open) => !open && setDocRequestApp(null)}
          application={docRequestApp}
          unitJob={unitJob}
        />
      )}

      {/* Test Assign Dialog */}
      {testAssignApp && (
        <TestAssignDialog
          open={!!testAssignApp}
          onOpenChange={(open) => !open && setTestAssignApp(null)}
          applicationId={testAssignApp.id}
          candidateId={testAssignApp.candidate_id}
        />
      )}

      {/* Hire Confirmation */}
      <AlertDialog open={!!hireTarget} onOpenChange={(open) => { if (!open) { setHireTarget(null); setHireStartAt(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar contratação</AlertDialogTitle>
            <AlertDialogDescription>
              Deseja confirmar a contratação de <strong className="name-display">{hireTarget?.profiles?.full_name}</strong> para a vaga <strong>{jobTitle}</strong>?
              <br /><br />
              O candidato será marcado como <strong>contratado</strong> e ocupará uma das vagas disponíveis ({statusCounts.contratado}/{unitJob?.openings || 1} preenchidas).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5 py-1">
            <label htmlFor="hire-start-at" className="text-sm font-medium text-foreground">
              Data e hora de início <span className="text-muted-foreground font-normal">(opcional)</span>
            </label>
            <Input
              id="hire-start-at"
              type="datetime-local"
              value={hireStartAt}
              onChange={(e) => setHireStartAt(e.target.value)}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              Se preenchida, aparece no status do processo do candidato. Você pode definir/corrigir depois.
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmHire} className="bg-emerald-600 hover:bg-emerald-700">
              <UserCheck className="h-4 w-4 mr-2" /> Confirmar contratação
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Editar data de início (pós-contratação) */}
      <AlertDialog open={!!editStartTarget} onOpenChange={(open) => { if (!open) { setEditStartTarget(null); setEditStartValue(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Data e hora de início</AlertDialogTitle>
            <AlertDialogDescription>
              Defina ou corrija a data/hora de início de <strong className="name-display">{editStartTarget?.profiles?.full_name}</strong>. Ela aparece no status do processo do candidato.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5 py-1">
            <label htmlFor="edit-start-at" className="text-sm font-medium text-foreground">Data e hora de início</label>
            <Input
              id="edit-start-at"
              type="datetime-local"
              value={editStartValue}
              onChange={(e) => setEditStartValue(e.target.value)}
              className="w-full"
            />
          </div>
          <AlertDialogFooter className="gap-2">
            {editStartTarget?.work_start_at && (
              <Button
                variant="outline"
                className="mr-auto text-rose-600 border-rose-300 hover:bg-rose-50"
                disabled={setWorkStartAt.isPending}
                onClick={async () => {
                  await setWorkStartAt.mutateAsync({ applicationId: editStartTarget.id, workStartAt: null });
                  setEditStartTarget(null);
                  setEditStartValue("");
                }}
              >
                Remover
              </Button>
            )}
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={!editStartValue || setWorkStartAt.isPending}
              onClick={async (e) => {
                e.preventDefault();
                await setWorkStartAt.mutateAsync({
                  applicationId: editStartTarget.id,
                  workStartAt: dateTimeLocalInputToISO(editStartValue),
                });
                setEditStartTarget(null);
                setEditStartValue("");
              }}
            >
              Salvar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dismiss Confirmation */}
      <AlertDialog open={!!dismissTarget} onOpenChange={(open) => { if (!open) setDismissTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar desligamento</AlertDialogTitle>
            <AlertDialogDescription>
              Deseja desligar <strong className="name-display">{dismissTarget?.profiles?.full_name}</strong> da vaga <strong>{jobTitle}</strong>?
              <br /><br />
              O candidato será marcado como <strong>desligado</strong> e a contagem de contratados será reduzida ({statusCounts.contratado}/{unitJob?.openings || 1} preenchidas).
              {(statusCounts.contratado - 1) < (unitJob?.openings || 1) && unitJob?.status === "preenchida" && (
                <><br /><br />Você será perguntado(a) sobre o que fazer com a vaga em seguida.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDismiss} className="bg-rose-600 hover:bg-rose-700">
              <UserX className="h-4 w-4 mr-2" /> Confirmar desligamento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reopen Decision Dialog — shown after dismissal when job was "preenchida" */}
      <AlertDialog open={reopenDecisionOpen} onOpenChange={setReopenDecisionOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>O que deseja fazer com a vaga?</AlertDialogTitle>
            <AlertDialogDescription>
              O candidato foi desligado. A vaga <strong>{jobTitle}</strong> ficou com vagas disponíveis. Deseja reabri-la para novas candidaturas ou pausá-la?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() =>
                applyJobDecision.mutate(
                  { unitJobId: unitJobId || "", decision: "pausada" },
                  { onSuccess: () => toast.success("Vaga pausada. Ela não aparecerá para novos candidatos.") }
                )
              }
            >
              Não, pausar vaga
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={() =>
                applyJobDecision.mutate(
                  { unitJobId: unitJobId || "", decision: "aberta" },
                  { onSuccess: () => toast.success("Vaga reaberta com sucesso!") }
                )
              }
            >
              Sim, reabrir vaga
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Resume Invite Dialog — convidar candidato em standby a retomar */}
      <ResumeInviteDialog
        open={!!resumeInviteTarget}
        onOpenChange={(open) => { if (!open) setResumeInviteTarget(null); }}
        unitJobId={unitJobId}
        candidate={resumeInviteTarget}
        jobTitle={jobTitle}
        latestInvite={resumeInviteTarget ? latestInviteByCandidate.get(resumeInviteTarget.candidate_id) : undefined}
      />
      <AlertDialog open={!!talentPoolTarget} onOpenChange={(open) => { if (!open) setTalentPoolTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              Adicionar ao Banco de Talentos?
            </AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="name-display">{talentPoolTarget?.profiles?.full_name}</strong> não foi selecionado(a) para esta vaga.
              <br /><br />
              Deseja convidá-lo(a) para o <strong>Banco de Talentos</strong> para oportunidades futuras? Os dados serão reaproveitados automaticamente, sem necessidade de novo cadastro.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setTalentPoolTarget(null)}>
              Não, encerrar candidatura
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-primary hover:bg-primary/90"
              onClick={() => {
                inviteToTalentPool.mutate(
                  { candidateId: talentPoolTarget.candidate_id, unitJobId: unitJobId || "" },
                  {
                    onSuccess: (data: any) => {
                      toast.success(
                        data?.alreadyExists
                          ? `${talentPoolTarget?.profiles?.full_name} já está no Banco de Talentos.`
                          : `${talentPoolTarget?.profiles?.full_name} adicionado(a) ao Banco de Talentos!`
                      );
                      setTalentPoolTarget(null);
                    },
                    onError: (e: any) => {
                      toast.error(e.message);
                      setTalentPoolTarget(null);
                    },
                  }
                );
              }}
            >
              <Users className="h-4 w-4 mr-2" /> Sim, convidar para Banco de Talentos
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
