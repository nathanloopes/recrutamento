import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, UserCheck, Send, Zap, UserPlus, Clock, FileText, RotateCcw, Mail, Phone, MapPin, Calendar, History, Sparkles, Loader2, Download, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdminTalentPool, useDispatchMatching, useReactivateTalent, useTalentPoolLogs } from "@/hooks/useTalentPool";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getStorageClient } from "@/lib/storageDirect";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { PageHelp } from "@/components/ui/page-help";
import { formatDateBR } from "@/lib/dateUtils";
import { useGlobalSettings } from "@/hooks/useGlobalSettings";
import { ReactivationModeDialog } from "@/components/admin/ReactivationModeDialog";
import type { RestartMode } from "@/lib/applicationCycle";
import { useInfiniteScrollSentinel } from "@/hooks/useInfiniteScrollSentinel";

function useTalentPoolConfig() {
  const { data: settings } = useGlobalSettings("talent_pool");
  const get = (key: string, fallback: any = true) => {
    const s = settings?.find((s) => s.key === key);
    return s ? s.value : fallback;
  };
  return {
    enabled: get("enable_talent_pool", true) === true || get("enable_talent_pool", true) === "true",
    allowCrossUnitInvite: get("allow_cross_unit_invite", true) === true || get("allow_cross_unit_invite", true) === "true",
    aiMatchingEnabled: get("ai_matching_enabled", true) === true || get("ai_matching_enabled", true) === "true",
    autoInviteEnabled: get("auto_invite_enabled", true) === true || get("auto_invite_enabled", true) === "true",
    standbyVisibility: get("standby_visibility", "global"),
    minScoreForInvite: Number(get("min_score_for_invite", 60)),
    inviteRadiusKm: Number(get("invite_radius_km", 100)),
    maxActiveProcesses: Number(get("max_active_processes", 1)),
  };
}

const statusLabels: Record<string, string> = {
  active: "Ativo",
  in_process: "Em processo",
  on_hold: "Em espera",
  hired: "Contratado",
  opt_out: "Desativado",
  archived: "Arquivado",
};

const statusColors: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  hired: "default",
  in_process: "secondary",
  on_hold: "outline",
  opt_out: "destructive",
  archived: "secondary",
};

const logEventLabels: Record<string, string> = {
  auto_enrolled: "Cadastro automático",
  opt_in: "Ativou oportunidades",
  opt_out: "Desativou oportunidades",
  invited: "Convidado",
  accepted: "Aceitou convite",
  declined: "Recusou convite",
  reactivated: "Reativado",
  withdrawn: "Saiu do pool",
  status_change: "Status alterado",
};

