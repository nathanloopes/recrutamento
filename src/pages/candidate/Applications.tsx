import { useState, useEffect } from "react";
import { EducationalFeedback } from "@/components/candidate/EducationalFeedback";
import { LinkOriginBanner } from "@/components/candidate/LinkOriginBanner";

import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Clock, CheckCircle2, XCircle, Ban, CalendarDays, CalendarCheck, Briefcase, Search, Heart, Star, Loader2, CalendarPlus, Video, ExternalLink, MapPin, FileText, BadgeCheck, Bell } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useMyApplications, useWithdrawApplication } from "@/hooks/useApplications";
import { useMyInterviews, useConfirmAttendance } from "@/hooks/useScheduling";
import { useNavigate } from "react-router-dom";
import { ApplicationStatusCard, classifyPhase } from "@/components/candidate/ApplicationStatusCard";
import { JobUnavailableBanner } from "@/components/candidate/JobUnavailableBanner";
import { AsoScheduleBanner } from "@/components/candidate/AsoScheduleBanner";
import { useApplicationStatus } from "@/hooks/useApplicationStatus";
import { useInterviewApprovalGate } from "@/hooks/useInterviewApprovalGate";
import { computeStepperState } from "@/lib/stepperState";
import { formatDateBR, formatDateTimeBR } from "@/lib/dateUtils";
import { PageHelp } from "@/components/ui/page-help";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { InterviewScheduler } from "@/components/candidate/InterviewScheduler";
import { PostTestPresencialCard } from "@/components/candidate/PostTestPresencialCard";
import { parseBoolSetting } from "@/lib/schedulingSettings";
import { resolveMeetingHref, isLivekitInterview, isInterviewEntryExpired, INTERVIEW_ENTRY_GRACE_MINUTES } from "@/lib/interviewMeetingLink";
import { getCandidateStatus } from "@/lib/candidateStatus";

// Ícones por código de status (apenas presentation — labels/cores vêm de getCandidateStatus)
const STATUS_ICONS: Record<string, typeof Clock> = {
  em_andamento: Clock,
  aprovado: CheckCircle2,
  aprovado_pendente_documentacao: Clock,
  aprovado_aguardando_aprovacao_docs: Clock,
  aprovado_docs_ok: CheckCircle2,
  contratado: CheckCircle2,
  desligado: XCircle,
  reprovado: Clock,
  standby: Clock,
  desistente: XCircle,
  no_show: XCircle,
  completed: CheckCircle2,
};

/** Derives display status for approved candidates based on doc completion */
function AppStatusBadge({ app }: { app: any }) {
  const jobId = app.unit_jobs?.jobs?.id || app.unit_jobs?.job_id;
  const { data: statusData } = useApplicationStatus(app.id, jobId);

  const candStatus = getCandidateStatus({
    application: app,
    interviews: null, // (candidato não vê estado de entrevista como status do funil aqui)
    docContext: statusData
      ? {
          docTotal: statusData.docTotalCount,
          docApproved: statusData.docSentCount, // approximação: candidato não distingue uploaded vs approved
          docUploaded: statusData.docSentCount,
        }
      : undefined,
  });
  const Icon = STATUS_ICONS[candStatus.code] || Clock;
  return (
    <Badge
      variant="secondary"
      className={`text-[10px] whitespace-normal text-left leading-tight inline-flex items-start max-w-full ${candStatus.className}`}
    >
      <Icon className="h-3 w-3 mr-1 mt-0.5 shrink-0" />
      <span className="break-words">{candStatus.label}</span>
    </Badge>
  );
}

