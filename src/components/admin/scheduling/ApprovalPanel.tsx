import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { usePendingApprovals, useApproveInterview, useRejectInterview } from "@/hooks/useScheduling";
import { CheckCircle2, XCircle, Loader2, Clock, User, CalendarDays, MapPin, Video, AlertTriangle, Inbox, Link as LinkIcon, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatModality } from "@/lib/modalityLabel";
import { formatRelativeDateTimeBR } from "@/lib/dateUtils";

interface ApprovalPanelProps {
  unitId?: string;
  unitIds?: string[];
}

export function ApprovalPanel({ unitId, unitIds }: ApprovalPanelProps) {
  const { data: pendingList, isLoading } = usePendingApprovals(unitId, unitIds);
  const approveInterview = useApproveInterview();
  const rejectInterview = useRejectInterview();
  const qc = useQueryClient();

  // Realtime: invalidar lista e detecção de conflito quando qualquer entrevista mudar
  useEffect(() => {
    const channel = supabase
      .channel("approval_panel_interviews")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "interviews" },
        () => {
          qc.invalidateQueries({ queryKey: ["pending_approvals"] });
          qc.invalidateQueries({ queryKey: ["approval_conflict"] });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  const [rejectDialog, setRejectDialog] = useState<{ id: string; candidateName: string } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [approveDialog, setApproveDialog] = useState<{ id: string; candidateName: string; modality: string; date: string; time: string; unitId: string } | null>(null);
  const [approveLink, setApproveLink] = useState("");
  const [meetingProvider, setMeetingProvider] = useState<"livekit" | "external">("livekit");
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [confirmStep, setConfirmStep] = useState<"initial" | "double-check">("initial");

  const resetApproveDialog = () => {
    setApproveDialog(null);
    setApproveLink("");
    setMeetingProvider("livekit");
    setConfirmStep("initial");
  };

  // Detecta conflito: outra entrevista já aprovada/agendada no mesmo horário+unidade
  const { data: conflictingInterviews } = useQuery({
    queryKey: ["approval_conflict", approveDialog?.id, approveDialog?.unitId, approveDialog?.date, approveDialog?.time],
    enabled: !!approveDialog?.id && !!approveDialog?.unitId && !!approveDialog?.date && !!approveDialog?.time,
    staleTime: 0,
    queryFn: async () => {
      const time = approveDialog!.time.length === 5 ? `${approveDialog!.time}:00` : approveDialog!.time;
      const { data, error } = await supabase
        .from("interviews")
        .select("id, status, profiles:candidate_id(full_name)")
        .eq("unit_id", approveDialog!.unitId)
        .eq("scheduled_date", approveDialog!.date)
        .eq("scheduled_time", time)
        .in("status", ["pending_approval", "scheduled", "confirmed"])
        .neq("id", approveDialog!.id);
      if (error) throw error;
      return (data || []) as any[];
    },
  });
  const hasConflict = (conflictingInterviews?.length || 0) > 0;
  const conflictHasApproved = (conflictingInterviews || []).some(
    (i: any) => i.status === "scheduled" || i.status === "confirmed"
  );

  const isValidUrl = (url: string) => /^https?:\/\/\S+\.\S+/i.test(url.trim());

  const handleApprove = async () => {
    if (!approveDialog) return;
    const isOnline = approveDialog.modality === "online";
    // Validação apenas quando o provedor exige link externo
    if (isOnline && meetingProvider === "external" && !isValidUrl(approveLink)) {
      toast.error("Informe um link válido (começando com http:// ou https://) antes de aprovar.");
      return;
    }
    // Dupla confirmação se houver conflito de horário
    if (hasConflict && confirmStep === "initial") {
      setConfirmStep("double-check");
      return;
    }
    setProcessingId(approveDialog.id);
    try {
      await approveInterview.mutateAsync({
        interviewId: approveDialog.id,
        meetingProvider: isOnline ? meetingProvider : undefined,
        meetingLink: isOnline && meetingProvider === "external" ? approveLink.trim() : undefined,
      });
      toast.success("Entrevista aprovada com sucesso!");
      resetApproveDialog();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async () => {
    if (!rejectDialog) return;
    setProcessingId(rejectDialog.id);
    try {
      const result = await rejectInterview.mutateAsync({
        interviewId: rejectDialog.id,
        reason: rejectReason || undefined,
      });
      if (result.canReschedule) {
        toast.success("Horário não aprovado. O candidato foi notificado para escolher um novo horário.");
      } else {
        toast.success("Horário não aprovado.");
      }
      setRejectDialog(null);
      setRejectReason("");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setProcessingId(null);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  if (!pendingList?.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Aprovações Pendentes
          </CardTitle>
          <CardDescription>Entrevistas aguardando aprovação do administrador</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12 text-muted-foreground">
            <Inbox className="h-12 w-12 mx-auto mb-4 opacity-30" />
            <p className="text-sm">Nenhuma aprovação pendente no momento.</p>
            <p className="text-xs mt-1">Quando um candidato agendar uma entrevista, ela aparecerá aqui para aprovação.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Aprovações Pendentes
            <Badge variant="destructive" className="ml-2">{pendingList.length}</Badge>
          </CardTitle>
          <CardDescription>Entrevistas aguardando aprovação do administrador</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert className="mb-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {pendingList.length === 1
                ? "Há 1 entrevista aguardando sua aprovação."
                : `Há ${pendingList.length} entrevistas aguardando sua aprovação.`}
            </AlertDescription>
          </Alert>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Candidato</TableHead>
                  <TableHead>Cargo</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Unidade</TableHead>
                  <TableHead>Data/Hora</TableHead>
                  <TableHead>Modalidade</TableHead>
                  <TableHead>Solicitado há</TableHead>
                  <TableHead>Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...pendingList]
                  .sort((a: any, b: any) =>
                    (a.profiles?.full_name || "").localeCompare(b.profiles?.full_name || "", "pt-BR", { sensitivity: "base" })
                  )
                  .map((interview: any) => (
                  <TableRow key={interview.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="font-medium">{interview.profiles?.full_name || "—"}</p>
                          <p className="text-xs text-muted-foreground">{interview.profiles?.email || ""}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{interview.applications?.unit_jobs?.jobs?.title || "—"}</TableCell>
                    <TableCell>
                      {(() => {
                        const s = interview.applications?.total_score;
                        if (s === null || s === undefined) {
                          return <Badge variant="outline">—</Badge>;
                        }
                        const score = Math.round(Number(s));
                        const cls = score >= 80
                          ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100"
                          : score >= 60
                          ? "bg-amber-100 text-amber-700 hover:bg-amber-100"
                          : "bg-red-100 text-red-700 hover:bg-red-100";
                        return <Badge className={cls}>{score}</Badge>;
                      })()}
                    </TableCell>
                    <TableCell>{interview.units?.name || "—"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                        <span>{formatRelativeDateTimeBR(interview.scheduled_date, interview.scheduled_time)}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="flex items-center gap-1 w-fit">
                        <MapPin className="h-3 w-3" />
                        {formatModality(interview.modality)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(interview.created_at), { addSuffix: true, locale: ptBR })}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => {
                            setApproveLink("");
                            setMeetingProvider("livekit");
                            setConfirmStep("initial");
                            setApproveDialog({
                              id: interview.id,
                              candidateName: interview.profiles?.full_name || "Candidato",
                              modality: interview.modality,
                              date: interview.scheduled_date,
                              time: interview.scheduled_time?.slice(0, 5) || "",
                              unitId: interview.unit_id,
                            });
                          }}
                          disabled={processingId === interview.id}
                          className="gap-1"
                        >
                          {processingId === interview.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          )}
                          Aprovar
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => setRejectDialog({ id: interview.id, candidateName: interview.profiles?.full_name || "Candidato" })}
                          disabled={processingId === interview.id}
                          className="gap-1"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          Não Aprovar
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Reject Dialog */}
      <Dialog open={!!rejectDialog} onOpenChange={(v) => { if (!v) { setRejectDialog(null); setRejectReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Não aprovar agendamento</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Não aprovar o horário de <strong>{rejectDialog?.candidateName}</strong>? O candidato será notificado e poderá escolher um novo horário.
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
            <Button variant="outline" onClick={() => { setRejectDialog(null); setRejectReason(""); }}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={processingId === rejectDialog?.id}
            >
              {processingId === rejectDialog?.id ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : null}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Approve Dialog */}
      <Dialog open={!!approveDialog} onOpenChange={(v) => { if (!v) resetApproveDialog(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              Aprovar agendamento
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
              <p><strong>Candidato:</strong> {approveDialog?.candidateName}</p>
              <p><strong>Data/Hora:</strong> {approveDialog?.date} às {approveDialog?.time}</p>
              <p className="flex items-center gap-1">
                <strong>Modalidade:</strong>{" "}
                {approveDialog?.modality === "online" ? (
                  <span className="inline-flex items-center gap-1"><Video className="h-3.5 w-3.5" /> Online</span>
                ) : (
                  <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> Presencial</span>
                )}
              </p>
            </div>

            {hasConflict && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  {conflictHasApproved
                    ? `Já existe ${conflictingInterviews!.length === 1 ? "uma entrevista aprovada" : `${conflictingInterviews!.length} entrevistas aprovadas`} neste mesmo horário`
                    : `Já existe ${conflictingInterviews!.length === 1 ? "outra solicitação aguardando aprovação" : `${conflictingInterviews!.length} outras solicitações aguardando aprovação`} neste mesmo horário`}
                  {conflictingInterviews!.length === 1 && (conflictingInterviews![0] as any)?.profiles?.full_name
                    ? ` (candidato: ${(conflictingInterviews![0] as any).profiles.full_name})`
                    : ""}
                  . Deseja realmente continuar com a confirmação?
                </AlertDescription>
              </Alert>
            )}

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
                      Um link de acesso à sala interna será gerado automaticamente e enviado ao
                      candidato por push/WhatsApp.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Link da reunião <span className="text-destructive">*</span>
                    </label>
                    <div className="relative">
                      <Video className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="https://meet.google.com/... ou https://zoom.us/..."
                        value={approveLink}
                        onChange={(e) => setApproveLink(e.target.value)}
                        className="pl-9"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      O link será enviado ao candidato por push e WhatsApp junto com a confirmação.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetApproveDialog}>
              Cancelar
            </Button>
            <Button
              onClick={handleApprove}
              variant={hasConflict && confirmStep === "double-check" ? "destructive" : "default"}
              disabled={
                processingId === approveDialog?.id ||
                (approveDialog?.modality === "online" && meetingProvider === "external" && !isValidUrl(approveLink))
              }
            >
              {processingId === approveDialog?.id ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-1" />
              )}
              {hasConflict
                ? confirmStep === "double-check"
                  ? "Sim, aprovar mesmo assim"
                  : "Continuar com aprovação"
                : "Confirmar aprovação"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