function CandidateLogs({ candidateId }: { candidateId: string }) {
  const { data: logs } = useTalentPoolLogs(candidateId);
  if (!logs || logs.length === 0) return <p className="text-xs text-muted-foreground">Nenhum registro</p>;
  return (
    <div className="space-y-1.5 max-h-32 overflow-y-auto">
      {logs.slice(0, 8).map((log) => (
        <div key={log.id} className="flex items-start gap-2 text-xs">
          <div className="w-1 h-1 rounded-full bg-primary mt-1.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-foreground">{logEventLabels[log.event] || log.event}</span>
            {log.context?.job_title && <span className="text-muted-foreground"> — {log.context.job_title}</span>}
            <span className="text-muted-foreground ml-1">
              {new Date(log.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// Fetches merged candidate detail from candidates + candidate_profiles + profiles
// (some fields like phone/resume_url live only in candidate_profiles)
function useCandidateFullProfile(candidateId: string | undefined) {
  return useQuery({
    queryKey: ["candidate_full_profile", candidateId],
    enabled: !!candidateId,
    queryFn: async () => {
      const [profRes, candRes, cpRes] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", candidateId!).maybeSingle(),
        supabase.from("candidates").select("*").eq("id", candidateId!).maybeSingle(),
        supabase.from("candidate_profiles").select("*").eq("candidate_id", candidateId!).maybeSingle(),
      ]);
      const prof = (profRes.data as any) || {};
      const cand = (candRes.data as any) || {};
      const cp = (cpRes.data as any) || {};
      // Merge with priority: candidate_profiles > candidates > profiles (most specific wins for non-null)
      const pick = (...vals: any[]) => vals.find((v) => v !== null && v !== undefined && v !== "") ?? null;
      return {
        full_name: pick(cp.full_name, cand.full_name, prof.full_name),
        cpf: pick(cand.cpf, prof.cpf),
        email: pick(cp.email, cand.email, prof.email),
        phone: pick(cp.phone, cand.phone, prof.phone),
        birth_date: pick(cp.birth_date, cand.birth_date, prof.birth_date),
        cep: pick(cp.cep, cand.cep, prof.cep),
        city: pick(cp.city, cand.city, prof.city),
        state: pick(cp.state, cand.state, prof.state),
        gender: pick(cp.gender, cand.gender, prof.gender),
        resume_url: pick(cp.resume_url, cand.resume_url, prof.resume_url),
        address_json: pick(cp.address_json, cand.address_json, prof.address_json),
      };
    },
  });
}

function ResumeIcon({ resumeUrl }: { resumeUrl?: string | null }) {
  if (!resumeUrl) return <span className="text-xs text-muted-foreground">—</span>;

  const handleClick = async () => {
    const storage = await getStorageClient();
    const { data } = await storage.storage
      .from("documents")
      .createSignedUrl(resumeUrl, 60);
    if (data?.signedUrl) {
      const w = window.open(data.signedUrl, "_blank");
      if (!w) window.location.href = data.signedUrl;
    }
  };

  return (
    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleClick} title="Ver currículo">
      <FileText className="h-3.5 w-3.5 text-primary" />
    </Button>
  );
}

function CandidateDetailBody({
  entry,
  unitJobs,
  inviteJobId,
  onInviteJobIdChange,
  onInvite,
  onClose,
  isInviting,
}: {
  entry: any;
  unitJobs: any[];
  inviteJobId: string;
  onInviteJobIdChange: (v: string) => void;
  onInvite: () => void;
  onClose: () => void;
  isInviting: boolean;
}) {
  const { toast } = useToast();
  const { data: p, isLoading } = useCandidateFullProfile(entry.candidate_id);

  const handleDownloadResume = async () => {
    if (!p?.resume_url) return;
    try {
      const storage = await getStorageClient();
      const { data, error } = await storage.storage
        .from("documents")
        .download(p.resume_url);
      if (error || !data) throw error || new Error("download_failed");

      const ext = (p.resume_url.split(".").pop() || "pdf").toLowerCase();
      const safeName = (p.full_name || "candidato").replace(/[^a-zA-Z0-9_-]+/g, "_");
      const filename = `curriculo_${safeName}.${ext}`;

      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("download resume error", e);
      toast({ title: "Erro", description: "Não foi possível baixar o currículo.", variant: "destructive" });
    }
  };

  if (isLoading || !p) {
    return <Skeleton className="h-48 w-full" />;
  }

  const addr = (p.address_json || {}) as any;
  const fullAddress = [addr.street, addr.number, addr.complement, addr.neighborhood].filter(Boolean).join(", ");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* Coluna 1 — dados do candidato */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Users className="h-6 w-6 text-primary" />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-base truncate name-display">{p.full_name || "—"}</h3>
            <p className="text-xs text-muted-foreground">{p.cpf || "CPF não informado"}</p>
          </div>
        </div>

        <div className="border-t pt-3 space-y-2">
          <h4 className="text-sm font-medium">Dados pessoais</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            <div className="flex items-center gap-2 min-w-0">
              <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="truncate">{p.email || "—"}</span>
            </div>
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
              <span>{p.phone || "—"}</span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
              <span>{p.birth_date ? formatDateBR(p.birth_date) : "—"}</span>
            </div>
          </div>
        </div>

        <div className="border-t pt-3 space-y-2">
          <h4 className="text-sm font-medium">Localização</h4>
          <div className="grid grid-cols-1 gap-1 text-sm">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
              <span>{p.city || "—"}/{p.state || "—"} {p.cep ? `· CEP ${p.cep}` : ""}</span>
            </div>
            {fullAddress && (
              <div className="text-xs text-muted-foreground pl-6">{fullAddress}</div>
            )}
          </div>
        </div>

        {p.gender && (
          <div className="border-t pt-3 space-y-2">
            <h4 className="text-sm font-medium">Perfil</h4>
            <div className="flex gap-2 flex-wrap">
              <Badge variant="outline">{p.gender}</Badge>
            </div>
          </div>
        )}

        <div className="border-t pt-3 space-y-2">
          <h4 className="text-sm font-medium flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5" /> Currículo
          </h4>
          {p.resume_url ? (
            <Button variant="outline" size="sm" onClick={handleDownloadResume} className="gap-2">
              <Download className="h-4 w-4" /> Baixar currículo
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">Nenhum currículo anexado.</p>
          )}
        </div>
      </div>

      {/* Coluna 2 — convite + status + histórico */}
      <div className="space-y-4">
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Status no Pool</h4>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div><span className="text-muted-foreground">Score:</span> <span className="font-semibold">{entry.global_score}</span></div>
            <div>
              <span className="text-muted-foreground">Status:</span>{" "}
              <Badge variant={statusColors[entry.status] || "secondary"} className="text-xs">
                {statusLabels[entry.status] || entry.status}
              </Badge>
            </div>
            <div className="col-span-2"><span className="text-muted-foreground">Último Cargo:</span> {entry.jobs?.title || "—"}</div>
            <div className="col-span-2"><span className="text-muted-foreground">Unidade:</span> {entry.units?.name || "—"}</div>
          </div>
        </div>

        <div className="border-t pt-3 space-y-2">
          <h4 className="text-sm font-medium flex items-center gap-1.5">
            <UserPlus className="h-3.5 w-3.5" /> Chamar para Processo Seletivo
          </h4>
          {entry.standby_reason && (
            <p className="text-xs text-muted-foreground">Motivo standby: {entry.standby_reason}</p>
          )}
          <Select value={inviteJobId} onValueChange={onInviteJobIdChange}>
            <SelectTrigger><SelectValue placeholder="Selecione uma vaga aberta" /></SelectTrigger>
            <SelectContent>
              {(unitJobs || []).map((uj: any) => (
                <SelectItem key={uj.id} value={uj.id}>
                  {uj.jobs?.title} — {uj.units?.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-2">
            <Button
              className="flex-1"
              disabled={!inviteJobId || isInviting}
              onClick={onInvite}
            >
              {isInviting ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Enviando...</>
              ) : (
                <><UserPlus className="h-4 w-4 mr-2" /> Chamar para Processo Seletivo</>
              )}
            </Button>
            <Button variant="outline" onClick={onClose}>Fechar</Button>
          </div>
        </div>

        <div className="border-t pt-3 space-y-2">
          <h4 className="text-sm font-medium flex items-center gap-1.5">
            <History className="h-3.5 w-3.5" /> Histórico
          </h4>
          <CandidateLogs candidateId={entry.candidate_id} />
        </div>
      </div>
    </div>
  );
}

export default function AdminTalentPool() {
  const { hasRole, unitIds: myUnitIds } = useAuth();
  // Só o admin da franqueadora vê vagas de todas as unidades. Franqueado/gestor
  // (e rh vinculado a unidades) veem apenas as vagas abertas das suas unidades.
  const scopedUnitIds = !hasRole("admin") && myUnitIds.length > 0 ? myUnitIds : undefined;
  const poolConfig = useTalentPoolConfig();
  const { data: entries, isLoading } = useAdminTalentPool();
  const dispatch = useDispatchMatching();
  const reactivate = useReactivateTalent();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [cargoFilter, setCargoFilter] = useState("");
  const [scoreMin, setScoreMin] = useState("");
  const [scoreMax, setScoreMax] = useState("");
  const [estadoFilter, setEstadoFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedJob, setSelectedJob] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [inviteJobIdByEntry, setInviteJobIdByEntry] = useState<Record<string, string>>({});
  const [aiSuggestions, setAiSuggestions] = useState<any[] | null>(null);
  const [aiSuggestionsLoading, setAiSuggestionsLoading] = useState(false);
  const [reactivateTarget, setReactivateTarget] = useState<{ id: string; name: string } | null>(null);
  const PAGE_SIZE = 20;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const { toast } = useToast();
  const qc = useQueryClient();

  const handleAISuggestions = async () => {
    if (!selectedJob) {
      toast({ title: "Selecione uma vaga", description: "Escolha uma vaga aberta para receber sugestões da IA.", variant: "destructive" });
      return;
    }
    setAiSuggestionsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-talent-suggestions", {
        body: { unit_job_id: selectedJob },
      });
      if (error) throw error;
      setAiSuggestions(data?.suggestions || []);
      toast({ title: "Sugestões geradas", description: `${data?.suggestions?.length || 0} candidato(s) sugeridos pela IA.` });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setAiSuggestionsLoading(false);
    }
  };

  const { data: unitJobs } = useQuery({
    queryKey: ["unit_jobs_open", scopedUnitIds],
    queryFn: async () => {
      let q = supabase
        .from("unit_jobs")
        .select("id, status, unit_id, jobs(title), units(name)")
        .eq("status", "aberta");
      if (scopedUnitIds) q = q.in("unit_id", scopedUnitIds);
      const { data } = await q;
      return data || [];
    },
  });

  const inviteMutation = useMutation({
    mutationFn: async ({ candidateId, unitJobId }: { candidateId: string; unitJobId: string }) => {
      // Block if candidate is already hired
      const { count: hiredCount } = await supabase
        .from("applications")
        .select("id", { count: "exact", head: true })
        .eq("candidate_id", candidateId)
        .eq("status", "contratado");
      if ((hiredCount || 0) > 0) {
        throw new Error("Este candidato já está contratado. Não é possível enviar um convite.");
      }

      // Check exclusivity
      const { count } = await supabase
        .from("applications")
        .select("id", { count: "exact", head: true })
        .eq("candidate_id", candidateId)
        .eq("status", "em_andamento");

      const { data: maxSetting } = await supabase
        .from("global_settings")
        .select("value")
        .eq("category", "talent_pool")
        .eq("key", "max_active_processes")
        .single();

      const maxProcesses = maxSetting ? Number(maxSetting.value) : 1;
      if ((count || 0) >= maxProcesses) {
        throw new Error(`Candidato já possui ${count} processo(s) ativo(s). Limite: ${maxProcesses}.`);
      }

      // Check for existing pending invite
      const { count: existingInvite } = await supabase
        .from("talent_invites")
        .select("id", { count: "exact", head: true })
        .eq("candidate_id", candidateId)
        .eq("unit_job_id", unitJobId)
        .eq("status", "pending");
      if ((existingInvite || 0) > 0) {
        throw new Error("Já existe um convite pendente para este candidato nesta vaga.");
      }

      // Create talent invite (candidate will accept/decline)
      const { error } = await supabase.from("talent_invites").insert({
        candidate_id: candidateId,
        unit_job_id: unitJobId,
        channel: "sistema",
        status: "pending",
      });
      if (error) throw error;

      // Notify the candidate with dedup_key
      const { data: ujData } = await supabase
        .from("unit_jobs")
        .select("jobs:job_id(title), units:unit_id(name)")
        .eq("id", unitJobId)
        .single();
      const jobTitle = (ujData as any)?.jobs?.title || "vaga";
      const unitName = (ujData as any)?.units?.name || "unidade";

      const dedupKey = `talent_invite_sent:${candidateId}:${unitJobId}`;
      await supabase.from("notifications" as any).insert({
        event_type: "talent_invite_sent",
        recipient_id: candidateId,
        channel: "push",
        title: "Convite para Processo Seletivo",
        body: `Você foi convidado(a) para o processo seletivo de ${jobTitle} na ${unitName}. Acesse o Banco de Talentos para responder.`,
        status: "pending",
        action_url: "/banco-de-talentos",
        action_type: "action_required",
        payload: { unit_job_id: unitJobId, job_title: jobTitle, unit_name: unitName },
        dedup_key: dedupKey,
      } as any);
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["admin_talent_invites"] });
      qc.invalidateQueries({ queryKey: ["admin_talent_pool"] });
      qc.invalidateQueries({ queryKey: ["pipeline_candidaturas"] });
      toast({ title: "Convite enviado ao candidato!", description: "O candidato receberá uma notificação para aceitar ou recusar." });
      setExpandedId(null);
      setInviteJobIdByEntry((prev) => {
        const next = { ...prev };
        // limpa seleção da entrada cujo candidate_id corresponde
        Object.keys(next).forEach((k) => {
          if (next[k] === vars.unitJobId) delete next[k];
        });
        return next;
      });
    },
    onError: (e: any) => {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    },
  });

  // Colapsa o card expandido e reseta paginação sempre que filtros/busca mudam
  useEffect(() => {
    setExpandedId(null);
    setVisibleCount(PAGE_SIZE);
  }, [statusFilter, search, cargoFilter, scoreMin, scoreMax, estadoFilter, dateFrom, dateTo]);

  const filtered = (entries || []).filter((e: any) => {
    if (statusFilter !== "all" && e.status !== statusFilter) return false;
    if (search) {
      const name = (e.profiles?.full_name || "").toLowerCase();
      const city = (e.profiles?.city || "").toLowerCase();
      if (!name.includes(search.toLowerCase()) && !city.includes(search.toLowerCase())) return false;
    }
    if (cargoFilter) {
      const jobTitle = ((e as any).jobs?.title || "").toLowerCase();
      if (!jobTitle.includes(cargoFilter.toLowerCase())) return false;
    }
    const minS = scoreMin ? Number(scoreMin) : null;
    const maxS = scoreMax ? Number(scoreMax) : null;
    if (minS !== null && e.global_score < minS) return false;
    if (maxS !== null && e.global_score > maxS) return false;
    if (estadoFilter !== "all" && (e.profiles?.state || "") !== estadoFilter) return false;
    if (dateFrom) {
      const entryDate = new Date(e.created_at).toISOString().slice(0, 10);
      if (entryDate < dateFrom) return false;
    }
    if (dateTo) {
      const entryDate = new Date(e.created_at).toISOString().slice(0, 10);
      if (entryDate > dateTo) return false;
    }
    return true;
  });

  // Recorte paginado: renderiza apenas `visibleCount` candidatos por vez para
  // evitar travar a UI quando o filtro retorna centenas de resultados.
  const visible = filtered.slice(0, visibleCount);
  const hasMore = filtered.length > visible.length;
  const sentinelRef = useInfiniteScrollSentinel<HTMLDivElement>(
    () => setVisibleCount((c) => c + PAGE_SIZE),
    hasMore,
  );

  const allEntries = entries || [];
  const metrics = {
    total: allEntries.length,
    active: allEntries.filter((e: any) => e.status === "active").length,
    onHold: allEntries.filter((e: any) => e.status === "on_hold").length,
    hired: allEntries.filter((e: any) => e.status === "hired").length,
  };

  // Tempo médio em standby (dias) para entries on_hold
  const onHoldEntries = allEntries.filter((e: any) => e.status === "on_hold" && e.created_at);
  const avgStandbyDays = onHoldEntries.length > 0
    ? Math.round(onHoldEntries.reduce((sum: number, e: any) => {
        const days = (Date.now() - new Date(e.last_interaction || e.created_at).getTime()) / (1000 * 60 * 60 * 24);
        return sum + days;
      }, 0) / onHoldEntries.length)
    : 0;

  // Taxa de reaproveitamento: entries que saíram de on_hold para in_process ou hired
  const reusedCount = allEntries.filter((e: any) =>
    e.status === "in_process" || e.status === "hired"
  ).length;
  const totalEligible = allEntries.filter((e: any) =>
    e.status !== "opt_out" && e.status !== "archived"
  ).length;
  const reuseRate = totalEligible > 0 ? Math.round((reusedCount / totalEligible) * 100) : 0;

  if (!poolConfig.enabled) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Banco de Talentos</h1>
          <p className="text-muted-foreground">Módulo desativado pelo administrador via Configurações Globais.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Banco de Talentos</h1>
          <p className="text-muted-foreground">Gerencie e busque talentos da rede</p>
        </div>
        <PageHelp />
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        <Card><CardContent className="p-4 text-center"><Users className="h-5 w-5 mx-auto text-primary mb-1" /><p className="text-2xl font-bold">{metrics.total}</p><p className="text-xs text-muted-foreground">Total</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><UserCheck className="h-5 w-5 mx-auto text-primary mb-1" /><p className="text-2xl font-bold">{metrics.active}</p><p className="text-xs text-muted-foreground">Ativos</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><Clock className="h-5 w-5 mx-auto text-muted-foreground mb-1" /><p className="text-2xl font-bold">{metrics.onHold}</p><p className="text-xs text-muted-foreground">Em Espera</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><Send className="h-5 w-5 mx-auto text-primary mb-1" /><p className="text-2xl font-bold">{metrics.hired}</p><p className="text-xs text-muted-foreground">Contratados</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><Calendar className="h-5 w-5 mx-auto text-muted-foreground mb-1" /><p className="text-2xl font-bold">{avgStandbyDays}<span className="text-sm font-normal">d</span></p><p className="text-xs text-muted-foreground">Tempo médio standby</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><RotateCcw className="h-5 w-5 mx-auto text-primary mb-1" /><p className="text-2xl font-bold">{reuseRate}%</p><p className="text-xs text-muted-foreground">Reaproveitamento</p></CardContent></Card>
      </div>

      {/* Auto-dispatch status */}
      {poolConfig.autoInviteEnabled && (
        <Card className="border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20">
          <CardContent className="p-4 flex items-center gap-3">
            <Zap className="h-5 w-5 text-green-600" />
            <div className="flex-1">
              <p className="text-sm font-medium text-green-700 dark:text-green-300">Disparo automático ativo</p>
              <p className="text-xs text-green-600 dark:text-green-400">
                Quando uma nova vaga é aberta, candidatos com score ≥ {poolConfig.minScoreForInvite} são convidados automaticamente.
                Máximo {poolConfig.maxActiveProcesses} processo(s) simultâneo(s) por candidato.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Dispatch Matching (hidden if ai_matching_enabled = false) */}
      {poolConfig.aiMatchingEnabled && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="h-4 w-4" /> Disparar Matching
            </CardTitle>
          </CardHeader>
          <CardContent className="flex gap-3 items-end flex-wrap">
            <div className="flex-1 min-w-0">
              <Select value={selectedJob} onValueChange={setSelectedJob}>
                <SelectTrigger><SelectValue placeholder="Selecione uma vaga aberta" /></SelectTrigger>
                <SelectContent>
                  {(unitJobs || []).map((uj: any) => (
                    <SelectItem key={uj.id} value={uj.id}>
                      {uj.jobs?.title} — {uj.units?.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={() => selectedJob && dispatch.mutate(selectedJob)}
              disabled={!selectedJob || dispatch.isPending}
            >
              {dispatch.isPending ? "Processando..." : "Disparar"}
            </Button>
            <Button
              variant="outline"
              onClick={handleAISuggestions}
              disabled={!selectedJob || aiSuggestionsLoading}
              className="gap-2"
            >
              {aiSuggestionsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Sugestões IA
            </Button>
          </CardContent>
          {aiSuggestions && aiSuggestions.length > 0 && (
            <CardContent className="pt-0">
              <p className="text-xs font-medium text-muted-foreground mb-2">Candidatos sugeridos pela IA:</p>
              <div className="space-y-1">
                {aiSuggestions.slice(0, 10).map((s: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-sm border rounded px-3 py-1.5">
                    <span className="name-display">{s.full_name || s.candidate_id}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">Score: {s.score ?? s.global_score ?? "—"}</Badge>
                      {s.reason && <span className="text-xs text-muted-foreground">{s.reason}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Filters */}
      <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-3">
        <Input
          placeholder="Buscar por nome ou cidade..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-0 col-span-2 sm:flex-1 sm:max-w-xs"
        />
        <Input
          placeholder="Filtrar por cargo..."
          value={cargoFilter}
          onChange={(e) => setCargoFilter(e.target.value)}
          className="min-w-0 col-span-2 sm:flex-1 sm:max-w-[180px]"
        />
        <Input
          type="number"
          placeholder="Score mín."
          value={scoreMin}
          onChange={(e) => setScoreMin(e.target.value)}
          className="min-w-0 sm:w-24"
        />
        <Input
          type="number"
          placeholder="Score máx."
          value={scoreMax}
          onChange={(e) => setScoreMax(e.target.value)}
          className="min-w-0 sm:w-24"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="min-w-0 col-span-2 sm:w-40"><SelectValue /></SelectTrigger>
          <SelectContent disableSearch>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="active">Ativos</SelectItem>
            <SelectItem value="in_process">Em processo</SelectItem>
            <SelectItem value="on_hold">Em espera (Standby)</SelectItem>
            <SelectItem value="hired">Contratados</SelectItem>
            <SelectItem value="opt_out">Opt-out</SelectItem>
            <SelectItem value="archived">Arquivados</SelectItem>
          </SelectContent>
        </Select>
        <Input
          type="date"
          placeholder="Data de"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="min-w-0 sm:w-36"
          title="Data de entrada (de)"
        />
        <Input
          type="date"
          placeholder="Data até"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="min-w-0 sm:w-36"
          title="Data de entrada (até)"
        />
        <Select value={estadoFilter} onValueChange={setEstadoFilter}>
          <SelectTrigger className="min-w-0 col-span-2 sm:w-36"><SelectValue placeholder="Estado (UF)" /></SelectTrigger>
          <SelectContent disableSearch>
            <SelectItem value="all">Todos os estados</SelectItem>
            {Array.from(new Set((entries || []).map((e: any) => e.profiles?.state).filter(Boolean)))
              .sort()
              .map((uf: string) => (
                <SelectItem key={uf} value={uf}>{uf}</SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>

      {/* Lista expansível */}
      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
        {/* Mobile cards */}
        <div className="md:hidden space-y-3">
          {filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">Nenhum talento encontrado</p>
          ) : (
            visible.map((e: any) => {
              const isExpanded = expandedId === e.id;
              return (
                <Card
                  key={e.id}
                  className={cn(
                    "cursor-pointer transition-shadow",
                    isExpanded && "ring-2 ring-primary/40 shadow-md",
                  )}
                  onClick={() => setExpandedId(isExpanded ? null : e.id)}
                >
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate name-display">{e.profiles?.full_name || "—"}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant={statusColors[e.status] || "secondary"} className="text-xs">
                          {statusLabels[e.status] || e.status}
                        </Badge>
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 text-muted-foreground transition-transform duration-200",
                            isExpanded && "rotate-180",
                          )}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{e.profiles?.city || "—"}/{e.profiles?.state || "—"}</span>
                      <span>Score: <span className="font-semibold text-foreground">{e.global_score}</span></span>
                    </div>
                    {e.status === "on_hold" && !isExpanded && (
                      <div className="flex gap-2 pt-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-amber-600 border-amber-300"
                          onClick={(ev) => { ev.stopPropagation(); setReactivateTarget({ id: e.candidate_id, name: e.profiles?.full_name || "candidato" }); }}
                          disabled={reactivate.isPending}
                        >
                          <RotateCcw className="h-3 w-3 mr-1" /> Reativar
                        </Button>
                      </div>
                    )}
                    <div
                      className={cn(
                        "grid transition-all duration-300 ease-out",
                        isExpanded ? "grid-rows-[1fr] opacity-100 pt-3 mt-1 border-t" : "grid-rows-[0fr] opacity-0",
                      )}
                    >
                      <div className="overflow-hidden min-h-0" onClick={(ev) => ev.stopPropagation()}>
                        {isExpanded && (
                          <CandidateDetailBody
                            entry={e}
                            unitJobs={unitJobs || []}
                            inviteJobId={inviteJobIdByEntry[e.id] || ""}
                            onInviteJobIdChange={(v) => setInviteJobIdByEntry((p) => ({ ...p, [e.id]: v }))}
                            onInvite={() => inviteMutation.mutate({
                              candidateId: e.candidate_id,
                              unitJobId: inviteJobIdByEntry[e.id] || "",
                            })}
                            onClose={() => setExpandedId(null)}
                            isInviting={inviteMutation.isPending}
                          />
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>

        {/* Desktop table */}
        <div className="border rounded-lg hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Cidade/Estado</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Status Pool</TableHead>
                <TableHead>Status Candidatura</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>CV</TableHead>
                <TableHead>Último Cargo</TableHead>
                <TableHead>Unidade Origem</TableHead>
                <TableHead>Última interação</TableHead>
                <TableHead>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12} className="text-center text-muted-foreground py-8">
                    Nenhum talento encontrado
                  </TableCell>
                </TableRow>
              ) : (
                visible.flatMap((e: any) => {
                  const isExpanded = expandedId === e.id;
                  const rows = [
                    <TableRow
                      key={e.id}
                      className={cn(
                        "cursor-pointer hover:bg-muted/50",
                        isExpanded && "bg-muted/40",
                      )}
                      onClick={() => setExpandedId(isExpanded ? null : e.id)}
                    >
                      <TableCell className="w-8">
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 text-muted-foreground transition-transform duration-200",
                            isExpanded && "rotate-180",
                          )}
                        />
                      </TableCell>
                      <TableCell className="font-medium name-display">{e.profiles?.full_name || "—"}</TableCell>
                      <TableCell>{e.profiles?.city || "—"}/{e.profiles?.state || "—"}</TableCell>
                      <TableCell>{e.global_score}</TableCell>
                      <TableCell>
                        <Badge variant={statusColors[e.status] || "secondary"}>
                          {statusLabels[e.status] || e.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const appStatus = e._app_status ||
                            (e.status === "hired" ? "contratado" :
                             e.status === "in_process" ? "em_andamento" :
                             e.status === "on_hold" ? "pendente" : null);
                          if (!appStatus || appStatus === "desistente" || appStatus === "desligado") {
                            return <span className="text-xs text-muted-foreground">Em Busca</span>;
                          }
                          const label =
                            appStatus === "contratado" ? "Contratado" :
                            appStatus === "em_andamento" ? "Processo Seletivo" :
                            appStatus === "aprovado" ? "Aprovado" :
                            appStatus === "pendente" ? "Aguardando" :
                            appStatus === "reprovado" ? "Lista de Oportunidade" : "Em Busca";
                          const variant: "default" | "secondary" | "outline" =
                            appStatus === "contratado" ? "default" :
                            appStatus === "em_andamento" || appStatus === "aprovado" ? "secondary" : "outline";
                          return <Badge variant={variant} className="text-xs">{label}</Badge>;
                        })()}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {e.entry_origin === "manual" ? "Manual" : e.entry_origin === "application_auto" ? "Candidatura" : e.entry_origin === "rejected_invited" ? "Convidado" : "Automático"}
                        </Badge>
                      </TableCell>
                      <TableCell onClick={(ev) => ev.stopPropagation()}>
                        <ResumeIcon resumeUrl={e.profiles?.resume_url} />
                      </TableCell>
                      <TableCell className="text-xs">{(e as any).jobs?.title || "—"}</TableCell>
                      <TableCell className="text-xs">{(e as any).units?.name || "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(e.last_interaction).toLocaleDateString("pt-BR")}
                      </TableCell>
                      <TableCell onClick={(ev) => ev.stopPropagation()}>
                        {e.status === "on_hold" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-amber-600 border-amber-300"
                            onClick={() => setReactivateTarget({ id: e.candidate_id, name: e.profiles?.full_name || "candidato" })}
                            disabled={reactivate.isPending}
                          >
                            <RotateCcw className="h-3 w-3 mr-1" /> Reativar
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>,
                  ];

                  if (isExpanded) {
                    rows.push(
                      <TableRow key={`${e.id}-expanded`} className="bg-muted/20 hover:bg-muted/20">
                        <TableCell colSpan={12} className="p-0">
                          <div className="p-5 animate-accordion-down">
                            <CandidateDetailBody
                              entry={e}
                              unitJobs={unitJobs || []}
                              inviteJobId={inviteJobIdByEntry[e.id] || ""}
                              onInviteJobIdChange={(v) => setInviteJobIdByEntry((p) => ({ ...p, [e.id]: v }))}
                              onInvite={() => inviteMutation.mutate({
                                candidateId: e.candidate_id,
                                unitJobId: inviteJobIdByEntry[e.id] || "",
                              })}
                              onClose={() => setExpandedId(null)}
                              isInviting={inviteMutation.isPending}
                            />
                          </div>
                        </TableCell>
                      </TableRow>,
                    );
                  }
                  return rows;
                })
              )}
            </TableBody>
          </Table>
        </div>

        {filtered.length > 0 && (
          <div className="flex flex-col items-center justify-center gap-2 pt-2">
            <p className="text-xs text-muted-foreground">
              Mostrando <span className="font-medium text-foreground">{visible.length}</span> de{" "}
              <span className="font-medium text-foreground">{filtered.length}</span> candidato(s)
            </p>
            {hasMore && (
              <>
                <div ref={sentinelRef} aria-hidden className="h-1 w-full" />
                <p className="text-xs text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" /> Carregando mais…
                </p>
              </>
            )}
          </div>
        )}
        </>
      )}

      <ReactivationModeDialog
        open={!!reactivateTarget}
        onOpenChange={(v) => { if (!v) setReactivateTarget(null); }}
        candidateName={reactivateTarget?.name}
        loading={reactivate.isPending}
        onConfirm={async (mode: RestartMode) => {
          if (!reactivateTarget) return;
          await reactivate.mutateAsync({ candidateId: reactivateTarget.id, mode });
          setReactivateTarget(null);
        }}
      />
    </div>
  );
}
