/**
 * ApplicationStatusCard
 *
 * ⚠️ TODA decisão visual do stepper (status de cada etapa, cor das linhas)
 * vive em `src/lib/stepperState.ts` (função pura `computeStepperState`).
 * NÃO adicione `if`s de status visual neste arquivo. Adicione regras lá
 * e cubra com teste em `src/lib/__tests__/stepperState.test.ts`.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, Circle, PlayCircle, FileText, ClipboardList, CalendarDays, Bot, Loader2, AlertCircle, User, Building, ChevronUp, Clock, Video, MapPin, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useApplicationStatus, type PendingItem, type PhaseStatus, type InterviewInfo } from "@/hooks/useApplicationStatus";
import { PostInterviewModalityCard } from "@/components/candidate/PostInterviewModalityCard";
import { useInterviewApprovalGate } from "@/hooks/useInterviewApprovalGate";
import { computeStepperState, GENERIC_STAGES, type GenericStage, type GenericStageData } from "@/lib/stepperState";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { formatDateTimeBR } from "@/lib/dateUtils";
import { cn } from "@/lib/utils";
import { resolveMeetingHref, isLivekitInterview, isInterviewEntryExpired, INTERVIEW_ENTRY_GRACE_MINUTES } from "@/lib/interviewMeetingLink";

interface Props {
  applicationId: string;
  jobId?: string;
}

const responsibleConfig = {
  candidato: { label: "Você", icon: User, className: "bg-primary/10 text-primary" },
  recrutador: { label: "Recrutador", icon: Building, className: "bg-secondary text-secondary-foreground" },
  gestor: { label: "Gestor", icon: Building, className: "bg-accent text-accent-foreground" },
  sistema: { label: "Sistema", icon: Bot, className: "bg-muted text-muted-foreground" },
};

// Re-export para compatibilidade com imports legados.
// Tipos/constantes canônicas vivem em `@/lib/stepperState`.
export { GENERIC_STAGES, classifyPhase, type GenericStage, type GenericStageData } from "@/lib/stepperState";

// Friendly descriptions for each generic stage
const STAGE_DESCRIPTIONS: Record<GenericStage, string> = {
  "Inscrição": "Seu cadastro e candidatura à vaga",
  "Avaliação": "Testes, questionários e análise do perfil",
  "Entrevista": "Conversa com a equipe de recrutamento",
  "Documentação": "Envio e validação de documentos",
  "Resultado": "Decisão final do processo seletivo",
};

// Estimated time for each stage
const STAGE_ESTIMATES: Record<GenericStage, string> = {
  "Inscrição": "Concluída automaticamente",
  "Avaliação": "Geralmente leva 1–3 dias",
  "Entrevista": "Você será notificado para agendar",
  "Documentação": "Depende do envio dos seus documentos",
  "Resultado": "Aguarde a decisão final",
};


function SubPhaseIcon({ status }: { status: PhaseStatus["status"] }) {
  if (status === "completed") return <CheckCircle2 className="h-3 w-3 text-primary shrink-0" />;
  if (status === "current") return <Circle className="h-3 w-3 text-primary fill-primary shrink-0" />;
  if (status === "rejected") return <AlertCircle className="h-3 w-3 text-destructive shrink-0" />;
  return <Circle className="h-3 w-3 text-muted-foreground/40 shrink-0" />;
}

export function ApplicationStatusCard({ applicationId, jobId }: Props) {
  const navigate = useNavigate();
  const { data: status, isLoading } = useApplicationStatus(applicationId, jobId);
  const { data: interviewGate } = useInterviewApprovalGate(applicationId);
  const [expandedStage, setExpandedStage] = useState<GenericStage | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        <span className="text-sm">Carregando progresso...</span>
      </div>
    );
  }

  if (!status) return null;

  // If hired, show celebration instead of timeline
  if (status.appStatus === "contratado") {
    return (
      <div className="bg-emerald-100/60 dark:bg-emerald-900/20 rounded-lg p-4 text-center space-y-1">
        <p className="text-sm text-emerald-800 dark:text-emerald-300 font-semibold">
          🎉 Processo concluído — Contratado(a)!
        </p>
        <p className="text-xs text-emerald-700/80 dark:text-emerald-400/80">
          Parabéns! Você concluiu todas as etapas com sucesso.
        </p>
        {status.workStartAt && (
          <p className="text-xs font-medium text-emerald-800 dark:text-emerald-300 flex items-center justify-center gap-1.5 pt-1">
            <CalendarDays className="h-3.5 w-3.5 shrink-0" />
            Início: {formatDateTimeBR(status.workStartAt)}
          </p>
        )}
      </div>
    );
  }

  const allPending: PendingItem[] = status.pendingItems;
  const candidatePending = allPending.filter((p) => p.responsible === "candidato");
  const otherPending = allPending.filter((p) => p.responsible !== "candidato");

  // FONTE ÚNICA de verdade visual — não adicione `if`s de status aqui.
  const { stages: genericStages, lineColors } = computeStepperState({
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

  const isApprovedPendingDocs = status.appStatus === "aprovado" && status.docPendingCount > 0;
  const allDocsSentWaitingApproval = isApprovedPendingDocs && status.docTotalCount > 0 && status.docSentCount >= status.docTotalCount;
  const completedCount = genericStages.filter(s => s.status === "completed").length;

  const lineClassFor = (color: "green" | "yellow" | "gray") =>
    color === "green" ? "bg-green-500" : color === "yellow" ? "bg-yellow-400" : "bg-muted-foreground/20";

  const renderCandidatePending = () => (
    <div id={`pending-${applicationId}`} className="space-y-2">
      <p className="text-xs font-semibold text-foreground flex items-center gap-1">
        <AlertCircle className="h-3 w-3 text-warning" />
        Ação necessária — continue agora
      </p>
      {candidatePending.map((item, idx) => {
        // Gate de modalidade do teste pós-entrevista: card próprio
        if ((item.type === "teste_modalidade" || item.type === "teste_agendar") && status.postInterviewTest) {
          return (
            <PostInterviewModalityCard
              key={idx}
              applicationId={applicationId}
              state={status.postInterviewTest}
            />
          );
        }
        const isTriagem = item.type === "triagem";
        return (
          <Button
            key={idx}
            size="sm"
            variant="secondary"
            className={
              isTriagem
                ? "w-full min-w-0 justify-between gap-2 overflow-hidden whitespace-normal h-auto min-h-11 py-2.5 bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-400 motion-safe:animate-pulse-ring transition-colors dark:bg-amber-950/40 dark:hover:bg-amber-900/40 dark:text-amber-100 dark:border-amber-700 shadow-sm"
                : "w-full min-w-0 justify-between gap-2 overflow-hidden whitespace-normal h-auto min-h-11 py-2.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-950/30 dark:text-amber-100 dark:border-amber-800"
            }
            onClick={() => {
              if (item.onAction) item.onAction();
              else if (item.actionUrl) navigate(item.actionUrl);
            }}
          >
            <span className="flex items-center gap-2 min-w-0 flex-1">
              {isTriagem && <PlayCircle className="h-4 w-4 text-amber-600 motion-safe:animate-pulse" />}
              {item.type === "teste" && <ClipboardList className="h-4 w-4" />}
              {item.type === "documentos" && <FileText className="h-4 w-4" />}
              {item.type === "entrevista_agendar" && <CalendarDays className="h-4 w-4" />}
              <span className="text-left leading-snug min-w-0 break-words">{item.label}</span>
            </span>
            {item.actionLabel && (
              <Badge
                variant={isTriagem ? "default" : "outline"}
                className={
                  isTriagem
                    ? "text-[10px] shrink-0 bg-amber-500 hover:bg-amber-500 text-white border-transparent"
                    : "text-[10px] shrink-0"
                }
              >
                {item.actionLabel}
              </Badge>
            )}
          </Button>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Pendência do candidato — promovida acima do stepper para evitar scroll no mobile */}
      {candidatePending.length > 0 && renderCandidatePending()}

      {/* Teste presencial agendado (sem pendência ativa) */}
      {candidatePending.length === 0 && status.postInterviewTest?.stage === "scheduled" && (
        <PostInterviewModalityCard applicationId={applicationId} state={status.postInterviewTest} />
      )}

      {/* Simplified Pipeline Stepper — 5 generic stages */}
      <div className="grid grid-cols-5 items-start pb-1 w-full min-w-0">

        {genericStages.map((stage, idx) => {
          const leftLineColor = idx === 0 ? "bg-transparent" : lineClassFor(lineColors[idx - 1]);
          const rightLineColor = idx === genericStages.length - 1 ? "bg-transparent" : lineClassFor(lineColors[idx]);


          return (
          <div key={stage.name} className="flex items-start min-w-0">
            <div className="flex flex-col items-center gap-1 w-full min-w-0">
              <div className="flex items-center w-full">
                <div className={cn("flex-1 h-0.5", leftLineColor)} />
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setExpandedStage(expandedStage === stage.name ? null : stage.name)}
                    className={cn(
                      "w-7 h-7 rounded-full flex items-center justify-center border-2 transition-colors shrink-0 cursor-pointer hover:brightness-110 hover:shadow-sm",
                      stage.status === "completed" && "bg-green-500 border-green-500 text-white",
                      stage.status === "current" && "border-yellow-500 bg-yellow-50 text-yellow-600 animate-pulse",
                      stage.status === "future" && "border-muted-foreground/30 bg-muted text-muted-foreground",
                      stage.status === "rejected" && "border-destructive bg-destructive/10 text-destructive",
                      expandedStage === stage.name && "ring-2 ring-primary/30"
                    )}
                  >
                    {stage.status === "completed" ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : stage.status === "current" ? (
                      <Circle className="h-3 w-3 fill-current" />
                  ) : stage.status === "rejected" ? (
                    <AlertCircle className="h-3.5 w-3.5" />
                  ) : (
                    <Circle className="h-3 w-3" />
                  )}
                  </button>
                  {candidatePending.length > 0 && stage.status === "current" && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center text-[9px] font-bold leading-none">!</span>
                  )}
                </div>
                <div className={cn("flex-1 h-0.5", rightLineColor)} />
              </div>
              <button
                type="button"
                onClick={() => setExpandedStage(expandedStage === stage.name ? null : stage.name)}
                className={cn(
                  "text-[10px] w-full px-0.5 text-center leading-tight cursor-pointer hover:underline break-words min-w-0",
                  stage.status === "current" && "font-semibold text-yellow-600",
                  stage.status === "completed" && "text-green-600",
                  stage.status === "rejected" && "text-destructive font-medium",
                  stage.status === "future" && "text-muted-foreground",
                  expandedStage === stage.name && "font-semibold"
                )}
              >
                {stage.name}
              </button>
            </div>
          </div>
          );
        })}
      </div>

      {/* Documentos pendentes em PARALELO — etapa atual NÃO muda */}
      {status.pendingAction === "documents" && status.appStatus !== "aprovado" && status.appStatus !== "contratado" && status.appStatus !== "standby" && status.appStatus !== "reprovado" && status.appStatus !== "desistente" && status.appStatus !== "desligado" && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3 space-y-2">
          <p className="text-xs font-semibold text-yellow-800 dark:text-yellow-300 flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5 shrink-0" />
            Documentos pendentes para continuar o processo
          </p>
          <p className="text-[11px] text-yellow-700 dark:text-yellow-400">
            {interviewGate?.blocked
              ? "Você só poderá enviar os documentos após ser aprovado(a) na entrevista."
              : "Envie os documentos solicitados — sua etapa atual continua ativa."}
          </p>
          <Button
            size="sm"
            className="w-full h-8 text-xs bg-yellow-600 hover:bg-yellow-700 text-white disabled:opacity-60"
            disabled={!!interviewGate?.blocked}
            onClick={() => navigate(`/documentos/${applicationId}`)}
          >
            {interviewGate?.blocked ? "Aguardando aprovação da entrevista" : "Enviar Documentos"}
          </Button>
        </div>
      )}

      {/* Approved with pending documentation banner */}
      {isApprovedPendingDocs && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-3 space-y-1">
          <p className="text-xs font-semibold text-yellow-800 dark:text-yellow-300 flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            {allDocsSentWaitingApproval
              ? "Aprovado (aguardando aprovação de documentos)"
              : "Você foi aprovado nessa etapa (Aguardando documentação)"}
          </p>
          <p className="text-[11px] text-yellow-700 dark:text-yellow-400">
            {allDocsSentWaitingApproval
              ? "Todos os documentos foram enviados. Aguarde a análise da equipe."
              : "Você foi aprovado nessa etapa (Aguardando documentação)."}
          </p>
        </div>
      )}

      {/* Expanded stage detail */}
      {expandedStage && (() => {
        const stage = genericStages.find(s => s.name === expandedStage);
        if (!stage) return null;
        return (
          <div className="bg-muted/50 rounded-lg px-3 py-2.5 space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-foreground">{stage.name}</p>
                <p className="text-[11px] text-muted-foreground">{STAGE_DESCRIPTIONS[stage.name]}</p>
              </div>
              <button
                type="button"
                onClick={() => setExpandedStage(null)}
                className="text-muted-foreground hover:text-foreground p-0.5"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
            </div>
            {stage.subPhases.length > 0 ? (
              <div className="space-y-1">
                {stage.subPhases.map((sub, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <SubPhaseIcon status={sub.status} />
                    <span className={cn(
                      sub.status === "completed" ? "text-muted-foreground line-through" : 
                      sub.status === "current" ? "text-foreground font-medium" : "text-muted-foreground"
                    )}>
                      {sub.name}
                    </span>
                    {sub.status === "current" && (
                      <Badge variant="outline" className="text-[9px] ml-auto bg-primary/5 text-primary border-primary/20">
                        Em andamento
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground italic">Esta etapa será liberada em breve</p>
            )}
            {/* Interview info when Entrevista stage is expanded */}
            {stage.name === "Entrevista" && (() => {
              const interviews = status.interviewInfo;
              // Reschedule requested
              const rescheduleRequested = interviews?.filter(i => i.status === "reschedule_requested");
              if (rescheduleRequested && rescheduleRequested.length > 0) {
                return (
                  <div className="flex items-center gap-1.5 text-[11px] text-yellow-700 dark:text-yellow-400 font-medium bg-yellow-50 dark:bg-yellow-900/20 rounded px-2 py-1.5">
                    <Clock className="h-3.5 w-3.5 shrink-0" />
                    <span>Escolha um novo horário para sua entrevista</span>
                  </div>
                );
              }
              const pendingApproval = interviews?.filter(i => i.status === "pending_approval");
              if (pendingApproval && pendingApproval.length > 0) {
                const iv = pendingApproval[0];
                const dateStr = format(new Date(iv.scheduled_date + "T00:00:00"), "dd 'de' MMMM", { locale: ptBR });
                const timeStr = iv.scheduled_time?.slice(0, 5);
                return (
                  <div className="flex items-center gap-1.5 text-[11px] text-yellow-700 dark:text-yellow-400 font-medium bg-yellow-50 dark:bg-yellow-900/20 rounded px-2 py-1.5">
                    <Clock className="h-3.5 w-3.5 shrink-0" />
                    <span>Aguardando aprovação do recrutador — {dateStr} às {timeStr}</span>
                  </div>
                );
              }
              const scheduled = interviews?.filter(i => i.status === "confirmed");
              if (scheduled && scheduled.length > 0) {
                const iv = scheduled[0];
                const dateStr = format(new Date(iv.scheduled_date + "T00:00:00"), "dd 'de' MMMM", { locale: ptBR });
                const timeStr = iv.scheduled_time?.slice(0, 5);
                const isOnline = iv.modality === "online";
                return (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-1.5 text-[11px] text-primary font-medium bg-primary/5 rounded px-2 py-1.5">
                      <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                      <span>Agendada para {dateStr} às {timeStr}</span>
                    </div>
                    {isOnline ? (() => {
                      const expired = isInterviewEntryExpired(iv);
                      if (expired) {
                        return (
                          <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground bg-muted border border-border rounded px-2 py-1.5">
                            <Video className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            <span>
                              Janela de entrada encerrada ({INTERVIEW_ENTRY_GRACE_MINUTES} min após o horário). Solicite reagendamento.
                            </span>
                          </div>
                        );
                      }
                      if (!iv.meeting_link) {
                        return (
                          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground italic bg-muted rounded px-2 py-1.5">
                            <Video className="h-3.5 w-3.5 shrink-0" />
                            <span>O link da reunião será enviado em breve</span>
                          </div>
                        );
                      }
                      const href = resolveMeetingHref(iv);
                      const internal = isLivekitInterview(iv);
                      if (!href) return null;
                      return (
                        <a
                          href={href}
                          {...(internal ? {} : { target: "_blank", rel: "noopener noreferrer" })}
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center justify-between gap-2 text-xs font-semibold text-primary-foreground bg-primary hover:bg-primary/90 transition-colors rounded-md px-3 py-2 shadow-sm"
                        >
                          <span className="flex items-center gap-2">
                            <Video className="h-4 w-4 shrink-0" />
                            Entrar na reunião online
                          </span>
                          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                        </a>
                      );
                    })() : iv.modality === "presencial" ? (
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground bg-muted rounded px-2 py-1.5">
                        <MapPin className="h-3.5 w-3.5 shrink-0" />
                        <span>Presencial — compareça à unidade no horário marcado</span>
                      </div>
                    ) : null}
                  </div>
                );
              }
              if (interviews && interviews.some(i => i.status === "completed")) {
                const approved = status.appStatus === "aprovado" || status.appStatus === "apto_para_vaga" || status.appStatus === "contratado";
                return (
                  <div className={`flex items-center gap-1.5 text-[11px] font-medium rounded px-2 py-1.5 ${approved ? "text-green-600 bg-green-500/5" : "text-muted-foreground bg-muted"}`}>
                    {approved ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <Clock className="h-3.5 w-3.5 shrink-0" />}
                    <span>{approved ? "Entrevista realizada" : "Entrevista realizada — aguardando avaliação do recrutador"}</span>
                  </div>
                );
              }
              if (stage.status === "current" || stage.status === "future") {
                return (
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground bg-muted rounded px-2 py-1.5">
                    <Clock className="h-3.5 w-3.5 shrink-0" />
                    <span>Aguardando agendamento</span>
                  </div>
                );
              }
              return null;
            })()}
            {/* Time estimate */}
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground pt-1 border-t border-muted-foreground/10">
              <Clock className="h-3 w-3 shrink-0" />
              <span>{stage.name === "Entrevista" && status.interviewInfo?.some(i => i.status === "pending_approval") ? "Aguardando aprovação do recrutador" : stage.name === "Entrevista" && status.interviewInfo?.some(i => i.status === "confirmed") ? "Confira a data acima" : stage.name === "Entrevista" && status.interviewInfo?.some(i => i.status === "reschedule_requested") ? "Aguardando nova data" : STAGE_ESTIMATES[stage.name]}</span>
            </div>
          </div>
        );
      })()}

      {/* Progress summary — based on 5 generic stages */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        {candidatePending.length > 0 ? (
          <span className="text-yellow-600 font-medium flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            Progresso pausado — ação necessária
          </span>
        ) : (
          <span>{completedCount} de {GENERIC_STAGES.length} etapas concluídas</span>
        )}
        <span>Atualizado em {new Date(status.lastUpdate).toLocaleDateString("pt-BR")}</span>
      </div>

      {/* Candidate pending items are rendered above the stepper (see renderCandidatePending) */}



      {/* Other pending (info only) */}
      {otherPending.length > 0 && (
        <div className="space-y-1.5">
          {otherPending.map((item, idx) => {
            const rc = responsibleConfig[item.responsible];
            const isWaitingReview =
              item.responsible === "recrutador" &&
              typeof item.label === "string" &&
              item.label.toLowerCase().includes("aguardando avalia");

            if (isWaitingReview) {
              return (
                <div
                  key={idx}
                  className="bg-amber-50/80 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2.5 space-y-1"
                >
                  <p className="text-xs font-semibold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 shrink-0" />
                    Em análise pela unidade
                  </p>
                  <p className="text-[11px] text-amber-800/90 dark:text-amber-300/90 leading-relaxed">
                    A equipe está revisando seu perfil. Geralmente leva de 1 a 3 dias úteis.
                    Você será avisado por aqui assim que houver novidade 💛
                  </p>
                </div>
              );
            }

            return (
              <div key={idx} className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
                {item.type === "entrevista_feedback" && <CalendarDays className="h-3.5 w-3.5" />}
                {item.type === "avaliacao_ia" && <Bot className="h-3.5 w-3.5" />}
                <span className="flex-1">{item.label}</span>
                <Badge variant="outline" className={cn("text-[9px]", rc.className)}>
                  {rc.label}
                </Badge>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
