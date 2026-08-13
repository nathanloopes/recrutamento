import { useState, useMemo, useEffect, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { MaskedDateInput } from "@/components/ui/masked-date-input";
import { ymdToLocalDate, dateToLocalYMD, formatDateBR, formatRelativeDateTimeBR } from "@/lib/dateUtils";
import { TimeInput } from "@/components/ui/time-input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAllSlots, useCreateSlot, useDeleteSlot, useUpdateSlot, useInterviews, useInterviewsInfinite, useInterviewsStats, useUpdateInterview, useInterviewsByMonth, usePendingApprovals } from "@/hooks/useScheduling";
import { useSchedulingRealtime } from "@/hooks/useSchedulingRealtime";
import { useSendNotification } from "@/hooks/useNotifications";
import { useInterviewMetrics } from "@/hooks/useInterviewAudit";
import { useInterviewDiagnostic, useRecordAttendance } from "@/hooks/useAttendanceLogs";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Trash2, Pencil, CheckCircle2, XCircle, AlertTriangle, Loader2, BookOpen, Eye, BarChart3, CalendarDays, List, Download, Trophy, Brain, ClipboardCheck, Clock, Video, ExternalLink, ArrowUp, ArrowDown, ArrowUpDown, ChevronDown, MapPin, Send, RotateCcw, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { ResumeInviteDialog } from "@/components/admin/ResumeInviteDialog";

function ModalityCheckboxes({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const presencial = value === "presencial" || value === "ambos";
  const online = value === "online" || value === "ambos";

  const update = (next: { p: boolean; o: boolean }) => {
    if (next.p && next.o) onChange("ambos");
    else if (next.p) onChange("presencial");
    else if (next.o) onChange("online");
    else onChange("");
  };

  return (
    <div className="flex gap-6 pt-2">
      <label className="flex items-center gap-2 cursor-pointer">
        <Checkbox
          checked={presencial}
          onCheckedChange={(c) => update({ p: !!c, o: online })}
        />
        <span className="text-sm">Presencial</span>
      </label>
      <label className="flex items-center gap-2 cursor-pointer">
        <Checkbox
          checked={online}
          onCheckedChange={(c) => update({ p: presencial, o: !!c })}
        />
        <span className="text-sm">Online</span>
      </label>
    </div>
  );
}
import { toast } from "sonner";
import { GuidedInterview } from "@/components/admin/GuidedInterview";
import { useAuth } from "@/contexts/AuthContext";
import { PageHelp } from "@/components/ui/page-help";
import { CalendarView } from "@/components/admin/scheduling/CalendarView";
import { WeekDayView } from "@/components/admin/scheduling/WeekDayView";
import { AgendaListView } from "@/components/admin/scheduling/AgendaListView";
import { ApprovalPanel } from "@/components/admin/scheduling/ApprovalPanel";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { BlockedDatesPanel } from "@/components/admin/scheduling/BlockedDatesPanel";
import { ScheduleSimulator } from "@/components/admin/scheduling/ScheduleSimulator";
import { InterviewDecisionDialog, type InterviewDecisionTarget } from "@/components/admin/scheduling/InterviewDecisionDialog";
import { formatModality } from "@/lib/modalityLabel";
import { TestPhasePanel } from "@/components/admin/scheduling/TestPhasePanel";
import { TestBookingsTab } from "@/components/admin/scheduling/TestBookingsTab";
import { SchedulingConfigSection } from "@/components/admin/settings/SchedulingConfigSection";

const DAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

const statusBadge: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending_approval: { label: "Pendente Aprovação", variant: "secondary" },
  confirmed: { label: "Confirmada", variant: "default" },
  rescheduled: { label: "Remarcada", variant: "secondary" },
  cancelled: { label: "Cancelada", variant: "outline" },
  completed: { label: "Concluída", variant: "default" },
  no_show: { label: "Não compareceu", variant: "destructive" },
};

// Status do candidato é resolvido por getCandidateStatus (fonte única em src/lib/candidateStatus.ts)

export default function Scheduling() {
  useSchedulingRealtime();
  const { hasRole, unitIds: myUnitIds } = useAuth();
  const isSuperAdmin = hasRole("admin");
  const [selectedUnit, setSelectedUnit] = useState<string>("");
  const [activeTab, setActiveTab] = useState<string>("agenda");
  const [newSlotOpen, setNewSlotOpen] = useState(false);
  const [deletingSlotId, setDeletingSlotId] = useState<string | null>(null);
  const [editingSlot, setEditingSlot] = useState<any>(null);
  const [expandedSlotId, setExpandedSlotId] = useState<string | null>(null);
  const [editSlotData, setEditSlotData] = useState({ day_of_week: "1", modality: "presencial", periods: [{ start_time: "09:00", end_time: "17:00", auto_confirm: false }] });
  const [newSlot, setNewSlot] = useState({ day_of_week: "1", modality: "presencial", periods: [{ start_time: "09:00", end_time: "12:00", auto_confirm: false }, { start_time: "13:00", end_time: "17:00", auto_confirm: false }] });
  const [guidedInterview, setGuidedInterview] = useState<any>(null);
  const [feedbackView, setFeedbackView] = useState<any>(null);
  const [resumeInviteTarget, setResumeInviteTarget] = useState<any>(null);

  // Agenda state
  const [agendaMode, setAgendaMode] = useState<"calendar" | "list">("calendar");
  const [calendarSubMode, setCalendarSubMode] = useState<"month" | "week" | "day">("month");
  const [agendaDate, setAgendaDate] = useState(new Date());

  // Interview filters
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  // Audit filters
  const [auditDateFrom, setAuditDateFrom] = useState<string>("");
  const [auditDateTo, setAuditDateTo] = useState<string>("");
  const [diagnosticResult, setDiagnosticResult] = useState<any>(null);
  const [sortBy, setSortBy] = useState<"datetime" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [nameSearch, setNameSearch] = useState<string>("");
  const [cargoFilter, setCargoFilter] = useState<string>("");
  const toggleSort = (key: "datetime") => {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir("asc");
    }
  };
  const SortIcon = ({ k }: { k: "datetime" }) => {
    if (sortBy !== k) return <ArrowUpDown className="inline h-3 w-3 ml-1 opacity-50" />;
    return sortDir === "asc" ? <ArrowUp className="inline h-3 w-3 ml-1" /> : <ArrowDown className="inline h-3 w-3 ml-1" />;
  };

  const diagnostic = useInterviewDiagnostic();
  const recordAttendance = useRecordAttendance();

  const { data: units } = useQuery({
    queryKey: ["units_list", isSuperAdmin, myUnitIds],
    queryFn: async () => {
      let q = supabase.from("units").select("id, name").eq("is_active", true).order("name");
      if (!isSuperAdmin && myUnitIds.length > 0) {
        q = q.in("id", myUnitIds);
      }
      const { data, error } = await q;
      if (error) throw error;
      // Auto-select if only one unit
      if (data?.length === 1 && !selectedUnit) {
        setSelectedUnit(data[0].id);
      }
      return data;
    },
  });

  const interviewFilters: any = {};
  if (selectedUnit) interviewFilters.unitId = selectedUnit;
  // Non-admin sem unidade selecionada: filtrar por todas as unidades vinculadas
  if (!selectedUnit && !isSuperAdmin && myUnitIds.length > 0) interviewFilters.unitIds = myUnitIds;
  if (statusFilter && statusFilter !== "all") interviewFilters.status = statusFilter;
  if (dateFrom) interviewFilters.dateFrom = dateFrom;
  if (dateTo) interviewFilters.dateTo = dateTo;
  if (nameSearch.trim()) interviewFilters.name = nameSearch.trim();


  const scopedUnitIds = !isSuperAdmin && myUnitIds.length > 0 ? myUnitIds : undefined;

  const { data: slots, isLoading: slotsLoading } = useAllSlots(selectedUnit || undefined, !selectedUnit ? scopedUnitIds : undefined);
  const {
    data: interviewsPages,
    isLoading: interviewsLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInterviewsInfinite(
    Object.keys(interviewFilters).length > 0 ? interviewFilters : undefined,
    30,
  );
  const interviews = useMemo(
    () => (interviewsPages?.pages.flatMap((p: any) => p.rows) ?? []) as any[],
    [interviewsPages],
  );
  // Cargos disponíveis para filtro = apenas os que aparecem nas entrevistas carregadas.
  const availableCargos = useMemo(() => {
    const set = new Set<string>();
    for (const i of interviews) {
      const t = i.applications?.unit_jobs?.jobs?.title;
      if (t) set.add(t);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [interviews]);
  const { data: interviewsStats } = useInterviewsStats({
    unitId: selectedUnit || undefined,
    unitIds: !selectedUnit && !isSuperAdmin && myUnitIds.length > 0 ? myUnitIds : undefined,
  });

  // Sentinela para carregar mais entrevistas ao rolar
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!hasNextPage || !loadMoreRef.current) return;
    const el = loadMoreRef.current;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !isFetchingNextPage) {
        fetchNextPage();
      }
    }, { rootMargin: "200px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);


  // Decisões já registradas (para esconder botões aprovar/standby quando já houve decisão)
  // Inclui entrevistas concluídas E entrevistas confirmadas com presença confirmada (prontas para decisão).
  const decidableInterviewIds = (interviews || [])
    .filter((i: any) => i.status === "completed" || (i.status === "confirmed" && !!i.confirmed_at))
    .map((i: any) => i.id);
  const { data: existingDecisions } = useQuery({
    queryKey: ["scheduling_interview_decisions", decidableInterviewIds.sort().join(",")],
    enabled: decidableInterviewIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("interview_feedback")
        .select("interview_id, decision")
        .in("interview_id", decidableInterviewIds);
      return data || [];
    },
  });
  const [optimisticDecidedIds, setOptimisticDecidedIds] = useState<string[]>([]);
  const decidedIds = useMemo(
    () => new Set([
      ...(existingDecisions || [])
        .filter((d: any) => ["aprovado", "presencial", "standby", "encerrado"].includes(String(d.decision || "")))
        .map((d: any) => d.interview_id),
      ...optimisticDecidedIds,
    ]),
    [existingDecisions, optimisticDecidedIds]
  );

  // Convites de retomada manuais (channel='sistema') para standby candidates visíveis
  const standbyUnitJobIds = useMemo(
    () => Array.from(new Set((interviews || []).filter((i: any) => i.applications?.status === "standby").map((i: any) => i.unit_job_id).filter(Boolean))),
    [interviews]
  );
  const { data: standbyInvites } = useQuery({
    queryKey: ["scheduling_standby_invites", standbyUnitJobIds.sort().join(",")],
    enabled: standbyUnitJobIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("talent_invites")
        .select("id, candidate_id, unit_job_id, status, channel, restart_mode, invited_at, responded_at")
        .in("unit_job_id", standbyUnitJobIds)
        .order("invited_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
  const latestInviteByCandidate = useMemo(() => {
    const m = new Map<string, any>();
    for (const inv of (standbyInvites || [])) {
      if ((inv as any).channel !== "sistema") continue;
      if (!m.has(inv.candidate_id)) m.set(inv.candidate_id, inv);
    }
    return m;
  }, [standbyInvites]);

  const [decisionTarget, setDecisionTarget] = useState<InterviewDecisionTarget | null>(null);
  const createSlot = useCreateSlot();
  const deleteSlot = useDeleteSlot();
  const updateSlot = useUpdateSlot();
  const updateInterview = useUpdateInterview();
  const sendNotification = useSendNotification();

  // Agenda data
  const { data: monthInterviews, isLoading: monthLoading } = useInterviewsByMonth(
    selectedUnit || undefined,
    agendaDate.getFullYear(),
    agendaDate.getMonth(),
    !selectedUnit ? scopedUnitIds : undefined
  );

  // Pending approvals
  const { data: pendingApprovals } = usePendingApprovals(
    selectedUnit || undefined,
    !selectedUnit ? scopedUnitIds : undefined
  );
  const pendingCount = pendingApprovals?.length || 0;

  const auditFilters = {
    ...(auditDateFrom ? { dateFrom: auditDateFrom } : {}),
    ...(auditDateTo ? { dateTo: auditDateTo } : {}),
    ...(!isSuperAdmin && myUnitIds.length > 0 ? { unitIds: myUnitIds } : {}),
  };
  const { data: auditData, isLoading: auditLoading } = useInterviewMetrics(
    Object.keys(auditFilters).length > 0 ? auditFilters : undefined
  );

  const handleCreateSlot = async () => {
    if (!selectedUnit) { toast.error("Selecione uma unidade"); return; }
    const validPeriods = newSlot.periods.filter(p => p.start_time && p.end_time && p.start_time < p.end_time);
    if (validPeriods.length === 0) { toast.error("Adicione pelo menos um período válido"); return; }
    try {
      for (const period of validPeriods) {
        await createSlot.mutateAsync({
          unit_id: selectedUnit,
          day_of_week: parseInt(newSlot.day_of_week),
          start_time: period.start_time,
          end_time: period.end_time,
          modality: newSlot.modality,
          auto_confirm: !!period.auto_confirm,
        });
      }
      toast.success(`${validPeriods.length} período(s) criado(s)!`);
      setNewSlotOpen(false);
      setNewSlot({ day_of_week: "1", modality: "presencial", periods: [{ start_time: "09:00", end_time: "12:00", auto_confirm: false }, { start_time: "13:00", end_time: "17:00", auto_confirm: false }] });
    } catch (e: any) { toast.error(e.message); }
  };

  const handleStatusChange = async (id: string, status: string) => {
    try {
      await updateInterview.mutateAsync({ id, status });

      if (status === "cancelled") {
        const interview = interviews?.find((i: any) => i.id === id);
        if (interview?.candidate_id) {
          sendNotification.mutate({
            eventType: "interview_cancelled",
            recipientId: interview.candidate_id,
            payload: {
              nome: interview?.profiles?.full_name || "",
              _title: "Entrevista cancelada",
              _body: "Sua entrevista foi cancelada. Entraremos em contato para reagendamento.",
            },
          });
        }
      }

      if (status === "no_show") {
        const interview = interviews?.find((i: any) => i.id === id);
        if (interview?.unit_id) {
          // Notify unit admins about no-show
          try {
            const { getAdminRecipientIds } = await import("@/lib/notificationRoutes");
            const recipientIds = await getAdminRecipientIds(interview.unit_id);
            for (const rid of recipientIds) {
              sendNotification.mutate({
                eventType: "interview_no_show",
                recipientId: rid,
                payload: {
                  _title: "Não comparecimento registrado",
                  _body: `O candidato ${interview?.profiles?.full_name || ""} não compareceu à entrevista de ${interview.scheduled_date}.`,
                },
              });
            }
          } catch (e) {
            console.warn("Failed to notify about no-show:", e);
          }
        }
      }

      toast.success("Status atualizado!");
    } catch (e: any) { toast.error(e.message); }
  };

  const todayCount = interviewsStats?.today ?? 0;
  const noShowCount = interviewsStats?.noShow ?? 0;
  const totalInterviews = interviewsStats?.total ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Agendamento</h1>
          <p className="text-muted-foreground text-sm">Gerencie horários, entrevistas e auditoria</p>
        </div>
        <PageHelp />
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <Card className="flex-1"><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-foreground">{todayCount}</p><p className="text-xs text-muted-foreground">Agendadas hoje</p></CardContent></Card>
        {pendingCount > 0 && (
          <Card className="flex-1 border-amber-300"><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-amber-500">{pendingCount}</p><p className="text-xs text-muted-foreground">Pendentes Aprovação</p></CardContent></Card>
        )}
        <Card className="flex-1"><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-destructive">{noShowCount}</p><p className="text-xs text-muted-foreground">Não compareceram</p></CardContent></Card>
        <Card className="flex-1"><CardContent className="p-4 text-center"><p className="text-2xl font-bold text-foreground">{totalInterviews}</p><p className="text-xs text-muted-foreground">Total entrevistas</p></CardContent></Card>
      </div>

      {activeTab !== "test" && activeTab !== "settings" && (
        <div className="max-w-xs">
          <Label>Unidade</Label>
          <Select value={selectedUnit} onValueChange={setSelectedUnit}>
            <SelectTrigger><SelectValue placeholder="Todas as unidades" /></SelectTrigger>
            <SelectContent>
              {units?.map((u: any) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>

        <TabsList className="w-full justify-start overflow-x-auto flex-nowrap">
          <TabsTrigger value="agenda" className="flex items-center gap-1 shrink-0"><CalendarDays className="h-3.5 w-3.5 shrink-0" />Agenda</TabsTrigger>
          {pendingCount > 0 && (
            <TabsTrigger value="approvals" className="flex items-center gap-1 shrink-0">
              <Clock className="h-3.5 w-3.5 shrink-0" />
              Aprovações
              <Badge variant="destructive" className="ml-1 h-5 min-w-5 px-1 text-[10px]">{pendingCount}</Badge>
            </TabsTrigger>
          )}
          <TabsTrigger value="interviews" className="shrink-0">Entrevistas</TabsTrigger>
          <TabsTrigger value="test_bookings" className="flex items-center gap-1 shrink-0"><CalendarDays className="h-3.5 w-3.5 shrink-0" />Testes Agendados</TabsTrigger>
          <TabsTrigger value="audit" className="flex items-center gap-1 shrink-0"><BarChart3 className="h-3.5 w-3.5 shrink-0" />Auditoria</TabsTrigger>
          <TabsTrigger value="blocked" className="flex items-center gap-1 shrink-0"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />Bloqueios</TabsTrigger>
          <TabsTrigger value="ia" className="flex items-center gap-1 shrink-0"><Brain className="h-3.5 w-3.5 shrink-0" />IA Diagnóstico</TabsTrigger>
          <TabsTrigger value="settings" className="flex items-center gap-1 shrink-0"><Settings className="h-3.5 w-3.5 shrink-0" />Configurações de Horários</TabsTrigger>
        </TabsList>

        {/* ===== APROVAÇÕES TAB ===== */}
        <TabsContent value="approvals">
          <ApprovalPanel unitId={selectedUnit || undefined} unitIds={scopedUnitIds} />
        </TabsContent>

        {/* ===== AGENDA TAB ===== */}
        <TabsContent value="agenda">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-3">
              <div>
                <CardTitle>Agenda Unificada</CardTitle>
                <CardDescription>Visão estratégica de todas as entrevistas</CardDescription>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center border rounded-md overflow-hidden">
                  <Button
                    size="sm"
                    variant={agendaMode === "calendar" ? "default" : "ghost"}
                    className="rounded-none h-8 text-xs"
                    onClick={() => setAgendaMode("calendar")}
                  >
                    <CalendarDays className="h-3.5 w-3.5 mr-1" />Calendário
                  </Button>
                  <Button
                    size="sm"
                    variant={agendaMode === "list" ? "default" : "ghost"}
                    className="rounded-none h-8 text-xs"
                    onClick={() => setAgendaMode("list")}
                  >
                    <List className="h-3.5 w-3.5 mr-1" />Lista
                  </Button>
                </div>
                {agendaMode === "calendar" && (
                  <div className="flex items-center border rounded-md overflow-hidden">
                    {(["month", "week", "day"] as const).map((m) => (
                      <Button
                        key={m}
                        size="sm"
                        variant={calendarSubMode === m ? "secondary" : "ghost"}
                        className="rounded-none h-8 text-xs px-3"
                        onClick={() => setCalendarSubMode(m)}
                      >
                        {m === "month" ? "Mês" : m === "week" ? "Semana" : "Dia"}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {monthLoading ? (
                <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : agendaMode === "list" ? (
                <AgendaListView interviews={monthInterviews || []} />
              ) : calendarSubMode === "month" ? (
                <CalendarView interviews={monthInterviews || []} isLoading={monthLoading} maxPerDay={10} onMonthChange={setAgendaDate} />
              ) : (
                <WeekDayView
                  interviews={monthInterviews || []}
                  mode={calendarSubMode}
                  currentDate={agendaDate}
                  onDateChange={setAgendaDate}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>






        {/* ===== ENTREVISTAS TAB ===== */}
        <TabsContent value="interviews">
          <Card>
            <CardHeader>
              <CardTitle>Entrevistas</CardTitle>
              <CardDescription>Lista de entrevistas agendadas</CardDescription>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 pt-2">
                <div>
                  <Label className="text-xs">Unidade</Label>
                  <Select value={selectedUnit || "all"} onValueChange={(v) => setSelectedUnit(v === "all" ? "" : v)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todas as unidades" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas as unidades</SelectItem>
                      {units?.map((u: any) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Buscar candidato</Label>
                  <Input
                    value={nameSearch}
                    onChange={(e) => setNameSearch(e.target.value)}
                    placeholder="Nome do candidato"
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-xs">Cargo</Label>
                  <Select value={cargoFilter || "all"} onValueChange={(v) => setCargoFilter(v === "all" ? "" : v)} disabled={availableCargos.length === 0}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos os cargos" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos os cargos</SelectItem>
                      {availableCargos.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Status</Label>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="pending_approval">Pendente Aprovação</SelectItem>
                      <SelectItem value="confirmed">Confirmada</SelectItem>
                      <SelectItem value="completed">Concluída</SelectItem>
                      <SelectItem value="no_show">Não compareceu</SelectItem>
                      <SelectItem value="cancelled">Cancelada</SelectItem>
                      <SelectItem value="rescheduled">Remarcada</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">De</Label>
                  <MaskedDateInput value={ymdToLocalDate(dateFrom)} onChange={d => setDateFrom(dateToLocalYMD(d))} format="dd/MM/yyyy" placeholder="De" size="sm" />
                </div>
                <div>
                  <Label className="text-xs">Até</Label>
                  <MaskedDateInput value={ymdToLocalDate(dateTo)} onChange={d => setDateTo(dateToLocalYMD(d))} format="dd/MM/yyyy" placeholder="Até" size="sm" />
                </div>
                {(statusFilter || dateFrom || dateTo || nameSearch || cargoFilter) && (
                  <Button size="sm" variant="ghost" className="mt-auto h-8 text-xs" onClick={() => { setStatusFilter(""); setDateFrom(""); setDateTo(""); setNameSearch(""); setCargoFilter(""); }}>
                    Limpar
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {interviewsLoading ? <div className="flex justify-center p-4"><Loader2 className="h-6 w-6 animate-spin" /></div> :
                !interviews?.length ? <p className="text-muted-foreground text-sm text-center py-4">Nenhuma entrevista encontrada.</p> :
                <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Candidato</TableHead><TableHead>Cargo</TableHead><TableHead>Unidade</TableHead><TableHead className="cursor-pointer select-none" onClick={() => toggleSort("datetime")}>Data/Hora<SortIcon k="datetime" /></TableHead><TableHead>Modalidade</TableHead><TableHead>Status</TableHead><TableHead className="text-center">Ações</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(() => {
                      const q = nameSearch.trim().toLocaleLowerCase("pt-BR");
                      let filtered = q
                        ? interviews.filter((i: any) => (i.profiles?.full_name || "").toLocaleLowerCase("pt-BR").includes(q))
                        : interviews;
                      if (cargoFilter) {
                        filtered = filtered.filter((i: any) => (i.applications?.unit_jobs?.jobs?.title || "") === cargoFilter);
                      }
                      const list = sortBy ? [...filtered].sort((a: any, b: any) => {
                        const dir = sortDir === "asc" ? 1 : -1;
                        if (sortBy === "datetime") {
                          const today = new Date();
                          const todayYMD = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
                          const av = `${a.scheduled_date || ""}T${a.scheduled_time || ""}`;
                          const bv = `${b.scheduled_date || ""}T${b.scheduled_time || ""}`;
                          const aPast = (a.scheduled_date || "") < todayYMD;
                          const bPast = (b.scheduled_date || "") < todayYMD;
                          if (aPast !== bPast) return (aPast ? 1 : -1) * dir;
                          const cmp = aPast ? bv.localeCompare(av) : av.localeCompare(bv);
                          return cmp * dir;
                        }
                        return 0;
                      }) : filtered;
                      return list;
                    })().map((i: any) => {
                      const appStatus = i.applications?.status;
                      const interviewStatus = appStatus === "standby"
                        ? { label: "Standby", variant: "secondary" as const }
                        : (statusBadge[i.status] || { label: i.status || "—", variant: "outline" as const });
                      return (
                        <TableRow key={i.id}>
                          <TableCell className="font-medium name-display">{i.profiles?.full_name || "—"}</TableCell>
                          <TableCell>{i.applications?.unit_jobs?.jobs?.title || "—"}</TableCell>
                          <TableCell>{i.units?.name || "—"}</TableCell>
                          <TableCell>{formatRelativeDateTimeBR(i.scheduled_date, i.scheduled_time)}</TableCell>
                          <TableCell><Badge variant="outline">{formatModality(i.modality)}</Badge></TableCell>
                          <TableCell>
                            <Badge variant={interviewStatus.variant}>{interviewStatus.label}</Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="flex w-full items-center justify-center gap-1">
                            {i.status === "confirmed" && (
                              <>
                                {i.modality === "online" && (
                                  (i.meeting_provider === "livekit" || (!i.meeting_provider && i.meeting_link?.includes("/entrevista-online/"))) ? (
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      title="Entrar na sala (LiveKit)"
                                      onClick={() => { window.location.href = `/entrevista-online/${i.id}`; }}
                                    >
                                      <Video className="h-4 w-4 text-primary" />
                                    </Button>
                                  ) : i.meeting_link ? (
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      title="Abrir link da reunião"
                                      onClick={() => window.open(i.meeting_link, "_blank", "noopener,noreferrer")}
                                    >
                                      <ExternalLink className="h-4 w-4 text-primary" />
                                    </Button>
                                  ) : null
                                )}
                                <Button size="icon" variant="ghost" title="Roteiro" onClick={() => setGuidedInterview(i)}><BookOpen className="h-4 w-4 text-primary" /></Button>
                                <Button size="icon" variant="ghost" title="Registrar Comparecimento" onClick={async () => {
                                  try {
                                    await recordAttendance.mutateAsync({
                                      interview_id: i.id,
                                      candidate_id: i.candidate_id,
                                      unit_id: i.unit_id,
                                      attendance_status: "compareceu",
                                      check_in_time: new Date().toISOString(),
                                    });
                                    toast.success("Comparecimento registrado!");
                                  } catch (e: any) { toast.error(e.message); }
                                }}><ClipboardCheck className="h-4 w-4" style={{ color: "hsl(142 76% 36%)" }} /></Button>
                                <Button size="icon" variant="ghost" title="Não compareceu" onClick={() => handleStatusChange(i.id, "no_show")}><AlertTriangle className="h-4 w-4 text-amber-500" /></Button>
                                <Button size="icon" variant="ghost" title="Cancelar" onClick={() => handleStatusChange(i.id, "cancelled")}><XCircle className="h-4 w-4 text-destructive" /></Button>
                              </>
                            )}
                            {i.status === "completed" && (
                              <>
                                <Button size="icon" variant="ghost" title="Roteiro" onClick={() => setGuidedInterview(i)}><BookOpen className="h-4 w-4 text-primary" /></Button>
                                <Button size="icon" variant="ghost" title="Ver Feedback" onClick={() => setFeedbackView(i)}><Eye className="h-4 w-4 text-muted-foreground" /></Button>
                                {!decidedIds.has(i.id) && !["contratado","desligado","desistente"].includes(i.applications?.status) && i.applications?.id && (
                                  <>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      title="Aprovar Entrevista"
                                      onClick={() => setDecisionTarget({ interview: i, decision: "aprovado" })}
                                    >
                                      <CheckCircle2 className="h-4 w-4" style={{ color: "hsl(142 76% 36%)" }} />
                                    </Button>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      title="Standby"
                                      onClick={() => setDecisionTarget({ interview: i, decision: "standby" })}
                                    >
                                      <XCircle className="h-4 w-4 text-yellow-600" />
                                    </Button>
                            </>
                          )}
                        </>
                      )}
                      {i.applications?.status === "standby" && (() => {
                        const inv = latestInviteByCandidate.get(i.candidate_id);
                        if (inv?.status === "pending") {
                          // já exibido pelo badge de status
                          return null;
                        }
                        if (inv?.status === "declined") {
                          return (
                            <Button
                              variant="default"
                              size="sm"
                              className="h-8 px-2 text-[10px] bg-emerald-600 hover:bg-emerald-700"
                              onClick={() =>
                                setResumeInviteTarget({
                                  candidate_id: i.candidate_id,
                                  profiles: i.profiles,
                                  unit_job_id: i.unit_job_id,
                                  unit_jobs: i.unit_jobs,
                                })
                              }
                            >
                              <RotateCcw className="h-3 w-3 mr-1" /> Convidar novamente
                            </Button>
                          );
                        }
                        return (
                          <Button
                            variant="default"
                            size="sm"
                            className="h-8 px-2 text-[10px] bg-emerald-600 hover:bg-emerald-700"
                            title="Convidar a retomar a candidatura"
                            onClick={() =>
                              setResumeInviteTarget({
                                candidate_id: i.candidate_id,
                                profiles: i.profiles,
                                unit_job_id: i.unit_job_id,
                                unit_jobs: i.unit_jobs,
                              })
                            }
                          >
                            <Send className="h-3 w-3 mr-1" /> Convidar para retomar
                          </Button>
                        );
                      })()}

                            </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
                </Table>
                </div>
              }
              {hasNextPage && (
                <div ref={loadMoreRef} className="flex justify-center py-4">
                  {isFetchingNextPage ? (
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => fetchNextPage()}>
                      Carregar mais
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== TESTES AGENDADOS TAB ===== */}
        <TabsContent value="test_bookings">
          <TestBookingsTab unitId={selectedUnit || undefined} unitIds={scopedUnitIds} />
        </TabsContent>

        {/* ===== AUDITORIA TAB ===== */}
        <TabsContent value="audit">
          <div className="space-y-4">
            {/* Audit metric cards */}
            <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-3">
              <Card><CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-foreground">{auditData?.totalInterviews ?? 0}</p>
                <p className="text-xs text-muted-foreground">Total Entrevistas</p>
              </CardContent></Card>
              <Card><CardContent className="p-4 text-center">
                <p className="text-2xl font-bold" style={{ color: "hsl(142 76% 36%)" }}>{auditData?.attendanceRate ?? 0}%</p>
                <p className="text-xs text-muted-foreground">Comparecimento</p>
              </CardContent></Card>
              <Card><CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-destructive">{auditData?.noShowRate ?? 0}%</p>
                <p className="text-xs text-muted-foreground">No-Show</p>
              </CardContent></Card>
              <Card><CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-muted-foreground">{auditData?.totalCancelled ?? 0}</p>
                <p className="text-xs text-muted-foreground">Cancelamentos</p>
              </CardContent></Card>
            </div>

            {/* Trend Charts */}
            {auditData?.perUnit && auditData.perUnit.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader><CardTitle className="text-base">Comparecimento vs No-Show por Unidade</CardTitle></CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                      <LineChart data={auditData.perUnit.slice(0, 10).reverse()}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis dataKey="unitName" className="text-xs" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" height={50} />
                        <YAxis unit="%" className="text-xs" />
                        <Tooltip formatter={(v: number) => `${v}%`} />
                        <Legend />
                        <Line type="monotone" dataKey="attendanceRate" name="Comparecimento" stroke="hsl(142 76% 36%)" strokeWidth={2} />
                        <Line type="monotone" dataKey="noShowRate" name="No-Show" stroke="hsl(var(--destructive))" strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                {/* Ranking Top 5 / Bottom 5 */}
                <Card>
                  <CardHeader><CardTitle className="text-base flex items-center gap-2"><Trophy className="h-4 w-4" />Ranking de Comparecimento</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-2">🏆 Top 5 Melhores</p>
                      {[...auditData.perUnit].sort((a, b) => b.attendanceRate - a.attendanceRate).slice(0, 5).map((u, i) => (
                        <div key={u.unitId} className="flex items-center justify-between py-1 border-b last:border-0">
                          <span className="text-sm">{i + 1}. {u.unitName}</span>
                          <Badge variant="default">{u.attendanceRate}%</Badge>
                        </div>
                      ))}
                    </div>
                    <div>
                      <p className="text-xs font-medium text-destructive mb-2">⚠️ Bottom 5 Piores</p>
                      {[...auditData.perUnit].sort((a, b) => a.attendanceRate - b.attendanceRate).slice(0, 5).map((u, i) => (
                        <div key={u.unitId} className="flex items-center justify-between py-1 border-b last:border-0">
                          <span className="text-sm">{i + 1}. {u.unitName}</span>
                          <Badge variant="destructive">{u.attendanceRate}%</Badge>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Audit filters */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
              <div>
                <Label className="text-xs">De</Label>
                <MaskedDateInput value={ymdToLocalDate(auditDateFrom)} onChange={d => setAuditDateFrom(dateToLocalYMD(d))} format="dd/MM/yyyy" placeholder="De" size="sm" />
              </div>
              <div>
                <Label className="text-xs">Até</Label>
                <MaskedDateInput value={ymdToLocalDate(auditDateTo)} onChange={d => setAuditDateTo(dateToLocalYMD(d))} format="dd/MM/yyyy" placeholder="Até" size="sm" />
              </div>
              {(auditDateFrom || auditDateTo) && (
                <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { setAuditDateFrom(""); setAuditDateTo(""); }}>
                  Limpar
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                disabled={!auditData?.perUnit?.length}
                onClick={() => {
                  if (!auditData?.perUnit?.length) return;
                  const header = "Unidade,Cidade,Estado,Total,Concluídas,No-Shows,Canceladas,Comparecimento%,No-Show%,Alerta\n";
                  const rows = auditData.perUnit.map(u =>
                    `"${u.unitName}","${u.city || ""}","${u.state || ""}",${u.total},${u.concluidas},${u.noShows},${u.canceladas},${u.attendanceRate},${u.noShowRate},${u.hasAlert ? "Sim" : "Não"}`
                  ).join("\n");
                  const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `auditoria_entrevistas_${new Date().toISOString().slice(0, 10)}.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                  toast.success("CSV exportado com sucesso!");
                }}
              >
                <Download className="h-3.5 w-3.5 mr-1" />Exportar CSV
              </Button>
            </div>

            {/* Per-unit audit table */}
            <Card>
              <CardHeader>
                <CardTitle>Auditoria por Unidade</CardTitle>
                <CardDescription>Taxa de comparecimento e alertas por unidade</CardDescription>
              </CardHeader>
              <CardContent>
                {auditLoading ? <div className="flex justify-center p-4"><Loader2 className="h-6 w-6 animate-spin" /></div> :
                  !auditData?.perUnit?.length ? <p className="text-muted-foreground text-sm text-center py-4">Nenhum dado de auditoria encontrado.</p> :
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Unidade</TableHead>
                        <TableHead className="text-center">Total</TableHead>
                        <TableHead className="text-center">Concluídas</TableHead>
                        <TableHead className="text-center">Não compareceram</TableHead>
                        <TableHead className="text-center">Canceladas</TableHead>
                        <TableHead className="text-center">Comparecimento</TableHead>
                        <TableHead>Alerta</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {auditData.perUnit.map((u) => (
                        <TableRow key={u.unitId}>
                          <TableCell>
                            <p className="font-medium">{u.unitName}</p>
                            {u.city && <p className="text-xs text-muted-foreground">{u.city}{u.state ? ` / ${u.state}` : ""}</p>}
                          </TableCell>
                          <TableCell className="text-center">{u.total}</TableCell>
                          <TableCell className="text-center">{u.concluidas}</TableCell>
                          <TableCell className="text-center font-medium text-destructive">{u.noShows}</TableCell>
                          <TableCell className="text-center">{u.canceladas}</TableCell>
                          <TableCell className="text-center">
                            <Badge variant={u.attendanceRate >= 80 ? "default" : u.attendanceRate >= 50 ? "secondary" : "destructive"}>
                              {u.attendanceRate}%
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {u.hasAlert && (
                              <Badge variant="destructive" className="text-xs">
                                <AlertTriangle className="h-3 w-3 mr-1" />No-Show Alto
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                }
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ===== IA DIAGNÓSTICO TAB ===== */}
        <TabsContent value="ia">
          <div className="space-y-4">
            <Card>
              <CardHeader className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <CardTitle className="flex items-center gap-2 flex-wrap">
                    <Brain className="h-5 w-5 shrink-0" />
                    <span className="break-words">Diagnóstico IA de Agenda</span>
                  </CardTitle>
                  <CardDescription className="break-words">
                    RecrutaBot analisa padrões de no-show, cancelamentos e sugere melhorias operacionais.
                  </CardDescription>
                </div>
                <Button
                  className="w-full md:w-auto shrink-0"
                  onClick={async () => {
                    try {
                      const result = await diagnostic.mutateAsync(selectedUnit || undefined);
                      setDiagnosticResult(result);
                      toast.success("Diagnóstico gerado com sucesso!");
                    } catch (e: any) {
                      toast.error(e.message || "Erro ao gerar diagnóstico");
                    }
                  }}
                  disabled={diagnostic.isPending}
                >
                  {diagnostic.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Brain className="h-4 w-4 mr-2" />}
                  Gerar Diagnóstico
                </Button>
              </CardHeader>
              <CardContent>
                {diagnostic.isPending && (
                  <div className="flex flex-col items-center py-12 gap-3">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">RecrutaBot analisando dados de entrevistas...</p>
                  </div>
                )}
                {diagnosticResult && !diagnostic.isPending && (
                  <div className="space-y-6">
                    {/* Score de Saúde */}
                    {diagnosticResult.score_saude != null && (
                      <div className="flex items-center gap-4 flex-wrap">
                        <div className={`text-4xl font-bold ${diagnosticResult.score_saude >= 70 ? "text-primary" : diagnosticResult.score_saude >= 40 ? "text-amber-500" : "text-destructive"}`}>
                          {diagnosticResult.score_saude}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-foreground">Score de Saúde da Agenda</p>
                          <p className="text-sm text-muted-foreground break-words">
                            {diagnosticResult.score_saude >= 70 ? "Bom desempenho operacional" : diagnosticResult.score_saude >= 40 ? "Atenção necessária" : "Situação crítica"}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Diagnóstico */}
                    <div className="rounded-lg border p-4">
                      <h4 className="font-medium text-foreground mb-2">📋 Diagnóstico Geral</h4>
                      <p className="text-sm text-muted-foreground break-words">{diagnosticResult.diagnostico}</p>
                    </div>

                    {/* Padrões */}
                    {diagnosticResult.padroes_identificados?.length > 0 && (
                      <div className="rounded-lg border p-4">
                        <h4 className="font-medium text-foreground mb-2">🔍 Padrões Identificados</h4>
                        <ul className="space-y-1">
                          {diagnosticResult.padroes_identificados.map((p: string, i: number) => (
                            <li key={i} className="text-sm text-muted-foreground flex items-start gap-2 break-words">
                              <span className="text-primary mt-0.5 shrink-0">•</span><span className="min-w-0 break-words">{p}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Unidades Críticas */}
                    {diagnosticResult.unidades_criticas?.length > 0 && (
                      <div className="rounded-lg border border-destructive/30 p-4">
                        <h4 className="font-medium text-destructive mb-2">⚠️ Unidades Críticas</h4>
                        <div className="space-y-3">
                          {diagnosticResult.unidades_criticas.map((u: any, i: number) => (
                            <div key={i} className="border-b last:border-0 pb-2 min-w-0">
                              <p className="text-sm font-medium text-foreground break-words">{u.nome}</p>
                              <p className="text-xs text-destructive break-words">{u.problema}</p>
                              <p className="text-xs text-muted-foreground break-words">💡 {u.sugestao}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Horários e Dias Problemáticos */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {diagnosticResult.horarios_problematicos?.length > 0 && (
                        <div className="rounded-lg border p-4">
                          <h4 className="font-medium text-foreground mb-2">🕐 Horários Problemáticos</h4>
                          <div className="flex flex-wrap gap-2">
                            {diagnosticResult.horarios_problematicos.map((h: string, i: number) => (
                              <Badge key={i} variant="secondary">{h}</Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      {diagnosticResult.dias_problematicos?.length > 0 && (
                        <div className="rounded-lg border p-4">
                          <h4 className="font-medium text-foreground mb-2">📅 Dias Problemáticos</h4>
                          <div className="flex flex-wrap gap-2">
                            {diagnosticResult.dias_problematicos.map((d: string, i: number) => (
                              <Badge key={i} variant="secondary">{d}</Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Recomendações */}
                    {diagnosticResult.recomendacoes?.length > 0 && (
                      <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
                        <h4 className="font-medium text-foreground mb-2">💡 Recomendações</h4>
                        <ol className="space-y-1 list-decimal list-inside">
                          {diagnosticResult.recomendacoes.map((r: string, i: number) => (
                            <li key={i} className="text-sm text-muted-foreground break-words">{r}</li>
                          ))}
                        </ol>
                      </div>
                    )}

                    {diagnosticResult.processing_time_ms && (
                      <p className="text-xs text-muted-foreground text-right">Processado em {diagnosticResult.processing_time_ms}ms</p>
                    )}
                  </div>
                )}
                {!diagnosticResult && !diagnostic.isPending && (
                  <div className="text-center py-12 text-muted-foreground">
                    <Brain className="h-12 w-12 mx-auto mb-4 opacity-30" />
                    <p className="text-sm">Clique em "Gerar Diagnóstico" para que o RecrutaBot analise os dados de entrevistas.</p>
                    <p className="text-xs mt-1">A análise considera no-shows, cancelamentos, horários e padrões por unidade.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ===== BLOQUEIOS TAB ===== */}
        <TabsContent value="blocked">
          <div className="space-y-6">
            <BlockedDatesPanel unitId={selectedUnit || undefined} />
            <ScheduleSimulator />
          </div>
        </TabsContent>

        {/* ===== CONFIGURAÇÕES TAB ===== */}
        <TabsContent value="settings">
          <SchedulingConfigSection />
        </TabsContent>
      </Tabs>

      {guidedInterview && (
        <GuidedInterview
          interview={guidedInterview}
          open={!!guidedInterview}
          onOpenChange={(v) => { if (!v) setGuidedInterview(null); }}
        />
      )}

      {feedbackView && (
        <GuidedInterview
          interview={feedbackView}
          open={!!feedbackView}
          onOpenChange={(v) => { if (!v) setFeedbackView(null); }}
          readOnly
        />
      )}

      <InterviewDecisionDialog
        target={decisionTarget}
        onOpenChange={(open) => { if (!open) setDecisionTarget(null); }}
        onDone={(interviewId) => setOptimisticDecidedIds((ids) => ids.includes(interviewId) ? ids : [...ids, interviewId])}
      />

      <ResumeInviteDialog
        open={!!resumeInviteTarget}
        onOpenChange={(open) => { if (!open) setResumeInviteTarget(null); }}
        unitJobId={resumeInviteTarget?.unit_job_id}
        candidate={resumeInviteTarget ? { candidate_id: resumeInviteTarget.candidate_id, profiles: resumeInviteTarget.profiles } : null}
        jobTitle={resumeInviteTarget?.unit_jobs?.jobs?.title}
        latestInvite={resumeInviteTarget ? latestInviteByCandidate.get(resumeInviteTarget.candidate_id) : undefined}
      />
    </div>
  );
}
