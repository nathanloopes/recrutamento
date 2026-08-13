import { useState } from "react";
import { Briefcase, Search, Calendar, FileText, CheckCircle2, HelpCircle, Bell, ChevronRight, ClipboardList, LucideIcon, CalendarPlus, CalendarCheck, Clock, Users, Video, ExternalLink, MapPin, MessageCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useUnreadCount } from "@/hooks/useNotifications";
import { useUnreadMessagesTotal } from "@/hooks/useConversations";
import { PageHelp } from "@/components/ui/page-help";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useCandidateTimeline } from "@/hooks/useDashboardMetrics";
import { InterviewScheduler } from "@/components/candidate/InterviewScheduler";
import { useMyInterviews, useConfirmAttendance } from "@/hooks/useScheduling";
import { toast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { formatDateBR, ymdToLocalDate, formatDateTimeBR } from "@/lib/dateUtils";
import { supabase } from "@/integrations/supabase/client";
import { useMyUnreadAnswersCount } from "@/hooks/useFAQ";
import { useMyTestAssignments } from "@/hooks/useTests";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

import { ApplicationStatusCard, classifyPhase } from "@/components/candidate/ApplicationStatusCard";
import { JobUnavailableBanner } from "@/components/candidate/JobUnavailableBanner";
import { AsoScheduleBanner } from "@/components/candidate/AsoScheduleBanner";
import { PostTestPresencialCard } from "@/components/candidate/PostTestPresencialCard";
import { parseBoolSetting } from "@/lib/schedulingSettings";
import { InterviewHistory } from "@/components/candidate/InterviewHistory";
import { hasActiveApplicationBlockingDiscovery } from "@/lib/applicationStatus";
import { resolveMeetingHref, isLivekitInterview, isInterviewEntryExpired, INTERVIEW_ENTRY_GRACE_MINUTES } from "@/lib/interviewMeetingLink";
import { PostInterviewTestCard } from "@/components/candidate/PostInterviewTestCard";



const modules: { icon: LucideIcon; title: string; to: string; color: string; tourId?: string }[] = [
  { icon: Search, title: "Encontrar Vaga", to: "/oportunidades", color: "bg-blue-500", tourId: "mod-vagas" },
  { icon: Briefcase, title: "Processo Seletivo", to: "/candidaturas", color: "bg-emerald-500", tourId: "mod-candidaturas" },
  { icon: Bell, title: "Avisos", to: "/notificacoes", color: "bg-rose-500" },
  { icon: MessageCircle, title: "Mensagens", to: "/mensagens", color: "bg-cyan-500" },
  { icon: FileText, title: "Meus Documentos", to: "/documentos", color: "bg-yellow-500", tourId: "mod-documentos" },
  { icon: ClipboardList, title: "Meus Testes", to: "/meus-testes", color: "bg-purple-500" },
  
  { icon: Clock, title: "Convites Recebidos", to: "/lista-oportunidade", color: "bg-amber-500" },
  { icon: Users, title: "Meu Perfil de Talentos", to: "/banco-talentos", color: "bg-indigo-500" },
  { icon: HelpCircle, title: "Ajuda", to: "/faq", color: "bg-sky-500" },
];


export default function CandidateHome() {
  const { profile } = useAuth();
  const { data: timeline, isLoading } = useCandidateTimeline();
  const { data: unreadFaqCount } = useMyUnreadAnswersCount();
  const { data: unreadMsgCount } = useUnreadMessagesTotal();
  const { data: myTests } = useMyTestAssignments();
  const { data: unreadNotifCount } = useUnreadCount();
  const pendingTestsCount = myTests?.filter(t => t.status === "pendente" || t.status === "em_andamento").length || 0;
  const firstName = profile?.full_name?.split(" ")[0] || "";
  const { data: myInterviews, isLoading: myInterviewsLoading } = useMyInterviews();
  const confirmAttendance = useConfirmAttendance();
  const [schedulingApp, setSchedulingApp] = useState<{ id: string; unitId: string; jobTitle?: string; jobDescription?: string; jobId?: string } | null>(null);
  const navigate = useNavigate();

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
  const applicationUnitId = (timeline?.application?.unit_jobs as any)?.unit_id || (timeline?.application?.unit_jobs as any)?.units?.id;
  const hasApplicationUnit = !!applicationUnitId;

  return (
    <div className="w-full px-4 sm:px-6 md:px-8 pt-5 pb-2 space-y-5">
      

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-display font-bold text-foreground">
            Olá{firstName ? `, ${firstName}` : ""}! 👋
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Encontre sua próxima oportunidade
          </p>
        </div>
        <PageHelp />
      </div>

      {/* Teste pós-entrevista liberado pela unidade */}
      <PostInterviewTestCard />

      {/* Process Timeline — using unified ApplicationStatusCard */}
      {isLoading ? (
        <Card><CardContent className="p-4"><Skeleton className="h-24 w-full" /></CardContent></Card>
      ) : timeline ? (
        timeline.application.status === "contratado" ? (
          <Card className="border-2 border-emerald-300 dark:border-emerald-700 shadow-md bg-emerald-50/50 dark:bg-emerald-950/20">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-foreground">Status do Processo Seletivo</p>
                <Badge className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                  <CheckCircle2 className="h-3 w-3 mr-1" /> Contratado
                </Badge>
              </div>
              <div className="bg-emerald-100/60 dark:bg-emerald-900/20 rounded-lg p-3 text-center">
                <p className="text-sm text-emerald-800 dark:text-emerald-300 font-semibold">
                  🎉 Você foi contratado(a)!
                </p>
                <p className="text-xs text-emerald-700/80 dark:text-emerald-400/80 mt-1">
                  {timeline.jobTitle}{timeline.unitName ? ` · ${timeline.unitName}` : ""}
                </p>
                {(timeline.application as any)?.work_start_at && (
                  <p className="text-xs font-medium text-emerald-800 dark:text-emerald-300 flex items-center justify-center gap-1.5 mt-1.5">
                    <Clock className="h-3.5 w-3.5 shrink-0" />
                    Início: {formatDateTimeBR((timeline.application as any).work_start_at)}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        ) : (timeline.application.status === "standby" || timeline.application.status === "reprovado") ? (
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">Status do Processo Seletivo</p>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {timeline.jobTitle}{timeline.unitName ? ` · ${timeline.unitName}` : ""}
                  </p>
                </div>
                <Badge className="text-[10px] shrink-0 bg-gray-100 text-gray-700 dark:bg-gray-800/50 dark:text-gray-300">Standby</Badge>
              </div>

              {/* Vaga indisponível (pausada/preenchida/encerrada) + oferta de mesma vaga em outra unidade */}
              <JobUnavailableBanner
                jobStatus={(timeline.application.unit_jobs as any)?.status}
                jobId={(timeline.application.unit_jobs as any)?.jobs?.id || (timeline.application.unit_jobs as any)?.job_id}
                unitJobId={(timeline.application as any)?.unit_job_id}
              />

              {/* Mensagem do recrutador — oculta quando o standby veio de mudança de status da vaga (motivo vaga_*, já coberto pelo aviso acima) */}
              {!String((timeline.application as any)?.standby_reason || "").startsWith("vaga_") && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 space-y-1.5">
                  <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5 shrink-0" />
                    Mensagem do recrutador
                  </p>
                  <p className="text-sm text-amber-900/90 dark:text-amber-100/90 whitespace-pre-wrap">
                    {(timeline.application as any)?.standby_reason?.trim()
                      ? (timeline.application as any).standby_reason
                      : "Seu perfil foi direcionado ao banco de talentos. Você será notificado sobre novas oportunidades compatíveis."}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card
            data-tour="timeline"
            className={`border-0 shadow-sm ${timeline.application.status === "apto_para_vaga" ? "cursor-pointer hover:shadow-md transition-shadow" : ""}`}
            {...(timeline.application.status === "apto_para_vaga"
              ? {
                  role: "button",
                  tabIndex: 0,
                  onClick: () => navigate("/oportunidades"),
                  onKeyDown: (e: React.KeyboardEvent) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      navigate("/oportunidades");
                    }
                  },
                }
              : {})}
          >
            <CardContent className="p-4 space-y-4">
              {(() => {
                const statusMap: Record<string, { label: string; cls: string }> = {
                  apto_para_vaga: { label: "Apto", cls: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400" },
                  em_andamento: { label: "Em andamento", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
                  pendente: { label: "Pendente", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
                  em_avaliacao: { label: "Em Avaliação", cls: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" },
                  aprovado: { label: "Aprovado", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
                  standby: { label: "Standby", cls: "bg-gray-100 text-gray-700 dark:bg-gray-800/50 dark:text-gray-300" },
                  reprovado: { label: "Standby", cls: "bg-gray-100 text-gray-700 dark:bg-gray-800/50 dark:text-gray-300" },
                  pausado: { label: "Pausado", cls: "bg-gray-100 text-gray-700 dark:bg-gray-800/50 dark:text-gray-300" },
                };
                const st = statusMap[timeline.application.status as string];
                return (
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">Status do Processo Seletivo</p>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {timeline.jobTitle}{timeline.unitName ? ` · ${timeline.unitName}` : ""}
                        </p>
                      </div>
                      {st && (
                        <Badge className={`text-[10px] shrink-0 ${st.cls}`}>{st.label}</Badge>
                      )}
                    </div>
                    {["pendente", "em_andamento", "em_avaliacao"].includes(timeline.application.status as string) && (
                      <p className="text-xs text-muted-foreground italic">
                        Estamos em contato com a unidade. Em breve, novidades por aqui 💛
                      </p>
                    )}
                    {timeline.application.status === "apto_para_vaga" && (timeline as any).previousWithdrawn && (
                      <div className="mt-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 space-y-1.5">
                        <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                          Sua candidatura anterior foi encerrada por desistência
                        </p>
                        <p className="text-xs text-amber-900/90 dark:text-amber-100/90">
                          {(timeline as any).previousWithdrawn.jobTitle}
                          {(timeline as any).previousWithdrawn.unitName ? ` · ${(timeline as any).previousWithdrawn.unitName}` : ""}
                          {(timeline as any).previousWithdrawn.at ? ` · ${formatDateBR((timeline as any).previousWithdrawn.at)}` : ""}
                        </p>
                        <p className="text-xs text-amber-900/90 dark:text-amber-100/90">
                          Você segue apto(a) no cargo e pode escolher uma nova unidade para tentar novamente.
                        </p>
                        <Button
                          size="sm"
                          className="mt-1 h-8 bg-amber-600 hover:bg-amber-700 text-white"
                          onClick={(e) => { e.stopPropagation(); navigate("/oportunidades"); }}
                        >
                          <Search className="h-3.5 w-3.5 mr-1.5" />
                          Encontrar outra vaga
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })()}


              {!(timeline.application as any)?.synthetic && (
                <JobUnavailableBanner
                  jobStatus={(timeline.application.unit_jobs as any)?.status}
                  jobId={(timeline.application.unit_jobs as any)?.jobs?.id || (timeline.application.unit_jobs as any)?.job_id}
                  unitJobId={(timeline.application as any)?.unit_job_id}
                />
              )}

              {!(timeline.application as any)?.synthetic && (
                <ApplicationStatusCard
                  applicationId={timeline.application.id}
                  jobId={(timeline.application.unit_jobs as any)?.job_id}
                />
              )}

              {/* ASO agendado — card destacado com endereço e horário */}
              <AsoScheduleBanner applicationId={timeline.application.id} />

              {/* Pós-teste online: orienta e permite agendar o teste presencial */}
              <PostTestPresencialCard />




              {/* Interview action blocks — matching Applications page pattern */}
              {(() => {
                const activeInterview = myInterviews?.find((i: any) =>
                  i.application_id === timeline.application.id &&
                  ["confirmed", "reschedule_requested", "pending_approval"].includes(i.status)
                );
                const terminalInterview = myInterviews?.find((i: any) =>
                  i.application_id === timeline.application.id &&
                  ["completed", "concluida", "no_show", "canceled"].includes(i.status)
                );
                const hasTerminalInterview = !!terminalInterview;

                return (
                  <>
                    {activeInterview?.status === "pending_approval" && (
                      <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3 space-y-1">
                        <div className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300">
                          <Clock className="h-4 w-4" />
                          Aguardando aprovação
                        </div>
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                          Sua solicitação para {formatDateBR(activeInterview.scheduled_date)} às {activeInterview.scheduled_time?.slice(0, 5)} está pendente de aprovação do recrutador.
                        </p>
                      </div>
                    )}

                    {activeInterview?.status === "reschedule_requested" && (
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
                          onClick={() => setSchedulingApp({
                            id: timeline.application.id,
                            unitId: (timeline.application.unit_jobs as any)?.unit_id || (timeline.application.unit_jobs as any)?.units?.id,
                            jobTitle: timeline.jobTitle,
                            jobDescription: (timeline.application.unit_jobs as any)?.jobs?.description,
                            jobId: (timeline.application.unit_jobs as any)?.job_id,
                          })}
                        >
                          <CalendarPlus className="h-3 w-3 mr-1" />
                          Escolher Novo Horário
                        </Button>
                      </div>
                    )}

                    {activeInterview && activeInterview.status !== "reschedule_requested" && activeInterview.status !== "pending_approval" && (
                      <div className="bg-accent/50 rounded-lg p-3 space-y-2">
                        <div className="space-y-1 text-sm">
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-primary shrink-0" />
                            <span className="font-medium min-w-0">
                              Entrevista: {formatDateBR(activeInterview.scheduled_date)} às {activeInterview.scheduled_time?.slice(0, 5)}
                            </span>
                          </div>
                          <div className="pl-6 text-xs text-muted-foreground">
                            Modalidade: {activeInterview.modality === "online" ? "Online" : activeInterview.modality === "ai_interview" ? "IA" : "Presencial"}
                          </div>
                        </div>
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full max-w-full">
                          {activeInterview.confirmed_at && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-sm w-full sm:w-auto min-h-[44px] px-3 inline-flex items-center justify-center gap-2 whitespace-nowrap"
                              onClick={() => setSchedulingApp({
                                id: timeline.application.id,
                                unitId: (timeline.application.unit_jobs as any)?.unit_id || (timeline.application.unit_jobs as any)?.units?.id,
                                jobTitle: timeline.jobTitle,
                                jobDescription: (timeline.application.unit_jobs as any)?.jobs?.description,
                                jobId: (timeline.application.unit_jobs as any)?.job_id,
                              })}
                            >
                              <CalendarPlus className="h-4 w-4 shrink-0" />
                              <span>Reagendar</span>
                            </Button>
                          )}
                          {!activeInterview.confirmed_at && (
                            <Button
                              size="sm"
                              variant="default"
                              className="text-sm w-full sm:w-auto min-h-[44px] px-3 inline-flex items-center justify-center gap-2 whitespace-nowrap"
                              disabled={confirmAttendance.isPending}
                              onClick={async () => {
                                try {
                                  await confirmAttendance.mutateAsync(activeInterview.id);
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
                          {activeInterview.confirmed_at && (
                            <Badge variant="secondary" className="text-[10px] w-full sm:w-auto justify-center bg-emerald-100/60 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                              <CheckCircle2 className="h-3 w-3 mr-1" />Presença confirmada
                            </Badge>
                          )}
                        </div>
                        {/* Aviso enquanto candidato não confirmou presença */}
                        {!activeInterview.confirmed_at && activeInterview.modality !== "ai_interview" && (
                          <div className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-2">
                            <Clock className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            <span>Confirme sua presença para liberar a entrada na sala.</span>
                          </div>
                        )}
                        {/* Link da reunião — só após confirmar presença e dentro da janela de 25min */}
                        {activeInterview.confirmed_at && activeInterview.modality === "online" && (() => {
                          const expired = isInterviewEntryExpired(activeInterview);
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
                          if (!activeInterview.meeting_link) {
                            return (
                              <div className="flex items-center gap-2 text-xs text-muted-foreground italic bg-muted rounded-md px-3 py-2">
                                <Video className="h-3.5 w-3.5 shrink-0" />
                                <span>O link da reunião será enviado em breve</span>
                              </div>
                            );
                          }
                          const href = resolveMeetingHref(activeInterview);
                          const internal = isLivekitInterview(activeInterview);
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
                        {activeInterview.modality === "presencial" && (
                          <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted rounded-md px-3 py-2">
                            <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            <span>Presencial — compareça à unidade no horário marcado</span>
                          </div>
                        )}
                      </div>
                    )}

                    {!activeInterview && terminalInterview && (() => {
                      const isNoShow = terminalInterview.status === "no_show";
                      const deadlineMs = terminalInterview.no_show_response_deadline
                        ? new Date(terminalInterview.no_show_response_deadline).getTime()
                        : null;
                      const canReschedNoShow =
                        isNoShow &&
                        !terminalInterview.no_show_resolution &&
                        deadlineMs !== null &&
                        deadlineMs > Date.now();
                      const hoursLeft = canReschedNoShow
                        ? Math.max(1, Math.ceil((deadlineMs! - Date.now()) / (1000 * 60 * 60)))
                        : 0;
                      return (
                        <div className="bg-accent/50 rounded-lg p-3 space-y-2">
                          <div className="space-y-1 text-sm">
                            <div className="flex items-center gap-2">
                              <Calendar className="h-4 w-4 text-primary shrink-0" />
                              <span className="font-medium min-w-0">
                                Entrevista: {formatDateBR(terminalInterview.scheduled_date)} às {terminalInterview.scheduled_time?.slice(0, 5)}
                              </span>
                            </div>
                            <div className="pl-6 text-xs text-muted-foreground">
                              Modalidade: {terminalInterview.modality === "online" ? "Online" : terminalInterview.modality === "ai_interview" ? "IA" : "Presencial"}
                            </div>
                          </div>
                          <Badge
                            variant="secondary"
                            className={`text-[10px] w-full sm:w-auto justify-center ${
                              isNoShow
                                ? "bg-amber-100/70 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                                : "bg-emerald-100/60 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                            }`}
                          >
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            {isNoShow ? "Ausência registrada" : terminalInterview.status === "canceled" ? "Cancelada" : "Entrevista concluída"}
                          </Badge>

                          {canReschedNoShow && (
                            <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 space-y-2">
                              <div className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300">
                                <Clock className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                                <span>
                                  Você ainda pode remarcar esta entrevista. Faltam aproximadamente <strong>{hoursLeft}h</strong> antes que seu processo seja movido para standby.
                                </span>
                              </div>
                              {hasApplicationUnit && (
                                <Button
                                  size="sm"
                                  variant="default"
                                  className="w-full text-xs"
                                  onClick={() => setSchedulingApp({
                                    id: timeline.application.id,
                                    unitId: applicationUnitId,
                                    jobTitle: timeline.jobTitle,
                                    jobDescription: (timeline.application.unit_jobs as any)?.jobs?.description,
                                    jobId: (timeline.application.unit_jobs as any)?.job_id,
                                  })}
                                >
                                  <CalendarPlus className="h-3 w-3 mr-1" />
                                  Remarcar Entrevista
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* Aviso explícito durante "em_avaliacao" — entrevista bloqueada até aprovação humana */}
                    {timeline.application.status === "em_avaliacao" && !activeInterview && !hasTerminalInterview && (
                      <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3 space-y-1">
                        <div className="flex items-center gap-2 text-sm font-medium text-purple-800 dark:text-purple-300">
                          <Clock className="h-4 w-4" />
                          Aguardando avaliação do recrutador
                        </div>
                        <p className="text-xs text-purple-700 dark:text-purple-400">
                          Você concluiu o teste. Nossa equipe está analisando suas respostas e em breve você receberá uma resposta.
                        </p>
                      </div>
                    )}

                    {/* Botão Agendar Entrevista — apenas quando aprovado pelo recrutador, sem entrevista ativa e sem terminal */}
                    {canSelfSchedule && !myInterviewsLoading && myInterviews !== undefined && (timeline.application.status === "aprovado" || (timeline.application as any).currentRestartMode === "entrevista") && !activeInterview && !hasTerminalInterview && (
                      hasApplicationUnit ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full text-xs"
                          onClick={() => setSchedulingApp({
                            id: timeline.application.id,
                            unitId: applicationUnitId,
                            jobTitle: timeline.jobTitle,
                            jobDescription: (timeline.application.unit_jobs as any)?.jobs?.description,
                            jobId: (timeline.application.unit_jobs as any)?.job_id,
                          })}
                        >
                          <CalendarPlus className="h-3 w-3 mr-1" />
                          Agendar Entrevista
                        </Button>
                      ) : timeline.application.status === "aprovado" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full text-xs"
                          onClick={() => navigate("/oportunidades")}
                        >
                          <Search className="h-3 w-3 mr-1" />
                          Escolher unidade
                        </Button>
                      ) : null
                    )}
                  </>
                );
              })()}

              {/* Interview History */}
              {timeline.allInterviews && timeline.allInterviews.length > 1 && (
                <InterviewHistory
                  interviews={timeline.allInterviews.filter((i: any) => i.status !== "confirmed")}
                  onReschedule={(iv) => setSchedulingApp({
                    id: timeline.application.id,
                    unitId: (timeline.application.unit_jobs as any)?.unit_id || (timeline.application.unit_jobs as any)?.units?.id,
                    jobTitle: timeline.jobTitle,
                    jobDescription: (timeline.application.unit_jobs as any)?.jobs?.description,
                    jobId: (timeline.application.unit_jobs as any)?.job_id,
                  })}
                />
              )}
            </CardContent>
          </Card>
        )
      ) : (
        <Card data-tour="timeline" className="border-0 shadow-sm">
          <CardContent className="p-4 text-center space-y-1">
            <p className="text-sm font-semibold text-foreground">Status do Processo Seletivo</p>
            <p className="text-xs text-muted-foreground">Nenhum processo ativo. Explore as oportunidades disponíveis!</p>
          </CardContent>
        </Card>
      )}



      {timeline?.nextInterview && (
        <Card className="border-0 shadow-sm bg-primary/5">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-primary/10 text-primary">
              <Calendar className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">Entrevista agendada</p>
              <p className="text-xs text-muted-foreground">
                {format(ymdToLocalDate(timeline.nextInterview.scheduled_date) ?? new Date(), "dd 'de' MMMM", { locale: ptBR })}
                {" às "}
                {(timeline.nextInterview.scheduled_time as string)?.slice(0, 5)}
                {timeline.nextInterview.units && ` · ${(timeline.nextInterview.units as any).name}`}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pending Tests Card */}
      {pendingTestsCount > 0 && (
        <Link to="/meus-testes">
          <Card className="border-0 shadow-sm bg-purple-500/5">
            <CardContent className="flex items-center gap-4 p-4">
              <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-purple-500/10 text-purple-600">
                <ClipboardList className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">Testes pendentes</p>
                <p className="text-xs text-muted-foreground">
                  {pendingTestsCount} {pendingTestsCount === 1 ? "teste aguardando" : "testes aguardando"} sua ação
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
      )}

      {/* Pending Docs Card */}
      {timeline?.docRequest && timeline.docsUploaded < timeline.docsTotal && (
        <Link to={`/documentos/${timeline.application.id}`}>
          <Card className="border-0 shadow-sm bg-accent/10">
            <CardContent className="flex items-center gap-4 p-4">
              <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-accent/20 text-accent-foreground">
                <FileText className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">Documentos pendentes</p>
                <p className="text-xs text-muted-foreground">
                  {timeline.docsUploaded} de {timeline.docsTotal} enviados
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
      )}

      {/* Módulos Grid */}
      <div className="space-y-2.5">
        <p className="text-sm font-semibold text-foreground/80">Módulos</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {modules.filter(m => !(m.to === "/oportunidades" && hasActiveApplicationBlockingDiscovery(timeline))).map((mod, i) => (
            <Link key={mod.to} to={mod.to}>
              <Card
                className="animate-stagger-item border-0 shadow-sm hover:shadow-md transition-all hover:scale-[1.02] active:scale-[0.98] relative overflow-visible"
                style={{ "--stagger-index": i } as React.CSSProperties}
                {...(mod.tourId ? { "data-tour": mod.tourId } : {})}
              >
                {mod.title === "Avisos" && !!unreadNotifCount && unreadNotifCount > 0 && (
                  <Badge className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground text-[10px] h-5 min-w-5 flex items-center justify-center rounded-full px-1.5 z-10">
                    {unreadNotifCount}
                  </Badge>
                )}
                {mod.title === "Ajuda e FAQ" && !!unreadFaqCount && unreadFaqCount > 0 && (
                  <Badge className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground text-[10px] h-5 min-w-5 flex items-center justify-center rounded-full px-1.5 z-10">
                    {unreadFaqCount}
                  </Badge>
                )}
                {mod.title === "Mensagens" && !!unreadMsgCount && unreadMsgCount > 0 && (
                  <Badge className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground text-[10px] h-5 min-w-5 flex items-center justify-center rounded-full px-1.5 z-10">
                    {unreadMsgCount}
                  </Badge>
                )}
                <CardContent className="flex flex-col items-center justify-center gap-1.5 p-3">
                  <div className={`flex items-center justify-center w-10 h-10 rounded-full ${mod.color} text-white`}>
                    <mod.icon className="h-[18px] w-[18px]" />
                  </div>
                  <span className="text-[12px] leading-tight font-medium text-foreground text-center">{mod.title}</span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      {/* Interview Scheduler Dialog */}
      {schedulingApp && (
        <InterviewScheduler
          applicationId={schedulingApp.id}
          unitId={schedulingApp.unitId}
          jobTitle={schedulingApp.jobTitle}
          jobDescription={schedulingApp.jobDescription}
          jobId={schedulingApp.jobId}
          open={!!schedulingApp}
          onOpenChange={() => setSchedulingApp(null)}
        />
      )}
    </div>
  );
}