/** Inline notice for pending documents — does NOT change pipeline stage */
function DocsPendingNotice({ app }: { app: any }) {
  const navigate = useNavigate();
  const jobId = app.unit_jobs?.jobs?.id || app.unit_jobs?.job_id;
  const { data: statusData } = useApplicationStatus(app.id, jobId);
  const { data: gate } = useInterviewApprovalGate(app.id);
  if (!statusData) return null;
  if (statusData.pendingAction !== "documents") return null;
  // Skip when status is "aprovado": that case already has its own dedicated banner
  if (app.status === "aprovado" || app.status === "contratado") return null;
  const interviewBlocked = !!gate?.blocked;
  return (
    <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md px-3 py-2 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 text-xs text-yellow-800 dark:text-yellow-300 min-w-0">
        <FileText className="h-3.5 w-3.5 shrink-0" />
        <span className="font-medium truncate">
          {interviewBlocked
            ? "Documentos liberam após aprovação na entrevista"
            : "Documentos pendentes para continuar o processo"}
        </span>
      </div>
      <Button
        size="sm"
        className="h-7 text-[11px] bg-yellow-600 hover:bg-yellow-700 text-white shrink-0 disabled:opacity-60"
        disabled={interviewBlocked}
        onClick={() => navigate(`/documentos/${app.id}`)}
      >
        {interviewBlocked ? "Bloqueado" : "Enviar"}
      </Button>
    </div>
  );
}

/** Probe: reports per-application whether the candidate has any pending action */
function PendingProbe({ app, onChange }: { app: any; onChange: (appId: string, has: boolean) => void }) {
  const jobId = app.unit_jobs?.jobs?.id || app.unit_jobs?.job_id;
  const { data } = useApplicationStatus(app.id, jobId);
  useEffect(() => {
    const has = !!data?.pendingItems?.some((p: any) => p.responsible === "candidato");
    onChange(app.id, has);
  }, [data, app.id, onChange]);
  return null;
}

