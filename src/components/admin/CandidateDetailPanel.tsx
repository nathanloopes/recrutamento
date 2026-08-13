import { useState, useCallback, useEffect, useRef } from "react";
import { useJobAutoApprovesTest } from "@/hooks/useJobAutoApprovesTest";
import { autoApproveIfNoTest } from "@/lib/pipelineProgression";
import { exportToCSV } from "@/hooks/useAuditLogs";
import { toast } from "sonner";
import { formatDateBR } from "@/lib/dateUtils";
import { getCandidateStatus } from "@/lib/candidateStatus";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useCandidateDetail, useCandidateDocRequests, useExistingDocRequest } from "@/hooks/useCandidatesByJob";
import { useTestAssignments } from "@/hooks/useTests";
import { useUpdateInterview, useApproveInterview, useRejectInterview } from "@/hooks/useScheduling";
import { useRecordAttendance } from "@/hooks/useAttendanceLogs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { useSendNotification } from "@/hooks/useNotifications";
import { TestAssignDialog } from "@/components/admin/TestAssignDialog";
import { DocumentRequestDialog } from "@/components/admin/DocumentRequestDialog";
import { InlineDocumentReview } from "@/components/admin/InlineDocumentReview";
import { useInterviewApprovalGate } from "@/hooks/useInterviewApprovalGate";
import { toDocNames } from "@/lib/docNames";
import { ApplicationJourneyTimeline } from "@/components/admin/ApplicationJourneyTimeline";
import { InterviewDecisionDialog, type InterviewDecisionTarget } from "@/components/admin/scheduling/InterviewDecisionDialog";
import {
  DEFAULT_POST_EVALUATION_STANDBY_REASON,
} from "@/lib/userMessages";
import { CloseProcessDialog } from "@/components/admin/CloseProcessDialog";
import {
  User,
  FileText,
  GraduationCap,
  Video,
  Mail,
  Phone,
  MapPin,
  Calendar,
  FolderOpen,
  CheckCircle2,
  XCircle,
  ClipboardList,
  AlertTriangle,
  Download,
  MessageSquare,
  Brain,
  Info,
  FileUp,
  ClipboardCheck,
  Sparkles,
  Link as LinkIcon,
  FlaskConical,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { getStorageClient } from "@/lib/storageDirect";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { format } from "date-fns";

const INTERVIEW_STATUS_LABELS: Record<string, string> = {
  confirmed: "Confirmada",
  completed: "Concluída",
  cancelled: "Cancelada",
  rescheduled: "Remarcada",
  reschedule_requested: "Aguardando Reagendamento",
  pending_approval: "Pendente Aprovação",
  no_show: "Não compareceu",
};

interface CandidateDetailPanelProps {
  application: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  unitJob?: any;
}

export function CandidateDetailPanel({
  application,
  open,
  onOpenChange,
  unitJob,
}: CandidateDetailPanelProps) {
  const [docDialogOpen, setDocDialogOpen] = useState(false);
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [closeProcessOpen, setCloseProcessOpen] = useState(false);


  const { profile, documents, stepResponses, interviews, isLoading } =
    useCandidateDetail(application?.candidate_id, application?.id);

  const { data: existingRequest } = useExistingDocRequest(application?.id);
  const { data: documentGate } = useInterviewApprovalGate(application?.id);
  const documentRequestBlocked = documentGate?.approved !== true;

  const { data: docRequests } = useCandidateDocRequests(
    application?.candidate_id,
    application?.id
  );

  const { data: testAssignments } = useTestAssignments({ applicationId: application?.id });

  const initials = (profile?.full_name || "?")
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  // Split step responses by phase kind
  const isPostInterview = (r: any) =>
    r?.pipeline_steps?.pipeline_phases?.phase_kind === "avaliacao_pos_entrevista";
  const postInterviewResponses = stepResponses.filter(isPostInterview);
  const triageResponses = stepResponses.filter((r: any) => !isPostInterview(r));

  const computePct = (rows: any[]) => {
    const totalW = rows.reduce((s: number, r: any) => s + (r.pipeline_steps?.weight || 1), 0);
    const wScore = rows.reduce(
      (s: number, r: any) => s + (r.score || 0) * (r.pipeline_steps?.weight || 1),
      0
    );
    return totalW > 0 ? Math.round((wScore / (totalW * 100)) * 100) : 0;
  };

  // Calculate test score percentage (overall — kept for downstream consumers)
  const scorePercent = computePct(stepResponses);
  const triageScorePercent = computePct(triageResponses);
  const postInterviewScorePercent = computePct(postInterviewResponses);

  // Derive display status: approved + pending docs = intermediate state
  const allRequestedDocs = new Set<string>();
  (docRequests || []).forEach((req: any) => {
    [...toDocNames(req.documents_list), ...toDocNames(req.custom_documents)].forEach((d) => allRequestedDocs.add(d));
  });
  const docTotal = allRequestedDocs.size;

  // Count unique doc types that are approved/uploaded (not raw upload records)
  const uploadsByDocType: Record<string, string[]> = {};
  (documents || []).forEach((d: any) => {
    const key = d.document_type;
    if (!uploadsByDocType[key]) uploadsByDocType[key] = [];
    uploadsByDocType[key].push(d.status);
  });
  let docApproved = 0;
  let docUploaded = 0;
  for (const doc of allRequestedDocs) {
    const statuses = uploadsByDocType[doc];
    if (statuses && statuses.includes("approved")) docApproved++;
    if (statuses && statuses.length > 0) docUploaded++;
  }
  const candStatus = getCandidateStatus({
    application,
    interviews: interviews || null,
    docContext: {
      docTotal,
      docApproved,
      docUploaded,
      hasPostInterviewTestAssigned: (application as any)?.post_interview_test_assigned === true,
    },
  });
  const displayStatus = candStatus.code;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Detalhes do Candidato</SheetTitle>
          <SheetDescription>
            Informações completas, documentos, teste e entrevista.
          </SheetDescription>
        </SheetHeader>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin h-6 w-6 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        ) : (
          <div className="space-y-6 mt-4">
            {/* === BANNER DESISTENTE === */}
            {application?.status === "desistente" && (
              <Alert variant="destructive" className="border-destructive/50 bg-destructive/5">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Candidato desistente — processo encerrado</AlertTitle>
                <AlertDescription>
                  {application.withdrawal_reason
                    ? `Motivo: ${application.withdrawal_reason}`
                    : "Motivo não informado"}
                  {application.updated_at && (
                    <span className="block text-[11px] mt-1 opacity-70">
                      Em {format(new Date(application.updated_at), "dd/MM/yyyy 'às' HH:mm")}
                    </span>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {/* === BANNER PAUSADO === */}
            {application?.status === "pausado" && (
              <Alert className="border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <AlertTitle className="text-amber-700 dark:text-amber-400">Candidato pausado — pipeline encerrado</AlertTitle>
                <AlertDescription className="text-amber-600 dark:text-amber-300">
                  Histórico preservado. Candidato disponível no Banco de Talentos para reativação.
                  {application.updated_at && (
                    <span className="block text-[11px] mt-1 opacity-70">
                      Em {format(new Date(application.updated_at), "dd/MM/yyyy 'às' HH:mm")}
                    </span>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {/* === BANNER STANDBY (com ação encerrar processo) === */}
            {application?.status === "standby" && (
              <Alert className="border-yellow-300 bg-yellow-50 dark:bg-yellow-950/20 dark:border-yellow-700">
                <AlertTriangle className="h-4 w-4 text-yellow-600" />
                <AlertTitle className="text-yellow-700 dark:text-yellow-400 flex items-center justify-between gap-2">
                  <span>Candidato em standby — Lista de Oportunidade</span>
                </AlertTitle>
                <AlertDescription className="text-yellow-700 dark:text-yellow-300 space-y-2">
                  {application.standby_reason && (
                    <p className="text-xs italic">Motivo enviado ao candidato: "{application.standby_reason}"</p>
                  )}
                  <p className="text-xs">O candidato segue no Banco de Talentos. Se não houver intenção de seguir, você pode encerrar o processo definitivamente.</p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-destructive/40 text-destructive hover:bg-destructive/10"
                    onClick={() => setCloseProcessOpen(true)}
                  >
                    <XCircle className="h-3.5 w-3.5 mr-1" /> Encerrar processo
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {/* === STATUS + SCORE DO CANDIDATO === */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {candStatus && (
                  <Badge className={`text-[11px] border ${candStatus.className}`}>
                    {candStatus.label}
                  </Badge>
                )}
                {(displayStatus === "aprovado_pendente_documentacao" || displayStatus === "aprovado_aguardando_aprovacao_docs") && (
                  <span className="text-[11px] text-yellow-600 dark:text-yellow-400">
                    {docApproved}/{docTotal} docs
                  </span>
                )}
              </div>
              {scorePercent > 0 && (
                <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold ${
                  scorePercent >= 70 ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
                  scorePercent >= 40 ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" :
                  "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                }`}>
                  <GraduationCap className="h-3.5 w-3.5" />
                  {scorePercent}%
                </div>
              )}
            </div>

            {/* === SEÇÃO 1: PERFIL === */}
            <ProfileSection profile={profile} initials={initials} />

            <Separator />

            {/* === SEÇÃO: CURRÍCULO === */}
            <ResumeSection candidateId={application?.candidate_id} />

            <Separator />

            {/* === SEÇÃO 2: DOCUMENTOS (unified) === */}
            {(application?.status === "desistente" || application?.status === "pausado") ? (
              <section className="space-y-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <FolderOpen className="h-4 w-4 text-muted-foreground" /> Documentos
                </h3>
                <p className="text-sm text-muted-foreground italic">
                  {application?.status === "pausado" ? "Encerrado por pausa" : "Cancelado por desistência"}
                </p>
              </section>
            ) : (
              <>
                <InlineDocumentReview
                  docRequests={docRequests || []}
                  documents={documents}
                  candidateId={application?.candidate_id}
                  applicationId={application?.id}
                />
                {!existingRequest && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    disabled={documentRequestBlocked}
                    onClick={() => setDocDialogOpen(true)}
                  >
                    <FolderOpen className="h-4 w-4 mr-2" />
                    {documentRequestBlocked ? "Aguardando aprovação da entrevista" : "Solicitar Documentos"}
                  </Button>
                )}
                {existingRequest && (
                  <p className="text-xs text-muted-foreground text-center">
                    Solicitação enviada — Status: {docTotal > 0 && docApproved >= docTotal ? "concluído" : existingRequest.status === "completed" ? "concluído" : "pendente"}
                  </p>
                )}
              </>
            )}

            {/* === SEÇÃO 4.5: TESTES DO CANDIDATO === */}
            {(application?.status === "desistente" || application?.status === "pausado") ? (
              <section className="space-y-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <ClipboardList className="h-4 w-4 text-muted-foreground" /> Testes do Candidato
                </h3>
                <p className="text-sm text-muted-foreground italic">
                  {application?.status === "pausado" ? "Encerrado por pausa" : "Cancelado por desistência"}
                </p>
              </section>
            ) : (
              <CandidateTestsSection
                assignments={testAssignments || []}
                onAssign={() => setTestDialogOpen(true)}
                application={application}
                postInterviewResponses={postInterviewResponses}
                postInterviewScorePercent={postInterviewScorePercent}
              />
            )}

            <Separator />

            {/* === SEÇÃO 5: RESULTADO DA TRIAGEM (pipeline) === */}
            <TestResultsSection stepResponses={triageResponses} scorePercent={triageScorePercent} profileName={profile?.full_name} />

            <Separator />

            {/* === SEÇÃO 6: ENTREVISTA === */}
            <InterviewSection interviews={interviews} application={application} scorePercent={scorePercent} />

            <Separator />

            {/* === SEÇÃO 7: HISTÓRICO / AUDITORIA === */}
            <ApplicationJourneyTimeline applicationId={application?.id} />
          </div>
        )}
      </SheetContent>

      {/* Document Request Dialog */}
      {application && unitJob && (
        <DocumentRequestDialog
          open={docDialogOpen}
          onOpenChange={setDocDialogOpen}
          application={application}
          unitJob={unitJob}
        />
      )}

      {/* Test Assign Dialog */}
      {application && (
        <TestAssignDialog
          open={testDialogOpen}
          onOpenChange={setTestDialogOpen}
          applicationId={application.id}
          candidateId={application.candidate_id}
        />
      )}

      {/* Encerrar Processo — fluxo compartilhado com a Documentação */}
      <CloseProcessDialog
        applicationId={application?.id}
        fromStatus={application?.status}
        open={closeProcessOpen}
        onOpenChange={setCloseProcessOpen}
        onClosed={() => onOpenChange(false)}
      />
    </Sheet>

  );
}

// ---- Sub-components ----

function ProfileSection({ profile, initials }: { profile: any; initials: string }) {
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <User className="h-4 w-4 text-primary" /> Informações Pessoais
      </h3>
      <div className="flex items-center gap-3">
        <Avatar className="h-14 w-14">
          <AvatarImage src={profile?.avatar_url || undefined} />
          <AvatarFallback className="bg-primary/10 text-primary text-lg">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div>
          <p className="font-semibold text-foreground name-display">
            {profile?.full_name || "Sem nome"}
          </p>
          {profile?.cpf && (
            <p className="text-xs text-muted-foreground">CPF: {profile.cpf}</p>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-1.5 text-sm text-muted-foreground">
        {profile?.email && (
          <span className="flex items-center gap-2">
            <Mail className="h-3.5 w-3.5" /> {profile.email}
          </span>
        )}
        {profile?.phone && (
          <span className="flex items-center gap-2">
            <Phone className="h-3.5 w-3.5" /> {profile.phone}
          </span>
        )}
        {(profile?.city || profile?.state) && (
          <span className="flex items-center gap-2">
            <MapPin className="h-3.5 w-3.5" />{" "}
            {[profile.city, profile.state].filter(Boolean).join(" / ")}
          </span>
        )}
        {profile?.birth_date && (
          <span className="flex items-center gap-2">
            <Calendar className="h-3.5 w-3.5" />{" "}
            {formatDateBR(profile.birth_date)}
          </span>
        )}
        {profile?.gender && <span className="text-xs">Gênero: {profile.gender}</span>}
      </div>
    </section>
  );
}

function TestResultsSection({ stepResponses, scorePercent, profileName }: { stepResponses: any[]; scorePercent: number; profileName?: string }) {
  const handleExport = useCallback(() => {
    if (!stepResponses.length) return;
    const rows = stepResponses.map((sr: any) => ({
      etapa: sr.pipeline_steps?.title || "—",
      tipo: sr.pipeline_steps?.type || "—",
      score: sr.score ?? "—",
      peso: sr.pipeline_steps?.weight ?? 1,
      data: sr.created_at ? format(new Date(sr.created_at), "dd/MM/yyyy HH:mm") : "—",
    }));
    const safeName = (profileName || "candidato").replace(/\s+/g, "_").toLowerCase();
    exportToCSV(rows, `triagem_${safeName}`);
  }, [stepResponses, profileName]);

  const scoreColor = scorePercent >= 70 ? "text-green-600 dark:text-green-400" :
    scorePercent >= 40 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400";
  const progressColor = scorePercent >= 70 ? "[&>div]:bg-green-500" :
    scorePercent >= 40 ? "[&>div]:bg-yellow-500" : "[&>div]:bg-red-500";

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <GraduationCap className="h-4 w-4 text-primary" /> Resultado da Triagem
        </h3>
        {stepResponses.length > 0 && (
          <Button variant="ghost" size="sm" onClick={handleExport} title="Exportar histórico de triagem">
            <Download className="h-4 w-4" />
          </Button>
        )}
      </div>
      {stepResponses.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum teste respondido.</p>
      ) : (
        <div className="rounded-lg border bg-card p-4 space-y-4">
          {/* Score destaque */}
          <div className="flex items-center gap-4">
            <div className={`text-3xl font-bold ${scoreColor}`}>{scorePercent}%</div>
            <div className="flex-1 space-y-1">
              <span className="text-xs text-muted-foreground">Aproveitamento geral</span>
              <Progress value={scorePercent} className={`h-3 ${progressColor}`} />
            </div>
          </div>
          {/* Etapas detalhadas */}
          <div className="space-y-2">
            {stepResponses.map((sr: any) => {
              const s = sr.score ?? 0;
              const stepColor = s >= 70 ? "[&>div]:bg-green-500" : s >= 40 ? "[&>div]:bg-yellow-500" : "[&>div]:bg-red-500";
              return (
                <div key={sr.id} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground truncate max-w-[65%]">{sr.pipeline_steps?.title || "Etapa"}</span>
                    <span className="font-semibold text-foreground">{sr.score != null ? `${sr.score}%` : "—"}</span>
                  </div>
                  {sr.score != null && <Progress value={sr.score} className={`h-1.5 ${stepColor}`} />}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function InterviewSection({ interviews, application, scorePercent }: { interviews: any[]; application: any; scorePercent: number }) {
  const updateInterview = useUpdateInterview();
  const approveInterview = useApproveInterview();
  const rejectInterview = useRejectInterview();
  const recordAttendance = useRecordAttendance();
  const sendNotification = useSendNotification();
  const [approveDialog, setApproveDialog] = useState<{ id: string; modality: string; date: string; time: string } | null>(null);
  const [approveLink, setApproveLink] = useState("");
  const [meetingProvider, setMeetingProvider] = useState<"livekit" | "external">("livekit");
  const [rejectDialog, setRejectDialog] = useState<{ id: string } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [processingId, setProcessingId] = useState<string | null>(null);
  const isValidUrl = (url: string) => /^https?:\/\/\S+\.\S+/i.test(url.trim());
  const qc = useQueryClient();
  const [decisionTarget, setDecisionTarget] = useState<InterviewDecisionTarget | null>(null);

  // Fetch existing interview decisions to know which interviews already have feedback recorded.
  // Inclui entrevistas concluídas E entrevistas confirmadas COM PRESENÇA REGISTRADA (compareceu).
  const hasAttended = (iv: any) =>
    Array.isArray(iv?.attendance_logs) && iv.attendance_logs.some((a: any) => a?.attendance_status === "compareceu");
  const completedIds = (interviews || [])
    .filter((i: any) => i.status === "completed" || (i.status === "confirmed" && hasAttended(i)))
    .map((i: any) => i.id);
  const { data: existingFeedback } = useQuery({
    queryKey: ["interview_feedback_decisions", completedIds.sort().join(",")],
    enabled: completedIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("interview_feedback")
        .select("interview_id, decision")
        .in("interview_id", completedIds);
      return data || [];
    },
  });
  const decidedInterviewIds = new Set(
    (existingFeedback || [])
      .filter((f: any) => ["aprovado", "presencial", "standby", "encerrado"].includes(String(f.decision || "")))
      .map((f: any) => f.interview_id)
  );

  // Fluxo único de decisão de entrevista vive em InterviewDecisionDialog (módulo Agendamento).
  // Aqui apenas abrimos o mesmo dialog passando o target.


  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Video className="h-4 w-4 text-primary" /> Entrevista
      </h3>
      {interviews.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma entrevista agendada.</p>
      ) : (
        <div className="space-y-2">
          {interviews.map((iv: any) => (
            <div key={iv.id} className="rounded-md border p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">
                  {formatDateBR(iv.scheduled_date)} às {iv.scheduled_time?.slice(0, 5)}
                </span>
                <Badge variant="outline">
                  {INTERVIEW_STATUS_LABELS[iv.status] || iv.status}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Modalidade: {iv.modality === "online" ? "Online" : iv.modality === "ai_interview" ? "Entrevista IA 🤖" : "Presencial"}
              </p>
              {iv.meeting_link && /^https?:\/\//i.test(iv.meeting_link) && (
                <a href={iv.meeting_link} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline">
                  Link da reunião
                </a>
              )}
              {/* Confirmar presença — disponível enquanto a entrevista está confirmada */}
              {iv.status === "confirmed" && (
                <div className="mt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-green-500 text-green-700 hover:bg-green-50 dark:hover:bg-green-950/30"
                    disabled={recordAttendance.isPending}
                    onClick={async () => {
                      try {
                        await recordAttendance.mutateAsync({
                          interview_id: iv.id,
                          candidate_id: iv.candidate_id ?? application.candidate_id,
                          unit_id: iv.unit_id ?? application.unit_id,
                          attendance_status: "compareceu",
                          check_in_time: new Date().toISOString(),
                        });
                        toast.success("Comparecimento registrado!");
                        qc.invalidateQueries({ queryKey: ["candidate_interviews"] });
                        qc.invalidateQueries({ queryKey: ["candidate_interviews_batch"] });
                      } catch (e: any) {
                        toast.error(e.message || "Erro ao registrar comparecimento");
                      }
                    }}
                  >
                    <ClipboardCheck className="h-3.5 w-3.5 mr-1" /> Confirmar presença
                  </Button>
                </div>
              )}
              {/* Schedule approval buttons for pending_approval */}
              {iv.status === "pending_approval" && (
                <div className="flex gap-2 mt-2">
                  <Button
                    variant="default"
                    size="sm"
                    className="flex-1"
                    disabled={processingId === iv.id}
                    onClick={() => {
                      setApproveLink("");
                      setApproveDialog({
                        id: iv.id,
                        modality: iv.modality,
                        date: formatDateBR(iv.scheduled_date),
                        time: iv.scheduled_time?.slice(0, 5) || "",
                      });
                    }}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Aprovar
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="flex-1"
                    disabled={processingId === iv.id}
                    onClick={() => { setRejectReason(""); setRejectDialog({ id: iv.id }); }}
                  >
                    <XCircle className="h-3.5 w-3.5 mr-1" /> Não Aprovar
                  </Button>
                </div>
              )}

              {/* Read-only state for reschedule_requested */}
              {iv.status === "reschedule_requested" && (
                <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30 p-3">
                  <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                    ⏳ Aguardando reagendamento do candidato
                  </p>
                </div>
              )}

              {/* AI interview result display */}
              {(() => {
                // Safe parse ai_result with notes fallback
                let parsedResult: any = null;
                if (iv.ai_result) {
                  parsedResult = typeof iv.ai_result === "string" ? (() => { try { return JSON.parse(iv.ai_result); } catch { return null; } })() : iv.ai_result;
                }
                if (!parsedResult && iv.notes && typeof iv.notes === "string") {
                  const scoreMatch = iv.notes.match(/Score:\s*(\d+)/i);
                  const decisionMatch = iv.notes.match(/Decisão:\s*(\w+)/i);
                  if (scoreMatch || decisionMatch) {
                    parsedResult = {
                      finalScore: scoreMatch ? parseInt(scoreMatch[1]) : undefined,
                      decision: decisionMatch ? decisionMatch[1] : undefined,
                    };
                  }
                }
                // Normaliza score quando vier em chaves alternativas (final_score, consolidated_score, overall_score)
                if (parsedResult && parsedResult.finalScore == null) {
                  const alt = parsedResult.final_score ?? parsedResult.consolidated_score ?? parsedResult.overall_score ?? parsedResult.score;
                  if (alt != null && !isNaN(Number(alt))) parsedResult.finalScore = Number(alt);
                }
                if (!parsedResult || iv.status !== "completed") return null;
                return (
                  <div className="mt-2 rounded-md bg-muted/50 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold flex items-center gap-1">
                        <Brain className="h-3.5 w-3.5 text-primary" /> Resultado da Entrevista IA
                      </span>
                      <Badge variant={
                        parsedResult.decision === "APPROVED" ? "default" :
                        parsedResult.decision === "TALENT_POOL" ? "secondary" :
                        parsedResult.decision === "ESCALATED" ? "outline" : "destructive"
                      }>
                        {parsedResult.decision === "APPROVED" ? "Aprovado" :
                         parsedResult.decision === "TALENT_POOL" ? "Banco de Talentos" :
                         parsedResult.decision === "ESCALATED" ? "Encaminhado p/ Humano" : parsedResult.decision || "—"}
                      </Badge>
                    </div>
                    {parsedResult.finalScore != null && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Score:</span>
                        <span className="text-sm font-bold">{parsedResult.finalScore}/100</span>
                      </div>
                    )}
                    {parsedResult.dimensionAverages && (
                      <div className="grid grid-cols-2 gap-1 text-xs">
                        {Object.entries(parsedResult.dimensionAverages as Record<string, number>).map(([dim, score]) => (
                          <div key={dim} className="flex justify-between">
                            <span className="text-muted-foreground capitalize">{dim.replace(/_/g, " ")}</span>
                            <span className="font-medium">{Math.round(score as number)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {parsedResult.strengths?.length > 0 && (
                      <div className="text-xs">
                        <span className="font-medium text-green-600">Pontos fortes:</span>
                        <span className="ml-1">{parsedResult.strengths.join(", ")}</span>
                      </div>
                    )}
                    {parsedResult.weaknesses?.length > 0 && (
                      <div className="text-xs">
                        <span className="font-medium text-orange-600">Pontos a melhorar:</span>
                        <span className="ml-1">{parsedResult.weaknesses.join(", ")}</span>
                      </div>
                    )}
                    {parsedResult.summary && (
                      <p className="text-xs text-muted-foreground italic">{parsedResult.summary}</p>
                    )}
                  </div>
                );
              })()}

              {/* Evaluation notes + decision buttons — entrevista concluída OU confirmada com presença registrada (compareceu) */}
              {(iv.status === "completed" || (iv.status === "confirmed" && hasAttended(iv))) && !["contratado","desistente","desligado"].includes(application?.status as string) && !decidedInterviewIds.has(iv.id) && (() => {
                // Also hide if AI already returned APPROVED — decision is in ai_result, not interview_feedback.
                let aiParsed: any = null;
                if (iv.ai_result) {
                  aiParsed = typeof iv.ai_result === "string" ? (() => { try { return JSON.parse(iv.ai_result); } catch { return null; } })() : iv.ai_result;
                }
                if (aiParsed?.decision === "APPROVED") return false;
                return true;
              })() && (
                <div className="mt-3 space-y-2 border-t pt-3">
                  <div className="flex gap-2">
                    <Button
                      variant="default"
                      size="sm"
                      className="flex-1"
                      onClick={() => setDecisionTarget({ interview: iv, decision: "aprovado" })}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Aprovar Entrevista
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 border-yellow-400 text-yellow-600 hover:bg-yellow-50"
                      onClick={() => setDecisionTarget({ interview: iv, decision: "standby" })}
                    >
                      <XCircle className="h-3.5 w-3.5 mr-1" /> Standby
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Approve Dialog */}
      <Dialog open={!!approveDialog} onOpenChange={(v) => { if (!v) { setApproveDialog(null); setApproveLink(""); setMeetingProvider("livekit"); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary" /> Aprovar agendamento
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
              <p><strong>Data/Hora:</strong> {approveDialog?.date} às {approveDialog?.time}</p>
              <p><strong>Modalidade:</strong> {approveDialog?.modality === "online" ? "Online" : approveDialog?.modality === "ai_interview" ? "Entrevista IA" : "Presencial"}</p>
            </div>
            {approveDialog?.modality === "online" && (
              <div className="space-y-3">
                <label className="text-sm font-medium">Como será a videochamada?</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setMeetingProvider("livekit")}
                    className={`text-left rounded-md border p-3 transition ${
                      meetingProvider === "livekit"
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center gap-2 font-medium text-sm">
                      <Sparkles className="h-4 w-4 text-primary" />
                      Sala interna (LiveKit)
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Recomendado. Entrevista acontece dentro do sistema, com gravação opcional.
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMeetingProvider("external")}
                    className={`text-left rounded-md border p-3 transition ${
                      meetingProvider === "external"
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center gap-2 font-medium text-sm">
                      <LinkIcon className="h-4 w-4" />
                      Link externo
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Use Meet, Zoom, Teams ou outro serviço de sua preferência.
                    </p>
                  </button>
                </div>

                {meetingProvider === "livekit" ? (
                  <Alert>
                    <Video className="h-4 w-4" />
                    <AlertDescription className="text-xs">
                      Um link de acesso à sala interna será gerado automaticamente e enviado ao candidato por push/WhatsApp.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Link da reunião <span className="text-destructive">*</span></label>
                    <div className="relative">
                      <Video className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="https://meet.google.com/... ou https://zoom.us/..."
                        value={approveLink}
                        onChange={(e) => setApproveLink(e.target.value)}
                        className="pl-9"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">O link será enviado ao candidato por push e WhatsApp junto com a confirmação.</p>
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setApproveDialog(null); setApproveLink(""); setMeetingProvider("livekit"); }}>Cancelar</Button>
            <Button
              disabled={
                processingId === approveDialog?.id ||
                (approveDialog?.modality === "online" && meetingProvider === "external" && !isValidUrl(approveLink))
              }
              onClick={async () => {
                if (!approveDialog) return;
                const isOnline = approveDialog.modality === "online";
                if (isOnline && meetingProvider === "external" && !isValidUrl(approveLink)) {
                  toast.error("Informe um link válido (começando com http:// ou https://) antes de aprovar.");
                  return;
                }
                setProcessingId(approveDialog.id);
                try {
                  await approveInterview.mutateAsync({
                    interviewId: approveDialog.id,
                    meetingProvider: isOnline ? meetingProvider : undefined,
                    meetingLink: isOnline && meetingProvider === "external" ? approveLink.trim() : undefined,
                  });
                  qc.invalidateQueries({ queryKey: ["candidate_interviews"] });
                  qc.invalidateQueries({ queryKey: ["candidate_interviews_batch"] });
                  qc.invalidateQueries({ queryKey: ["pending_approvals"] });
                  toast.success("Entrevista aprovada com sucesso!");
                  setApproveDialog(null);
                  setApproveLink("");
                  setMeetingProvider("livekit");
                } catch (e: any) {
                  toast.error(e.message || "Erro ao aprovar");
                } finally {
                  setProcessingId(null);
                }
              }}
            >
              {processingId === approveDialog?.id ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
              Confirmar aprovação
            </Button>

          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={!!rejectDialog} onOpenChange={(v) => { if (!v) { setRejectDialog(null); setRejectReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Não aprovar agendamento</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              O candidato será notificado e poderá escolher um novo horário.
            </p>
            <div>
              <label className="text-sm font-medium">Motivo (opcional)</label>
              <Textarea
                placeholder="Ex: Horário conflita com reunião, preferência por outro dia..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectDialog(null); setRejectReason(""); }}>Cancelar</Button>
            <Button
              variant="destructive"
              disabled={processingId === rejectDialog?.id}
              onClick={async () => {
                if (!rejectDialog) return;
                setProcessingId(rejectDialog.id);
                try {
                  await rejectInterview.mutateAsync({ interviewId: rejectDialog.id, reason: rejectReason || undefined });
                  qc.invalidateQueries({ queryKey: ["candidate_interviews"] });
                  qc.invalidateQueries({ queryKey: ["candidate_interviews_batch"] });
                  qc.invalidateQueries({ queryKey: ["pending_approvals"] });
                  toast.success("Horário não aprovado. O candidato foi notificado.");
                  setRejectDialog(null);
                  setRejectReason("");
                } catch (e: any) {
                  toast.error(e.message || "Erro ao processar");
                } finally {
                  setProcessingId(null);
                }
              }}
            >
              {processingId === rejectDialog?.id ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Fluxo único de decisão de entrevista — mesma fonte do módulo Agendamento */}
      <InterviewDecisionDialog
        target={decisionTarget}
        onOpenChange={(open) => { if (!open) setDecisionTarget(null); }}
        onDone={() => setDecisionTarget(null)}
      />
    </section>
  );
}

function ResumeSection({ candidateId }: { candidateId: string | undefined }) {
  const { data: resumeData } = useQuery({
    queryKey: ["resume_versions_admin", candidateId],
    enabled: !!candidateId,
    queryFn: async () => {
      const { data: versions, error } = await supabase
        .from("resume_versions")
        .select("*")
        .eq("candidate_id", candidateId!)
        .order("version", { ascending: false });
      if (error) throw error;

      const sorted = (versions as any[]) || [];
      const latestVersion = sorted[0] || null;

      // Fallback para currículos legados sem versionamento em resume_versions.
      let profileResumePath: string | null = null;
      if (!latestVersion) {
        const { data: profileData } = await supabase
          .from("candidate_profiles")
          .select("resume_url")
          .eq("candidate_id", candidateId!)
          .maybeSingle();
        profileResumePath = (profileData as any)?.resume_url || null;
      }

      return {
        versions: sorted,
        latest:
          latestVersion ||
          (profileResumePath
            ? {
                file_url: profileResumePath,
                file_name: profileResumePath.split("/").pop() || "curriculo",
                version: 1,
                uploaded_at: null,
                _fromProfile: true,
              }
            : null),
      };
    },
  });

  const resumeVersions = resumeData?.versions || [];
  const latest = resumeData?.latest;

  const handleDownload = async (fileUrl: string, fileName: string) => {
    const storage = await getStorageClient();
    const { data, error } = await storage.storage
      .from("documents")
      .createSignedUrl(fileUrl, 60);
    if (error || !data?.signedUrl) {
      toast.error("Não foi possível abrir o currículo.");
      return;
    }
    const w = window.open(data.signedUrl, "_blank");
    if (!w) window.location.href = data.signedUrl;
  };

  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <FileUp className="h-4 w-4 text-primary" /> Currículo
      </h3>
      {!latest ? (
        <p className="text-sm text-muted-foreground">Nenhum currículo enviado.</p>
      ) : (
        <div className="rounded-md border p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">{latest.file_name}</p>
              <p className="text-xs text-muted-foreground">
                {latest._fromProfile
                  ? "Versão legada"
                  : `Versão ${latest.version} • ${new Date(latest.uploaded_at).toLocaleDateString("pt-BR")}`}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => handleDownload(latest.file_url, latest.file_name)}>
              <Download className="h-3.5 w-3.5 mr-1" /> Baixar
            </Button>
          </div>
          {resumeVersions && resumeVersions.length > 1 && (
            <p className="text-[10px] text-muted-foreground">
              {resumeVersions.length} versões no total
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function CandidateTestsSection({ assignments, onAssign, application, postInterviewResponses = [], postInterviewScorePercent = 0 }: { assignments: any[]; onAssign: () => void; application: any; postInterviewResponses?: any[]; postInterviewScorePercent?: number }) {
  const sendNotification = useSendNotification();
  const qc = useQueryClient();
  const [standbyOpen, setStandbyOpen] = useState(false);
  const [standbyReason, setStandbyReason] = useState("");
  const [standbySubmitting, setStandbySubmitting] = useState(false);

  const STATUS_LABELS: Record<string, string> = {
    pendente: "Pendente", em_andamento: "Em Andamento", enviado: "Enviado",
    corrigido: "Corrigido", aprovado: "Aprovado", reprovado: "Lista de Oportunidade",
  };

  const jobId = application?.unit_jobs?.job_id || application?.unit_jobs?.jobs?.id;
  const { autoApproves } = useJobAutoApprovesTest(jobId);

  // Quando a configuração está ativa e a vaga não tem teste, dispara a
  // auto-aprovação para candidaturas legadas (criadas antes da flag ser ligada).
  const firedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!autoApproves || !application?.id) return;
    const status = application.status;
    if (!["pendente", "em_andamento", "em_avaliacao"].includes(status)) return;
    if (firedRef.current === application.id) return;
    firedRef.current = application.id;
    autoApproveIfNoTest(application.id).then(() => {
      qc.invalidateQueries({ queryKey: ["candidates_by_job"] });
      qc.invalidateQueries({ queryKey: ["application_status"] });
      qc.invalidateQueries({ queryKey: ["applications"] });
    });
  }, [autoApproves, application?.id, application?.status, qc]);

  const activeRestartMode = (application as any)?.currentRestartMode as string | null | undefined;
  const inRestartCycle = application?.status === "em_andamento" && (activeRestartMode === "documentacao" || activeRestartMode === "entrevista");
  const canDecide = !autoApproves && !inRestartCycle && (application?.status === "em_andamento" || application?.status === "pendente" || application?.status === "apto_para_vaga");

  const handleEvaluationDecision = async (decision: "aprovado" | "standby", reason?: string) => {
    try {
      // 1. Update application status (ACATO: never "reprovado", always "standby")
      const dbStatus = decision === "standby" ? "standby" : decision;
      const updatePayload: any = { status: dbStatus };
      if (decision === "standby") {
        updatePayload.standby_reason = (reason && reason.trim()) || null;
      }
      await supabase
        .from("applications")
        .update(updatePayload)
        .eq("id", application.id);

      // 1b. If standby, move to talent pool
      if (decision === "standby") {
        const { moveToStandby } = await import("@/lib/moveToStandby");
        await moveToStandby(application.candidate_id, reason || "Avaliação — standby");
      }

      // 2. If approved, notify candidate. NÃO criar document_request automaticamente —
      // a etapa Documentação só pode existir após o admin enviar a solicitação
      // oficial via DocumentRequestDialog (regra de negócio: zero avanço automático).
      if (decision === "aprovado") {
        const candidateId = application.candidate_id;
        sendNotification.mutate({
          eventType: "candidate_approved",
          recipientId: candidateId,
          payload: {
            _title: "Aprovado na avalia\u00e7\u00e3o! \ud83c\udf89",
            _body: "Parab\u00e9ns! Voc\u00ea foi aprovado(a) na avalia\u00e7\u00e3o.",
          },
        });
      } else {
        sendNotification.mutate({
          eventType: "candidate_rejected",
          recipientId: application.candidate_id,
          payload: {
            _title: "Atualização da candidatura",
            _body: reason && reason.trim()
              ? `Mensagem do recrutador: ${reason.trim()}`
              : "Seu perfil foi direcionado ao banco de talentos. Você será notificado sobre novas oportunidades compatíveis.",
          },
        });
      }

      // 3. Invalidate queries
      qc.invalidateQueries({ queryKey: ["candidates_by_job"] });
      qc.invalidateQueries({ queryKey: ["application_status"] });

      toast.success(decision === "aprovado" ? "Candidato aprovado na avaliação!" : "Candidato movido para standby.");
    } catch (e: any) {
      toast.error(e.message || "Erro ao processar decis\u00e3o");
    }
  };

  const piPct = postInterviewScorePercent;
  const piScoreColor = piPct >= 70 ? "text-green-600 dark:text-green-400"
    : piPct >= 40 ? "text-yellow-600 dark:text-yellow-400"
    : "text-red-600 dark:text-red-400";
  const piProgressColor = piPct >= 70 ? "[&>div]:bg-green-500"
    : piPct >= 40 ? "[&>div]:bg-yellow-500"
    : "[&>div]:bg-red-500";

  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <ClipboardList className="h-4 w-4 text-primary" /> Avaliação do Candidato
      </h3>
      {postInterviewResponses.length > 0 ? (
        <div className="rounded-lg border bg-card p-4 space-y-4">
          <div className="flex items-center gap-4">
            <div className={`text-3xl font-bold ${piScoreColor}`}>{piPct}%</div>
            <div className="flex-1 space-y-1">
              <span className="text-xs text-muted-foreground">Aproveitamento geral</span>
              <Progress value={piPct} className={`h-3 ${piProgressColor}`} />
            </div>
          </div>
          <div className="space-y-2">
            {postInterviewResponses.map((sr: any) => {
              const s = sr.score ?? 0;
              const stepColor = s >= 70 ? "[&>div]:bg-green-500" : s >= 40 ? "[&>div]:bg-yellow-500" : "[&>div]:bg-red-500";
              return (
                <div key={sr.id} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground truncate max-w-[65%]">{sr.pipeline_steps?.title || "Etapa"}</span>
                    <span className="font-semibold text-foreground">{sr.score != null ? `${sr.score}%` : "—"}</span>
                  </div>
                  {sr.score != null && <Progress value={sr.score} className={`h-1.5 ${stepColor}`} />}
                </div>
              );
            })}
          </div>
        </div>
      ) : assignments.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum teste atribuído (avaliação pode ser presencial).</p>
      ) : (
        <div className="space-y-3">
          {assignments.map((a: any) => {
            const testScore = a.score;
            const scoreClr = testScore != null
              ? testScore >= 70 ? "text-green-600 dark:text-green-400" : testScore >= 40 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400"
              : "";
            const barClr = testScore != null
              ? testScore >= 70 ? "[&>div]:bg-green-500" : testScore >= 40 ? "[&>div]:bg-yellow-500" : "[&>div]:bg-red-500"
              : "";
            const questions = a.test_templates?.content?.questions as any[] | undefined;
            const answers = a.response?.answers as Record<string, any> | undefined;

            return (
              <div key={a.id} className="rounded-lg border bg-card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">{a.test_templates?.title || "Teste"}</span>
                  <Badge variant="outline">{STATUS_LABELS[a.status] || a.status}</Badge>
                </div>
                {/* Score destaque */}
                {testScore != null && (
                  <div className="flex items-center gap-3">
                    <span className={`text-2xl font-bold ${scoreClr}`}>{testScore}</span>
                    <div className="flex-1 space-y-0.5">
                      <span className="text-[10px] text-muted-foreground">Nota / 100</span>
                      <Progress value={testScore} className={`h-2 ${barClr}`} />
                    </div>
                  </div>
                )}
                {/* Datas */}
                <div className="flex gap-4 text-[11px] text-muted-foreground">
                  {a.started_at && <span>Início: {format(new Date(a.started_at), "dd/MM/yyyy HH:mm")}</span>}
                  {a.completed_at && <span>Conclusão: {format(new Date(a.completed_at), "dd/MM/yyyy HH:mm")}</span>}
                </div>
                {/* Detalhes das respostas do quiz */}
                {questions && answers && questions.length > 0 && (
                  <div className="space-y-2 pt-1 border-t">
                    <span className="text-[11px] font-medium text-muted-foreground">Respostas detalhadas</span>
                    {questions.map((q: any, idx: number) => {
                      const answerValue = answers[idx];
                      const isEmptyAnswer = answerValue == null || String(answerValue).trim() === "" || String(answerValue).trim() === "—";
                      const hasCorrect = q.correct !== undefined;
                      const hasOptions = Array.isArray(q.options) && q.options.length > 0;
                      const isTextAnswer = typeof answerValue === "string" && answerValue.length > 0;
                      const isNumericAnswer = answerValue != null && !isNaN(Number(answerValue)) && String(answerValue).length <= 3;
                      const isEssay = (!hasCorrect && !hasOptions) || (!isNumericAnswer && isTextAnswer) || isEmptyAnswer;

                      // Find AI grading for this question if available
                      const aiGrading = a.response?.ai_grading?.find((g: any) => g.questionIndex === idx);

                      if (isEssay) {
                        // Essay/descriptive question display
                        const essayScore = aiGrading?.score;
                        const essayColor = essayScore != null
                          ? essayScore >= 70 ? "border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-950/20"
                          : essayScore >= 40 ? "border-yellow-300 bg-yellow-50 dark:border-yellow-700 dark:bg-yellow-950/20"
                          : "border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-950/20"
                          : "border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/20";

                        return (
                          <div key={idx} className={`text-xs space-y-1.5 rounded-md border p-2.5 ${essayColor}`}>
                            <p className="text-foreground font-medium flex items-center gap-1.5">
                              <MessageSquare className="h-3 w-3 text-muted-foreground shrink-0" />
                              {idx + 1}. {q.question || q.text || "Pergunta"}
                            </p>
                            <p className="text-foreground/80 italic pl-4.5">"{String(answerValue)}"</p>
                            {aiGrading && !aiGrading.error ? (
                              <div className="pl-4.5 space-y-1">
                                <div className="flex items-center gap-2">
                                  <Brain className="h-3 w-3 text-primary shrink-0" />
                                  <Badge variant="outline" className={`text-[10px] ${
                                    essayScore >= 70 ? "border-green-400 text-green-700 dark:text-green-400" :
                                    essayScore >= 40 ? "border-yellow-400 text-yellow-700 dark:text-yellow-400" :
                                    "border-red-400 text-red-700 dark:text-red-400"
                                  }`}>
                                    {essayScore}/100
                                  </Badge>
                                </div>
                                <p className="text-[10px] text-muted-foreground">{aiGrading.justification}</p>
                                {aiGrading.strengths?.length > 0 && (
                                  <div className="text-[10px]">
                                    <span className="text-green-600 dark:text-green-400 font-medium">Pontos fortes: </span>
                                    {aiGrading.strengths.join("; ")}
                                  </div>
                                )}
                                {aiGrading.weaknesses?.length > 0 && (
                                  <div className="text-[10px]">
                                    <span className="text-red-600 dark:text-red-400 font-medium">Melhorias: </span>
                                    {aiGrading.weaknesses.join("; ")}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 pl-4.5 text-[10px] text-blue-600 dark:text-blue-400">
                                <Info className="h-3 w-3 shrink-0" />
                                Resposta descritiva — avaliação semântica pendente
                              </div>
                            )}
                          </div>
                        );
                      }

                      // Multiple choice question display (existing logic)
                      const selectedIdx = answerValue != null ? Number(answerValue) : -1;
                      const correctIdx = typeof q.correct === "number" ? q.correct : q.options?.findIndex((o: any) => o?.correct === true) ?? -1;
                      const isCorrect = selectedIdx === correctIdx;
                      const optionLabel = (optIdx: number) => {
                        if (!q.options || !q.options[optIdx]) return "—";
                        const opt = q.options[optIdx];
                        return typeof opt === "string" ? opt : opt.text || opt.label || "—";
                      };

                      return (
                        <div key={idx} className="text-xs space-y-0.5">
                          <p className="text-foreground font-medium">{idx + 1}. {q.question || q.text || "Pergunta"}</p>
                          <div className="flex items-start gap-1.5">
                            {isCorrect ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" />
                            ) : (
                              <XCircle className="h-3.5 w-3.5 text-red-500 mt-0.5 shrink-0" />
                            )}
                            <span className={isCorrect ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                              {optionLabel(selectedIdx)}
                            </span>
                          </div>
                          {!isCorrect && correctIdx >= 0 && (
                            <p className="text-[10px] text-muted-foreground ml-5">Correta: {optionLabel(correctIdx)}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {/* Notas do avaliador */}
                {a.evaluator_notes && (
                  <div className="text-xs text-muted-foreground border-t pt-2">
                    <span className="font-medium">Obs. avaliador:</span> {a.evaluator_notes}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <Button variant="outline" size="sm" className="w-full" onClick={onAssign}>
        <ClipboardList className="h-4 w-4 mr-2" />Atribuir Teste
      </Button>


      {/* Aviso de auto-aprovação (vaga sem teste + flag ligada) */}
      {autoApproves && (
        <div className="mt-2 rounded-lg border border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/30 p-3">
          <p className="text-xs font-medium text-emerald-800 dark:text-emerald-300">
            ✓ Aprovação automática habilitada
          </p>
          <p className="text-[11px] text-emerald-700/80 dark:text-emerald-400/80 mt-0.5">
            Vaga sem teste atribuído — candidato é liberado para a próxima etapa sem aprovação manual.
          </p>
        </div>
      )}

      {/* Approve/Reject evaluation — só com teste atribuído */}
      {canDecide && assignments.length > 0 && (
        <div className="flex gap-2 mt-2">
          <Button
            variant="default"
            size="sm"
            className="flex-1"
            onClick={() => handleEvaluationDecision("aprovado")}
          >
            <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Aprovar
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="flex-1"
            onClick={() => { setStandbyReason(DEFAULT_POST_EVALUATION_STANDBY_REASON); setStandbyOpen(true); }}
          >
            <XCircle className="h-3.5 w-3.5 mr-1" /> Standby
          </Button>
        </div>
      )}

      <Dialog open={standbyOpen} onOpenChange={(v) => { if (!standbySubmitting) setStandbyOpen(v); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mover candidato para Standby</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Escreva uma mensagem para o candidato. Ela será exibida no lugar da barra de status do processo.
            </p>
            <Textarea
              value={standbyReason}
              onChange={(e) => setStandbyReason(e.target.value)}
              placeholder="Ex.: Obrigado pela participação. Seu perfil ficou em standby porque buscamos mais experiência em atendimento. Em breve avaliaremos novas oportunidades."
              className="min-h-[100px]"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStandbyOpen(false)} disabled={standbySubmitting}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={standbySubmitting || !standbyReason.trim()}
              onClick={async () => {
                if (!standbyReason.trim()) {
                  toast.error("Mensagem obrigatória.");
                  return;
                }
                setStandbySubmitting(true);
                try {
                  await handleEvaluationDecision("standby", standbyReason.trim());
                  setStandbyOpen(false);
                } finally {
                  setStandbySubmitting(false);
                }
              }}
            >
              {standbySubmitting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              Confirmar standby
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