function WelcomeBanner({ apps }: { apps: any[] }) {
  const [pendingMap, setPendingMap] = useState<Record<string, boolean>>({});
  const handleChange = (id: string, has: boolean) => {
    setPendingMap((prev) => (prev[id] === has ? prev : { ...prev, [id]: has }));
  };
  const firstPendingAppId = apps.find((a) => pendingMap[a.id])?.id;
  const hasPending = !!firstPendingAppId;

  const goToPending = () => {
    if (!firstPendingAppId) return;
    const el = document.getElementById(`pending-${firstPendingAppId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    // Foca o primeiro botão de pendência para reforçar a ação
    setTimeout(() => {
      const btn = el.querySelector("button") as HTMLButtonElement | null;
      btn?.focus({ preventScroll: true });
    }, 350);
  };

  return (
    <>
      {apps.map((a) => (
        <PendingProbe key={a.id} app={a} onChange={handleChange} />
      ))}
      {hasPending ? (
        <button
          type="button"
          onClick={goToPending}
          className="w-full text-left bg-amber-100 dark:bg-amber-900/30 border-2 border-amber-400 dark:border-amber-700 rounded-xl p-4 hover:bg-amber-200 dark:hover:bg-amber-900/40 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500"
          aria-label="Ir para a pendência abaixo"
        >
          <div className="flex items-start gap-2">
            <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5 motion-safe:animate-pulse" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-100 leading-snug">
                Você tem uma ação pendente para continuar 💛
              </p>
              <p className="text-xs text-amber-800/90 dark:text-amber-200/90 leading-relaxed">
                Toque aqui para ir até o botão <strong className="font-semibold">Continuar</strong> e concluir a etapa pendente.
              </p>
            </div>
          </div>
        </button>



      ) : (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 space-y-2">
          <div className="flex items-start gap-2">
            <BadgeCheck className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200 leading-snug">
              Você está oficialmente no processo seletivo da Recruta 💛
            </p>
          </div>
          <p className="text-xs text-amber-800/90 dark:text-amber-300/90 leading-relaxed">
            Seus dados foram enviados para a unidade e a equipe já está analisando seu perfil.
            <strong className="font-semibold"> A partir de agora, você não precisa fazer mais nada — basta aguardar.</strong>
          </p>
          <p className="text-xs text-amber-800/90 dark:text-amber-300/90 leading-relaxed flex items-start gap-1.5">
            <Bell className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>Volte sempre ao app para acompanhar atualizações. Também enviaremos avisos por aqui sempre que algo avançar.</span>
          </p>
        </div>
      )}
    </>
  );
}



export default function Applications() {
  const { data: applications, isLoading } = useMyApplications();
  const { data: myInterviews, isLoading: myInterviewsLoading } = useMyInterviews();
  const confirmAttendance = useConfirmAttendance();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  
  const { profile, user } = useAuth();

/** "Etapa atual" derivada da MESMA fonte do stepper visual (computeStepperState). */
function CurrentStageLabel({ app, fallbackPhaseName }: { app: any; fallbackPhaseName: string }) {
  const jobId = app.unit_jobs?.jobs?.id || app.unit_jobs?.job_id;
  const { data: status } = useApplicationStatus(app.id, jobId);

  if (!status) {
    return (
      <span className="text-muted-foreground">
        {fallbackPhaseName ? `Etapa atual: ${classifyPhase(fallbackPhaseName)}` : ""}
      </span>
    );
  }

  const { stages } = computeStepperState({
    appStatus: status.appStatus,
    pipelinePhases: status.phases,
    docs: {
      total: status.docTotalCount,
      sent: status.docSentCount,
      pending: status.docPendingCount,
      hasOpenRequest: status.pendingAction === "documents",
    },
    interviews: status.interviewsAggregate,
    tests: status.testsAggregate,
    restartMode: status.currentRestartMode ?? null,
  });

  // Primeiro estágio "current"; se não houver, último "completed" (ex.: aguardando contratação).
  const current = stages.find((s) => s.status === "current");
  let label: string | null = current?.name ?? null;
  if (!label) {
    const completed = [...stages].reverse().find((s) => s.status === "completed");
    label = completed?.name ?? null;
  }

  return (
    <span className="text-muted-foreground">
      {label ? `Etapa atual: ${label}` : ""}
    </span>
  );
}


  const [withdrawingAppId, setWithdrawingAppId] = useState<string | null>(null);
  const [showBulkCancel, setShowBulkCancel] = useState(false);
  const [bulkCancelling, setBulkCancelling] = useState(false);
  const withdrawMutation = useWithdrawApplication();
  const [withdrawReason, setWithdrawReason] = useState("");
  
  const [schedulingApp, setSchedulingApp] = useState<{ id: string; unitId: string; jobTitle?: string; jobDescription?: string; jobId?: string } | null>(null);

  // Check if candidate self-scheduling is enabled (resilient: defaults to true)
  const { data: selfScheduleSetting } = useQuery({
    queryKey: ["global_settings", "self_schedule"],
    queryFn: async () => {
      const { data } = await supabase
        .from("global_settings")
        .select("value")
        .eq("category", "agendamento")
        .eq("key", "allow_candidate_self_schedule")
        .maybeSingle();
      return data?.value ?? null;
    },
  });
  const canSelfSchedule = parseBoolSetting(selfScheduleSetting, true);

  // Check if educational feedback is enabled via CrossConfig
  const { data: educationalRetrySetting } = useQuery({
    queryKey: ["global_settings", "scoring", "allow_educational_retry"],
    queryFn: async () => {
      const { data } = await supabase
        .from("global_settings")
        .select("value")
        .eq("category", "scoring")
        .eq("key", "allow_educational_retry")
        .maybeSingle();
      // Default true if not configured
      if (!data) return true;
      return data.value === true || data.value === "true";
    },
  });
  const showEducationalFeedback = educationalRetrySetting !== false;

  const getInterviewForApp = (appId: string) => {
    return myInterviews?.find((i: any) => i.application_id === appId && ["confirmed", "reschedule_requested", "pending_approval"].includes(i.status));
  };

  const getTerminalInterviewForApp = (appId: string) => {
    return myInterviews?.find((i: any) => i.application_id === appId && ["completed", "concluida", "no_show", "canceled"].includes(i.status));
  };

  return (
    <div className="px-4 pt-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-display font-bold text-foreground">Processo Seletivo</h1>
        <PageHelp />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>
      ) : applications?.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-primary/10">
            <Briefcase className="h-8 w-8 text-primary" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">Nenhum processo seletivo ainda</p>
            <p className="text-xs text-muted-foreground">Explore vagas disponíveis e dê o primeiro passo!</p>
          </div>
          <Button size="sm" onClick={() => navigate("/oportunidades")}>
            <Search className="h-4 w-4 mr-1" /> Encontrar Vaga
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {(() => {
            const active = applications?.filter((app: any) => !["desistente", "contratado", "desligado", "reprovado", "declinado"].includes(app.status)) || [];
            const hired = applications?.filter((app: any) => app.status === "contratado") || [];
            const history = applications?.filter((app: any) => ["desistente", "desligado", "reprovado", "declinado"].includes(app.status)) || [];

            return (
              <>
                {/* CONTRATADO — sempre no topo */}
                {hired.length > 0 && (
                  <div className="space-y-3">
                    <h2 className="text-sm font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wide flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4" /> Contratado
                    </h2>
                    {hired.map((app: any) => {
                      const jobTitle = app.unit_jobs?.jobs?.title || "Cargo";
                      const unitName = app.unit_jobs?.units?.name || "";

                      return (
                        <Card key={app.id} className="border-2 border-emerald-300 dark:border-emerald-700 shadow-md bg-emerald-50/50 dark:bg-emerald-950/20">
                          <CardContent className="p-4 space-y-2">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                              <div className="min-w-0 flex-1">
                                <h3 className="font-semibold text-foreground break-words">{jobTitle}</h3>
                                <p className="text-xs text-muted-foreground break-words">{unitName}</p>
                              </div>
                              <Badge className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 self-start sm:shrink-0 whitespace-normal text-left leading-tight inline-flex items-start max-w-full">
                                <CheckCircle2 className="h-3 w-3 mr-1 mt-0.5 shrink-0" />
                                <span className="break-words">Contratado</span>
                              </Badge>
                            </div>
                            <div className="bg-emerald-100/60 dark:bg-emerald-900/20 rounded-lg p-3">
                              <p className="text-sm text-emerald-800 dark:text-emerald-300 font-medium">
                                🎉 Você foi contratado(a) para esta vaga!
                              </p>
                              <p className="text-xs text-emerald-700/80 dark:text-emerald-400/80 mt-1">
                                Bem-vindo(a) à equipe! Fique atento à aba de Documentos para enviar o que for necessário e às Notificações para próximos passos.
                              </p>
                              {app.work_start_at && (
                                <p className="text-xs font-medium text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5 mt-2">
                                  <CalendarCheck className="h-3.5 w-3.5 shrink-0" />
                                  Início: {formatDateTimeBR(app.work_start_at)}
                                </p>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}

                {/* Quando contratado, não mostrar candidaturas ativas — serão canceladas automaticamente */}
                {hired.length > 0 && active.length > 0 && (
                  <Card className="border-emerald-300 dark:border-emerald-700 bg-emerald-50/80 dark:bg-emerald-950/20 shadow-sm">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                        <div className="space-y-1">
                          <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
                            Parabéns pela contratação!
                          </p>
                          <p className="text-xs text-emerald-700/80 dark:text-emerald-400/80">
                            Seus outros processos seletivos foram encerrados automaticamente.
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {active.length > 0 && hired.length === 0 && (() => {
                  const hasInterviewPending = active.some((app: any) =>
                    myInterviews?.some((i: any) =>
                      i.application_id === app.id &&
                      ["confirmed", "reschedule_requested", "pending_approval"].includes(i.status)
                    )
                  );
                  const baseEligible = active.every((app: any) =>
                    ["pendente", "em_andamento", "em_avaliacao"].includes(app.status)
                  ) && !hasInterviewPending;
                  return baseEligible ? <WelcomeBanner apps={active} /> : null;
                })()}


                {active.length > 0 && hired.length === 0 && (
                  <div className="space-y-3">
                    <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Processos seletivos em andamento</h2>
                    {active.map((app: any) => {
                      const jobTitle = app.unit_jobs?.jobs?.title || "Cargo";
                      const unitName = app.unit_jobs?.units?.name || "";
                      const phaseName = app.pipeline_phases?.name || "";
                      const interview = getInterviewForApp(app.id);
                      const terminalInterview = getTerminalInterviewForApp(app.id);

                      return (
                        <Card key={app.id} className="border-0 shadow-sm">
                          <CardContent className="p-4 space-y-3">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                              <div className="min-w-0 flex-1">
                                <h3 className="font-semibold text-foreground break-words">{jobTitle}</h3>
                                <p className="text-xs text-muted-foreground break-words">{unitName}</p>
                              </div>
                              <div className="self-start sm:shrink-0 max-w-full"><AppStatusBadge app={app} /></div>
                            </div>
                            {app.origin_link_id && (
                              <LinkOriginBanner applicationId={app.id} jobTitle={jobTitle} unitName={unitName} />
                            )}

                            {/* Vaga indisponível (pausada/preenchida/encerrada) + oferta de mesma vaga em outra unidade */}
                            <JobUnavailableBanner
                              jobStatus={app.unit_jobs?.status}
                              jobId={app.unit_jobs?.jobs?.id || app.unit_jobs?.job_id}
                              unitJobId={app.unit_job_id}
                            />

                            {/* Stepper inline (igual à Home) — logo após o título */}
                            {(app.status === "em_andamento" || app.status === "aprovado") && (
                              <ApplicationStatusCard
                                applicationId={app.id}
                                jobId={app.unit_jobs?.jobs?.id || app.unit_jobs?.job_id}
                              />
                            )}

                            {/* ASO agendado — card destacado com endereço e horário */}
                            <AsoScheduleBanner applicationId={app.id} />

                            {/* Pós-teste online: orienta e permite agendar o teste presencial */}
                            <PostTestPresencialCard />

                            {/* Documentos pendentes — pendência paralela, não muda a etapa */}
                            <DocsPendingNotice app={app} />



                            {/* Interview actions: Reschedule + Confirm */}
                            {interview && interview.status === "pending_approval" && (
                              <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3 space-y-1">
                                <div className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300">
                                  <Clock className="h-4 w-4" />
                                  Aguardando aprovação
                                </div>
                                <p className="text-xs text-amber-700 dark:text-amber-400">
                                  Sua solicitação para {formatDateBR(interview.scheduled_date)} às {interview.scheduled_time?.slice(0, 5)} está pendente de aprovação do recrutador.
                                </p>
                              </div>
                            )}
                            {interview && interview.status === "reschedule_requested" && (
                              <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-3 space-y-2">
                                <div className="flex items-center gap-2 text-sm font-medium text-yellow-800 dark:text-yellow-300">
                                  <Clock className="h-4 w-4" />
                                  Reagendamento solicitado
                                </div>
                                <p className="text-xs text-yellow-700 dark:text-yellow-400">
                                  O recrutador solicitou que você escolha um novo horário
                                </p>
                                <Button
                                  size="sm"
                                  variant="default"
                                  className="w-full text-xs"
                                  onClick={() => setSchedulingApp({ id: app.id, unitId: app.unit_jobs?.unit_id || app.unit_jobs?.units?.id, jobTitle: jobTitle, jobDescription: app.unit_jobs?.jobs?.description, jobId: app.unit_jobs?.jobs?.id || app.unit_jobs?.job_id })}
                                >
                                  <CalendarPlus className="h-3 w-3 mr-1" />
                                  Escolher Novo Horário
                                </Button>
                              </div>
                            )}
                            {interview && interview.status !== "reschedule_requested" && interview.status !== "pending_approval" && (
                              <div className="bg-accent/50 rounded-lg p-3 space-y-2">
                                <div className="space-y-1 text-sm">
                                  <div className="flex items-center gap-2">
                                    <CalendarDays className="h-4 w-4 text-primary" />
                                    <span className="font-medium">
                                      Entrevista: {formatDateBR(interview.scheduled_date)} às {interview.scheduled_time?.slice(0, 5)}
                                    </span>
                                  </div>
                                  <div className="pl-6 text-xs text-muted-foreground">
                                    Modalidade: {interview.modality === "online" ? "Online" : interview.modality === "ai_interview" ? "IA" : "Presencial"}
                                  </div>
                                </div>
                                <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full max-w-full">
                                  {interview.confirmed_at && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="text-sm w-full sm:w-auto min-h-[44px] px-3 inline-flex items-center justify-center gap-2 whitespace-nowrap"
                                      onClick={() => setSchedulingApp({ id: app.id, unitId: app.unit_jobs?.unit_id || app.unit_jobs?.units?.id, jobTitle: jobTitle, jobDescription: app.unit_jobs?.jobs?.description, jobId: app.unit_jobs?.jobs?.id || app.unit_jobs?.job_id })}
                                    >
                                      <CalendarDays className="h-4 w-4 shrink-0" />
                                      <span>Reagendar</span>
                                    </Button>
                                  )}
                                  {!interview.confirmed_at && (
                                    <Button
                                      size="sm"
                                      variant="default"
                                      className="text-sm w-full sm:w-auto min-h-[44px] px-3 inline-flex items-center justify-center gap-2 whitespace-nowrap"
                                      disabled={confirmAttendance.isPending}
                                      onClick={async () => {
                                        try {
                                          await confirmAttendance.mutateAsync(interview.id);
                                          toast({ title: "Presença confirmada!", description: "Você confirmou presença na entrevista." });
                                        } catch (e: any) {
                                          toast({ title: "Erro", description: e.message, variant: "destructive" });
                                        }
                                      }}
                                    >
                                      <CalendarCheck className="h-4 w-4 shrink-0" />
                                      <span>Confirmar Presença</span>
                                    </Button>
                                  )}
                                  {interview.confirmed_at && (
                                    <Badge variant="secondary" className="text-[10px] w-full sm:w-auto justify-center bg-emerald-100/60 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                                      <CheckCircle2 className="h-3 w-3 mr-1" />Presença confirmada
                                    </Badge>
                                  )}
                                </div>
                                {/* Aviso enquanto candidato não confirmou presença */}
                                {!interview.confirmed_at && interview.modality !== "ai_interview" && (
                                  <div className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-2">
                                    <Clock className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                                    <span>Confirme sua presença para liberar a entrada na sala.</span>
                                  </div>
                                )}
                                {/* Link da reunião — só após confirmar presença e dentro da janela de 25min */}
                                {interview.confirmed_at && interview.modality === "online" && (() => {
                                  const expired = isInterviewEntryExpired(interview);
                                  if (expired) {
                                    return (
                                      <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted border border-border rounded-md px-3 py-2">
                                        <Clock className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                                        <span>
                                          A janela de entrada desta entrevista expirou ({INTERVIEW_ENTRY_GRACE_MINUTES} min após o horário marcado). Solicite reagendamento.
                                        </span>
                                      </div>
                                    );
                                  }
                                  if (!interview.meeting_link) {
                                    return (
                                      <div className="flex items-center gap-2 text-xs text-muted-foreground italic bg-muted rounded-md px-3 py-2">
                                        <Video className="h-3.5 w-3.5 shrink-0" />
                                        <span>O link da reunião será enviado em breve</span>
                                      </div>
                                    );
                                  }
                                  const href = resolveMeetingHref(interview);
                                  const internal = isLivekitInterview(interview);
                                  if (!href) return null;
                                  return (
                                    <a
                                      href={href}
                                      {...(internal ? {} : { target: "_blank", rel: "noopener noreferrer" })}
                                      className="flex items-center justify-between gap-2 text-sm font-semibold text-primary-foreground bg-primary hover:bg-primary/90 transition-colors rounded-md px-3 py-2 shadow-sm"
                                    >
                                      <span className="flex items-center gap-2 min-w-0">
                                        <Video className="h-4 w-4 shrink-0" />
                                        <span className="truncate">Entrar na reunião online</span>
                                      </span>
                                      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                                    </a>
                                  );
                                })()}
                                {interview.modality === "presencial" && (
                                  <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted rounded-md px-3 py-2">
                                    <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                                    <span>Presencial — compareça à unidade no horário marcado</span>
                                  </div>
                                )}
                              </div>
                            )}

                            {!interview && terminalInterview && (
                              <div className="bg-accent/50 rounded-lg p-3 space-y-2">
                                <div className="space-y-1 text-sm">
                                  <div className="flex items-center gap-2">
                                    <CalendarDays className="h-4 w-4 text-primary" />
                                    <span className="font-medium">
                                      Entrevista: {formatDateBR(terminalInterview.scheduled_date)} às {terminalInterview.scheduled_time?.slice(0, 5)}
                                    </span>
                                  </div>
                                  <div className="pl-6 text-xs text-muted-foreground">
                                    Modalidade: {terminalInterview.modality === "online" ? "Online" : terminalInterview.modality === "ai_interview" ? "IA" : "Presencial"}
                                  </div>
                                </div>
                                <Badge variant="secondary" className="text-[10px] w-full sm:w-auto justify-center bg-emerald-100/60 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  {terminalInterview.status === "no_show" ? "Ausência registrada" : terminalInterview.status === "canceled" ? "Cancelada" : "Entrevista concluída"}
                                </Badge>
                              </div>
                            )}

                            {/* Self-schedule button: only after candidate is approved for the position and a unit is linked */}
                            {canSelfSchedule && !interview && !myInterviewsLoading && myInterviews !== undefined && (app.status === "aprovado" || app.currentRestartMode === "entrevista") && !myInterviews?.some((i: any) => i.application_id === app.id && ["completed", "concluida", "no_show", "canceled"].includes(i.status)) && !!(app.unit_jobs?.unit_id || app.unit_jobs?.units?.id) && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="w-full text-xs"
                                onClick={() => setSchedulingApp({ id: app.id, unitId: app.unit_jobs?.unit_id || app.unit_jobs?.units?.id, jobTitle: jobTitle, jobDescription: app.unit_jobs?.jobs?.description, jobId: app.unit_jobs?.jobs?.id || app.unit_jobs?.job_id })}
                              >
                                <CalendarPlus className="h-3 w-3 mr-1" />
                                Agendar Entrevista
                              </Button>
                            )}

                            {app.status === "standby" && (
                              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 space-y-1.5">
                                <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                                  Mensagem do recrutador
                                </p>
                                <p className="text-sm text-amber-900/90 dark:text-amber-100/90 whitespace-pre-wrap">
                                  {(app as any)?.standby_reason?.trim()
                                    ? (app as any).standby_reason
                                    : "Seu perfil foi direcionado ao banco de talentos. Você será notificado sobre novas oportunidades compatíveis."}
                                </p>
                              </div>
                            )}
                            {(app.status === "em_andamento" || app.status === "aprovado") && hired.length === 0 && (
                              <button
                                className="text-xs text-muted-foreground hover:text-destructive hover:underline transition-colors ml-auto block"
                                onClick={() => setWithdrawingAppId(app.id)}
                              >
                                Desistir
                              </button>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}

                <div className="space-y-3">
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Histórico</h2>
                  {history.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">Nenhum histórico ainda.</p>
                  ) : (
                    history.map((app: any) => {
                      const s = getCandidateStatus({ application: app });
                      const Icon = STATUS_ICONS[s.code] || Clock;
                      const jobTitle = app.unit_jobs?.jobs?.title || "Cargo";
                      const unitName = app.unit_jobs?.units?.name || "";
                      const dateEnd = new Date(app.updated_at).toLocaleDateString("pt-BR");
                      const dateStart = new Date(app.created_at).toLocaleDateString("pt-BR");

                      return (
                         <Card key={app.id} className="border-0 shadow-sm opacity-75">
                          <CardContent className="p-4 space-y-2">
                            <div className="flex items-start justify-between">
                              <div>
                                <h3 className="font-semibold text-foreground">{jobTitle}</h3>
                                <p className="text-xs text-muted-foreground">{unitName}</p>
                              </div>
                              <Badge variant="secondary" className={`text-[10px] ${s.className}`}>
                                <Icon className="h-3 w-3 mr-1" />
                                {s.label}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">Candidatou-se em {dateStart} · Encerrado em {dateEnd}</p>
                            {app.status === "reprovado" && showEducationalFeedback && (
                              <EducationalFeedback
                                score={app.total_score ?? undefined}
                                jobTitle={jobTitle}
                                cooldownDays={90}
                              />
                            )}
                            {app.status === "reprovado" && !showEducationalFeedback && (
                              <div className="bg-muted/50 rounded-lg p-3 text-sm text-muted-foreground">
                                Este processo foi encerrado. Continue explorando novas oportunidades!
                              </div>
                            )}
                            {app.status === "desistente" && app.withdrawal_reason && (
                              <p className="text-xs text-muted-foreground italic">Motivo: {app.withdrawal_reason}</p>
                            )}
                            {app.origin_link_id && (
                              <LinkOriginBanner applicationId={app.id} jobTitle={jobTitle} unitName={unitName} isTerminal />
                            )}
                          </CardContent>
                        </Card>
                      );
                    })
                  )}
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* Bulk Cancel All Other Candidaturas Dialog */}
      <AlertDialog open={showBulkCancel} onOpenChange={(o) => { if (!o) setShowBulkCancel(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Encerrar todos os outros processos seletivos?</AlertDialogTitle>
            <AlertDialogDescription>
              Você tem {(applications?.filter((a: any) => !["desistente", "contratado", "desligado", "reprovado", "declinado"].includes(a.status))?.length || 0)} processo(s) seletivo(s) em andamento além da vaga contratada.
              <br /><br />
              Todos serão marcados como <strong>desistência</strong>. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter processos seletivos</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={bulkCancelling}
              onClick={async (e) => {
                e.preventDefault();
                setBulkCancelling(true);
                try {
                  const activeApps = (applications || []).filter((a: any) => !["desistente", "contratado", "desligado", "reprovado", "declinado"].includes(a.status));
                  // Cancela cada candidatura individualmente, rastreando falhas
                  const results = await Promise.allSettled(
                    activeApps.map(app => withdrawMutation.mutateAsync({ applicationId: app.id, reason: "Desistência automática após contratação em outra vaga" }))
                  );
                  const succeeded = results.filter(r => r.status === "fulfilled").length;
                  const failed = results.filter(r => r.status === "rejected").length;
                  if (failed > 0) {
                    toast({ title: "Resultado parcial", description: `${succeeded} cancelada(s) com sucesso, ${failed} falharam.`, variant: "destructive" });
                  } else {
                    toast({ title: "Processos seletivos encerrados", description: `${succeeded} processo(s) seletivo(s) foram encerrados com sucesso.` });
                  }
                } catch (err: any) {
                  toast({ title: "Erro", description: "Não foi possível encerrar os processos seletivos.", variant: "destructive" });
                } finally {
                  setBulkCancelling(false);
                  setShowBulkCancel(false);
                }
              }}
            >
              {bulkCancelling ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <XCircle className="h-4 w-4 mr-1" />}
              Cancelar todas
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Withdraw Dialog */}
      <AlertDialog open={!!withdrawingAppId} onOpenChange={(o) => { if (!o) { setWithdrawingAppId(null); setWithdrawReason(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desistir da vaga?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. Você será removido(a) do processo seletivo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="withdraw-reason">Por que você está desistindo?</Label>
            <Textarea
              id="withdraw-reason"
              placeholder="Descreva o motivo da sua desistência..."
              value={withdrawReason}
              onChange={(e) => setWithdrawReason(e.target.value)}
              className="min-h-[100px]"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!withdrawReason.trim() || withdrawMutation.isPending}
              onClick={async () => {
                if (!withdrawingAppId) return;
                try {
                  await withdrawMutation.mutateAsync({ applicationId: withdrawingAppId, reason: withdrawReason.trim() });
                  toast({ title: "Desistência registrada", description: "Você saiu do processo seletivo." });
                } catch {
                  toast({ title: "Erro", description: "Não foi possível registrar a desistência.", variant: "destructive" });
                }
                setWithdrawingAppId(null);
                setWithdrawReason("");
              }}
            >
              Confirmar Desistência
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Self-scheduling dialog */}
      {schedulingApp && (
        <InterviewScheduler
          applicationId={schedulingApp.id}
          unitId={schedulingApp.unitId}
          candidateId={user?.id}
          jobTitle={schedulingApp.jobTitle}
          jobDescription={schedulingApp.jobDescription}
          jobId={schedulingApp.jobId}
          open={!!schedulingApp}
          onOpenChange={(open) => { if (!open) setSchedulingApp(null); }}
          onScheduled={() => {
            setSchedulingApp(null);
            queryClient.invalidateQueries({ queryKey: ["my_interviews"] });
          }}
        />
      )}
    </div>
  );
}
