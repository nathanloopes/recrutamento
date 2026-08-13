import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  formatChatMessageLinks,
  useParticipants,
  ParticipantTile,
  ControlBar,
  LayoutContextProvider,
  Chat,
  useCreateLayoutContext,
  useTracks,
  useMaybeTrackRefContext,
} from "@livekit/components-react";
import { AspectAwareGrid } from "@/components/livekit/AspectAwareGrid";
import { CandidateConference } from "@/components/livekit/CandidateConference";
import { Track, type RemoteParticipant, type LocalParticipant } from "livekit-client";
import "@livekit/components-styles";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  Loader2, AlertTriangle, ArrowLeft, Video, Send,
  Mic, MicOff, VideoOff, UserX, Shield, ClipboardCheck, CheckCircle2, XCircle,
} from "lucide-react";
import { useLiveKitToken } from "@/hooks/useLiveKitToken";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOpenThreadForApplication, useSendMessage } from "@/hooks/useConversations";
import { useRecordAttendance } from "@/hooks/useAttendanceLogs";
import { InterviewDecisionDialog, type InterviewDecisionTarget } from "@/components/admin/scheduling/InterviewDecisionDialog";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";
import { BackgroundBlurToggle } from "@/components/livekit/BackgroundBlurToggle";
import { isInterviewEntryExpired, INTERVIEW_ENTRY_GRACE_MINUTES } from "@/lib/interviewMeetingLink";
import { InterviewWaitingScreen } from "@/components/candidate/InterviewWaitingScreen";
import { isNativeApp } from "@/lib/isNativeApp";

/**
 * Solicita permissão de câmera e microfone preservando o user-gesture.
 * DEVE ser chamado diretamente dentro de um onClick (sem await prévio).
 * Em sucesso, libera as tracks imediatamente para o LiveKit reabrir depois.
 */
type PreflightFail = {
  ok: false;
  message: string;
  showOpenInBrowser?: boolean;
};

function diagnoseMediaUnavailable(): PreflightFail {
  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
  const isAndroid = /Android/i.test(ua);
  const isStandalone =
    (navigator as any).standalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches === true;
  const isCapacitor = isNativeApp();
  const insecure = typeof window.isSecureContext === "boolean" && !window.isSecureContext;
  const inIframe = (() => {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  })();

  // Telemetria útil para diagnóstico futuro
  // eslint-disable-next-line no-console
  console.warn("[preflightMedia] mediaDevices unavailable", {
    isSecureContext: window.isSecureContext,
    standalone: isStandalone,
    iOS: isIOS,
    inIframe,
    hasMediaDevices: !!navigator.mediaDevices,
    hasGUM: !!navigator.mediaDevices?.getUserMedia,
    ua,
  });

  if (isCapacitor) {
    return {
      ok: false,
      message: isIOS
        ? "O app precisa ser recompilado com permissão de câmera e microfone. Avise o suporte para atualizar o app (Info.plist com NSCameraUsageDescription/NSMicrophoneUsageDescription)."
        : "O app precisa ser recompilado com permissão de câmera e microfone. Avise o suporte para atualizar o app (AndroidManifest com CAMERA e RECORD_AUDIO).",
    };
  }
  if (insecure) {
    return {
      ok: false,
      message:
        "Esta página precisa estar em HTTPS para acessar câmera e microfone. Abra novamente pelo endereço seguro (https://).",
    };
  }
  if (inIframe) {
    return {
      ok: false,
      message:
        "A entrevista está sendo aberta dentro de outra página. Toque em 'Abrir no navegador' para continuar.",
      showOpenInBrowser: true,
    };
  }
  if (isIOS && isStandalone) {
    return {
      ok: false,
      message:
        "No iPhone, o acesso à câmera/microfone pode estar bloqueado neste ambiente. Toque em 'Abrir no navegador' para participar.",
      showOpenInBrowser: true,
    };
  }
  return {
    ok: false,
    message:
      "Seu navegador não suporta acesso a câmera/microfone. Tente abrir esta entrevista no Safari (iPhone) ou Chrome (Android).",
    showOpenInBrowser: true,
  };
}

async function preflightMedia(): Promise<{ ok: true } | PreflightFail> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return diagnoseMediaUnavailable();
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: { facingMode: "user" },
    });
    stream.getTracks().forEach((t) => t.stop());
    return { ok: true };
  } catch (err: any) {
    const name = err?.name || "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      return {
        ok: false,
        message:
          "Permissão negada. No iPhone, abra Ajustes → Safari → Câmera/Microfone e libere o acesso. No Android, toque no cadeado da barra do navegador.",
      };
    }
    if (name === "NotFoundError" || name === "OverconstrainedError") {
      return { ok: false, message: "Câmera ou microfone não encontrados neste dispositivo." };
    }
    if (name === "NotReadableError") {
      return { ok: false, message: "Câmera/microfone em uso por outro app. Feche e tente novamente." };
    }
    return { ok: false, message: err?.message || "Falha ao acessar câmera e microfone." };
  }
}

async function callModerate(params: {
  interviewId: string;
  action: "mute_track" | "unmute_track" | "remove_participant";
  targetIdentity: string;
  trackSid?: string;
  source?: "microphone" | "camera";
}) {
  const { data, error } = await supabase.functions.invoke("livekit-moderate", {
    body: params,
  });
  if (error) {
    // Tenta extrair detalhe da edge function
    let detail: string | null = null;
    const ctx: any = (error as any).context;
    try {
      if (ctx && typeof ctx.clone === "function") {
        const body = await ctx.clone().json();
        if (body?.statusCode) {
          detail = `${body.error || "Erro LiveKit"} (status ${body.statusCode}): ${body.livekit_error || ""}`;
        } else if (body?.error) {
          detail = body.error;
        }
      }
    } catch {
      /* ignore */
    }
    throw new Error(detail || (error as any).message || "Falha na ação de moderação.");
  }
  return data;
}


function AlternativeLinkSender({ applicationId }: { applicationId?: string | null }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState(
    "Olá! Tivemos uma instabilidade na sala da entrevista. Por favor, use este link alternativo para entrar: ",
  );
  const [threadId, setThreadId] = useState<string | null>(null);
  const openThread = useOpenThreadForApplication();
  const send = useSendMessage(threadId || undefined);
  const [sending, setSending] = useState(false);

  const handleOpen = async () => {
    if (!applicationId) {
      toast.error("Candidatura não vinculada a esta entrevista.");
      return;
    }
    setOpen(true);
    if (!threadId) {
      try {
        const id = await openThread.mutateAsync(applicationId);
        setThreadId(id);
      } catch (e: any) {
        toast.error(e?.message || "Não foi possível abrir a conversa.");
        setOpen(false);
      }
    }
  };

  const handleSend = async () => {
    const text = body.trim();
    if (text.length < 5) {
      toast.error("Escreva uma mensagem com o link alternativo.");
      return;
    }
    if (!threadId) {
      toast.error("Conversa ainda não está pronta. Tente novamente em instantes.");
      return;
    }
    setSending(true);
    try {
      await send.mutateAsync(text);
      toast.success("Mensagem enviada ao candidato.");
      setOpen(false);
    } catch (e: any) {
      toast.error(e?.message || "Falha ao enviar mensagem.");
    } finally {
      setSending(false);
    }
  };

  if (!open) {
    return (
      <Button variant="secondary" onClick={handleOpen} className="w-full">
        <Send className="mr-2 h-4 w-4" />
        Enviar link alternativo ao candidato
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-border p-3 bg-muted/30">
      <p className="text-xs text-muted-foreground">
        Esta mensagem será enviada ao candidato pelo módulo de Mensagens, vinculada a esta candidatura.
      </p>
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        placeholder="Cole aqui o link alternativo da reunião e oriente o candidato."
        disabled={sending}
      />
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setOpen(false)} disabled={sending} className="flex-1">
          Cancelar
        </Button>
        <Button onClick={handleSend} disabled={sending || !threadId} className="flex-1">
          {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
          Enviar mensagem
        </Button>
      </div>
    </div>
  );
}

export default function InterviewLiveKitRoom() {
  const { interviewId } = useParams<{ interviewId: string }>();
  const navigate = useNavigate();
  const { user, hasRole } = useAuth();
  const [joined, setJoined] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [roomPresence, setRoomPresence] = useState<Record<string, { isRecruiter: boolean; lastSeen: number }>>({});
  const [postMeeting, setPostMeeting] = useState(false);
  const [attendanceDone, setAttendanceDone] = useState(false);
  const [decisionTarget, setDecisionTarget] = useState<InterviewDecisionTarget | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [mediaErrorOpenInBrowser, setMediaErrorOpenInBrowser] = useState(false);
  const [requestingMedia, setRequestingMedia] = useState(false);
  const recordAttendance = useRecordAttendance();

  const handleEnterRoom = async (afterPermission: () => void | Promise<void>) => {
    setMediaError(null);
    setMediaErrorOpenInBrowser(false);
    setRequestingMedia(true);
    const result = await preflightMedia();
    setRequestingMedia(false);
    if (result.ok === false) {
      setMediaError(result.message);
      setMediaErrorOpenInBrowser(!!result.showOpenInBrowser);
      return;
    }
    await afterPermission();
  };


  const isAdmin =
    hasRole("admin") ||
    hasRole("rh_franqueadora") ||
    hasRole("franqueado") ||
    hasRole("gestor_recrutamento") ||
    hasRole("auditor_admin");
  const homePath = isAdmin ? "/admin" : "/inicio";
  const goHome = () => navigate(homePath, { replace: true });

  const { data: interview, isLoading: loadingInterview, error: interviewError, refetch: refetchInterview } = useQuery({
    queryKey: ["interview_livekit_meta", interviewId],
    enabled: !!interviewId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("interviews")
        .select("id, application_id, scheduled_date, scheduled_time, modality, status, meeting_provider, candidate_id, unit_id, room_started_at, profiles:candidate_id(full_name), units(name), applications:application_id(id, unit_jobs(jobs(id, title)))")
        .eq("id", interviewId!)
        .single();
      if (error) throw error;
      return data as any;
    },
  });



  const roomStarted = !!interview?.room_started_at;
  const isCandidate = !!user && !!interview && user.id === interview.candidate_id && !isAdmin;
  const recruiterInRoom = Object.values(roomPresence).some(
    (presence) => presence.isRecruiter && Date.now() - presence.lastSeen < 15000,
  );
  // Candidato pode entrar assim que o recrutador iniciar a sala — a presença
  // do recrutador é apenas informativa (mostrada como hint dentro da sala).
  // Janela de 25min após o horário marcado: candidato não pode mais entrar.
  const entryExpired = isCandidate && isInterviewEntryExpired(interview);
  const canCandidateEnter = roomStarted && !entryExpired;

  const {
    data: tokenData,
    isLoading: loadingToken,
    error: tokenError,
    refetch: refetchToken,
  } = useLiveKitToken(joined && roomStarted ? interviewId : undefined);

  // Anfitrião = primeiro recrutador que iniciou a sala. Apenas ele pode
  // encerrar a sala e moderar (mutar/remover) os outros participantes.
  const isHost = !!tokenData?.isHost;

  const roomNotStarted = !canCandidateEnter || (tokenError as any)?.message === "room_not_started";

  const handleStartRoom = async () => {
    if (!interviewId) return;
    setStarting(true);
    setStartError(null);
    try {
      const { error } = await supabase.functions.invoke("livekit-start-room", {
        body: { interviewId },
      });
      if (error) throw error;
      await refetchInterview();
      setJoined(true);
    } catch (e: any) {
      setStartError(e?.message || "Falha ao iniciar a sala.");
    } finally {
      setStarting(false);
    }
  };

  // Realtime + polling: candidato observa início/fim da sala e presença do recrutador
  useEffect(() => {
    if (!isCandidate || !interviewId) return;

    const channel = supabase
      .channel(`interview-room-${interviewId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "interviews", filter: `id=eq.${interviewId}` },
        (payload: any) => {
          refetchInterview();
          // Se a sala foi encerrada pelo recrutador, devolve candidato à pré-sala
          if (payload?.new && payload?.new?.room_started_at === null) {
            setJoined(false);
          } else if (payload?.new?.room_started_at && joined) {
            refetchToken();
          }
        },
      )
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<any>();
        const nextPresence: Record<string, { isRecruiter: boolean; lastSeen: number }> = {};
        Object.entries(state).forEach(([key, entries]) => {
          const presenceEntries = entries as any[];
          const latest = presenceEntries[presenceEntries.length - 1];
          if (latest) {
            nextPresence[key] = {
              isRecruiter: !!latest.isRecruiter,
              lastSeen: Number(latest.lastSeen || Date.now()),
            };
          }
        });
        setRoomPresence(nextPresence);
      })
      .subscribe();

    const poll = setInterval(() => {
      refetchInterview();
      if (interview?.room_started_at && joined) refetchToken();
    }, 10000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, [joined, isCandidate, interviewId, interview?.room_started_at, refetchToken, refetchInterview]);

  useEffect(() => {
    if (!interviewId || !user || !joined || !isAdmin) return;

    const channel = supabase.channel(`interview-room-${interviewId}`, {
      config: { presence: { key: user.id } },
    });

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ isRecruiter: isAdmin, lastSeen: Date.now() });
      }
    });

    const heartbeat = setInterval(() => {
      channel.track({ isRecruiter: isAdmin, lastSeen: Date.now() });
    }, 5000);

    return () => {
      clearInterval(heartbeat);
      channel.untrack();
      supabase.removeChannel(channel);
    };
  }, [interviewId, isAdmin, joined, user]);

  // (Removido) gate que derrubava o candidato quando a presença do recrutador
  // sumia: causava queda da sala diante de qualquer instabilidade. A presença
  // continua sendo trackeada e exibida apenas como informação na sala.


  // Encerramento da sala: somente o anfitrião (primeiro recrutador a iniciar)
  // pode zerar room_started_at. Demais participantes apenas saem da sessão.
  const handleHostDisconnected = async () => {
    if (isAdmin && isHost && interviewId) {
      try {
        await supabase.functions.invoke("livekit-end-room", { body: { interviewId } });
      } catch (e) {
        console.error("Falha ao encerrar sala:", e);
      }
      // Em vez de ir para home, abre card pós-reunião
      setJoined(false);
      setPostMeeting(true);
      return;
    }
    if (isAdmin) {
      // Recrutador convidado (não-anfitrião): apenas sai, sem derrubar a sala.
      setJoined(false);
      setPostMeeting(true);
      return;
    }
    goHome();
  };



  // Acesso: candidato titular OU admin
  const canAccess =
    !!user && !!interview && (user.id === interview.candidate_id || isAdmin);

  useEffect(() => {
    if (!loadingInterview && interview && !canAccess) {
      // sem permissão — voltar para a home
      goHome();
    }
  }, [loadingInterview, interview, canAccess]);

  if (loadingInterview) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (interviewError || !interview) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center p-3 sm:p-4 app-safe-area">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Entrevista não encontrada
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Não foi possível localizar essa entrevista ou você não tem permissão para acessá-la.
            </p>
            <Button onClick={goHome} variant="outline" className="w-full">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Voltar
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Card pós-reunião (apenas anfitrião)
  if (postMeeting && isAdmin) {
    const candidateName = interview.profiles?.full_name || "Candidato";
    return (
      <div className="min-h-[100dvh] flex items-center justify-center p-3 sm:p-4 bg-gradient-to-br from-background to-muted/30 app-safe-area pwa-bottom-safe-area overflow-y-auto">
        <Card className="max-w-lg w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-primary" />
              Reunião encerrada
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Candidato: <span className="font-medium text-foreground">{candidateName}</span>
            </p>

            {!attendanceDone ? (
              <>
                <Alert>
                  <AlertDescription className="text-xs">
                    Registre o comparecimento antes de decidir o próximo passo.
                  </AlertDescription>
                </Alert>
                <div className="flex flex-col gap-2">
                  <Button
                    disabled={recordAttendance.isPending}
                    onClick={async () => {
                      try {
                        await recordAttendance.mutateAsync({
                          interview_id: interview.id,
                          candidate_id: interview.candidate_id,
                          unit_id: interview.unit_id,
                          attendance_status: "compareceu",
                          check_in_time: new Date().toISOString(),
                        });
                        toast.success("Comparecimento registrado!");
                        setAttendanceDone(true);
                      } catch (e: any) {
                        toast.error(e?.message || "Falha ao registrar comparecimento.");
                      }
                    }}
                  >
                    <ClipboardCheck className="mr-2 h-4 w-4" /> Registrar comparecimento
                  </Button>
                  <Button
                    variant="outline"
                    disabled={recordAttendance.isPending}
                    onClick={async () => {
                      try {
                        await recordAttendance.mutateAsync({
                          interview_id: interview.id,
                          candidate_id: interview.candidate_id,
                          unit_id: interview.unit_id,
                          attendance_status: "no_show",
                        });
                        toast.success("Não comparecimento registrado.");
                        goHome();
                      } catch (e: any) {
                        toast.error(e?.message || "Falha ao registrar.");
                      }
                    }}
                  >
                    <AlertTriangle className="mr-2 h-4 w-4 text-amber-500" /> Não compareceu
                  </Button>
                  <Button variant="ghost" onClick={goHome}>
                    <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
                  </Button>
                </div>
              </>
            ) : (
              <>
                <Alert>
                  <AlertDescription className="text-xs">
                    Comparecimento registrado. Defina agora o desfecho da entrevista.
                  </AlertDescription>
                </Alert>
                <div className="flex flex-col gap-2">
                  <Button
                    onClick={() => setDecisionTarget({ interview, decision: "aprovado" })}
                  >
                    <CheckCircle2 className="mr-2 h-4 w-4" /> Aprovar entrevista
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setDecisionTarget({ interview, decision: "standby" })}
                  >
                    <XCircle className="mr-2 h-4 w-4 text-yellow-600" /> Standby
                  </Button>
                  <Button variant="ghost" onClick={goHome}>
                    <ArrowLeft className="mr-2 h-4 w-4" /> Decidir depois
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <InterviewDecisionDialog
          target={decisionTarget}
          onOpenChange={(open) => {
            if (!open) setDecisionTarget(null);
          }}
          onDone={() => {
            setDecisionTarget(null);
            goHome();
          }}
        />
      </div>
    );
  }

  // Pré-sala: confirmação de entrada
  if (!joined) {

    const candidateName = interview.profiles?.full_name || "Candidato";
    const unitName = interview.units?.name || "";
    const dateLabel = interview.scheduled_date
      ? new Date(`${interview.scheduled_date}T${interview.scheduled_time || "00:00"}`).toLocaleString("pt-BR", {
          dateStyle: "long",
          timeStyle: "short",
        })
      : "";

    return (
      <div className="min-h-[100dvh] flex items-center justify-center p-3 sm:p-4 bg-gradient-to-br from-background to-muted/30 app-safe-area pwa-bottom-safe-area overflow-y-auto">
        <Card className="max-w-lg w-full my-auto">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <Video className="h-5 w-5 text-primary" />
              Entrevista Online
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2 text-sm">
              <div>
                <span className="text-muted-foreground">Candidato:</span>{" "}
                <span className="font-medium">{candidateName}</span>
              </div>
              {unitName && (
                <div>
                  <span className="text-muted-foreground">Unidade:</span>{" "}
                  <span className="font-medium">{unitName}</span>
                </div>
              )}
              {dateLabel && (
                <div>
                  <span className="text-muted-foreground">Data/Hora:</span>{" "}
                  <span className="font-medium">{dateLabel}</span>
                </div>
              )}
            </div>

            {entryExpired && (
              <Alert variant="destructive">
                <AlertDescription className="text-xs">
                  A janela de entrada desta entrevista expirou ({INTERVIEW_ENTRY_GRACE_MINUTES} min após o horário marcado).
                  Entre em contato com o recrutador para reagendar.
                </AlertDescription>
              </Alert>
            )}

            <Alert>
              <AlertDescription className="text-xs">
                Ao entrar, seu navegador pedirá permissão para usar a câmera e o microfone.
                Toque em <strong>Permitir</strong>. Procure um local silencioso e com boa iluminação.
              </AlertDescription>
            </Alert>

            {mediaError && (
              <Alert variant="destructive">
                <AlertDescription className="text-xs space-y-2">
                  <div>{mediaError}</div>
                  {mediaErrorOpenInBrowser && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={() => {
                        const url = window.location.href;
                        // target=_blank tenta abrir a entrevista fora do contexto atual quando necessário
                        const w = window.open(url, "_blank", "noopener,noreferrer");
                        if (!w) window.location.href = url;
                      }}
                    >
                      Abrir no navegador
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {startError && (
              <Alert variant="destructive">
                <AlertDescription className="text-xs">{startError}</AlertDescription>
              </Alert>
            )}

            {isAdmin && startError && (
              <AlternativeLinkSender applicationId={interview.application_id} />
            )}

            <div className="flex flex-col sm:flex-row gap-2">
              <Button variant="outline" onClick={goHome} className="flex-1 min-h-11">
                <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
              </Button>
              {isAdmin ? (
                roomStarted ? (
                  <Button
                    onClick={() => handleEnterRoom(() => setJoined(true))}
                    disabled={requestingMedia}
                    className="flex-1 min-h-11"
                  >
                    {requestingMedia ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Video className="mr-2 h-4 w-4" />
                    )}
                    Entrar na sala
                  </Button>
                ) : (
                  <Button
                    onClick={() => handleEnterRoom(handleStartRoom)}
                    disabled={starting || requestingMedia}
                    className="flex-1 min-h-11"
                  >
                    {starting || requestingMedia ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Video className="mr-2 h-4 w-4" />
                    )}
                    Iniciar sala
                  </Button>
                )
              ) : canCandidateEnter ? (
                <Button
                  onClick={() => handleEnterRoom(() => setJoined(true))}
                  disabled={requestingMedia}
                  className="flex-1 min-h-11"
                >
                  {requestingMedia ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Video className="mr-2 h-4 w-4" />
                  )}
                  Entrar na sala
                </Button>
              ) : entryExpired ? (
                <Button disabled className="flex-1 min-h-11" variant="secondary">
                  Janela de entrada encerrada ({INTERVIEW_ENTRY_GRACE_MINUTES} min)
                </Button>
              ) : (
                <Button disabled className="flex-1 min-h-11">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Aguardando recrutador
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Candidato aguardando o recrutador iniciar a sala
  if (isCandidate && roomNotStarted) {
    if (interview?.unit_id) {
      return (
        <InterviewWaitingScreen
          interviewId={interviewId!}
          unitId={interview.unit_id}
          scheduledDate={interview.scheduled_date}
          scheduledTime={interview.scheduled_time}
        />
      );
    }
    return (
      <div className="min-h-[100dvh] flex items-center justify-center p-3 sm:p-4 bg-gradient-to-br from-background to-muted/30 app-safe-area pwa-bottom-safe-area overflow-y-auto">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              Aguardando o recrutador
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              A sala ainda não foi iniciada. Assim que o recrutador entrar, você será
              conectado automaticamente — pode deixar esta tela aberta.
            </p>
            <Button variant="outline" onClick={goHome} className="w-full">
              <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }


  // Conectando
  if (loadingToken) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-3 app-safe-area">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Conectando à sala...</p>
      </div>
    );
  }

  if (tokenError || !tokenData) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center p-3 sm:p-4 app-safe-area">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Falha na conexão
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {(tokenError as any)?.message || "Não foi possível obter o acesso à sala."}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={goHome} className="flex-1">
                Voltar
              </Button>
              <Button onClick={() => refetchToken()} className="flex-1">
                Tentar novamente
              </Button>
            </div>
            {isAdmin && (
              <AlternativeLinkSender applicationId={interview.application_id} />
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div
      className="w-full bg-black overflow-hidden relative"
      style={{
        height: "100dvh",
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
        WebkitTransform: "translateZ(0)",
      }}
    >
      <LiveKitRoom
        token={tokenData.token}
        serverUrl={tokenData.url}
        connect
        video
        audio
        onDisconnected={handleHostDisconnected}
        data-lk-theme="default"
        style={{ height: "100%" }}
      >
        {isHost && interviewId ? (
          <AdminConference interviewId={interviewId} />
        ) : (
          <CandidateConference />
        )}
        <RoomAudioRenderer />
        <BackgroundBlurToggle />
        {isHost && interviewId && <ModerationPanel interviewId={interviewId} />}
      </LiveKitRoom>

    </div>
  );
}


/**
 * Layout customizado para o anfitrião: tiles de participantes com overlay de
 * controles de moderação (mutar mic, mutar câmera, remover) renderizados sobre
 * a própria tile.
 */
function AdminConference({ interviewId }: { interviewId: string }) {
  const [widgetState, setWidgetState] = useState<{
    showChat: boolean;
    unreadMessages: number;
    showSettings?: boolean;
  }>({
    showChat: false,
    unreadMessages: 0,
    showSettings: false,
  });
  const layoutContext = useCreateLayoutContext();
  const trackRefs = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );

  const isMobile = useIsMobile();

  return (
    <LayoutContextProvider value={layoutContext} onWidgetChange={setWidgetState}>
      <div className="lk-video-conference" style={{ height: "100%" }}>
        <div
          className="lk-video-conference-inner"
          style={{ display: "flex", flexDirection: "column", minHeight: 0 }}
        >
          <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
            <AspectAwareGrid
              tracks={trackRefs}
              renderTile={(tr) => (
                <div style={{ position: "relative", height: "100%", width: "100%" }}>
                  <ParticipantTile trackRef={tr} />
                  <TileModerationOverlay interviewId={interviewId} />
                </div>
              )}
            />
          </div>
          <div style={{ flexShrink: 0 }}>
            <ControlBar
              controls={{ microphone: true, camera: true, screenShare: !isMobile, chat: true, leave: true }}
              variation={isMobile ? "minimal" : "verbose"}
            />
          </div>
        </div>
        <Chat
          style={{ display: widgetState.showChat ? "grid" : "none" }}
          messageFormatter={formatChatMessageLinks}
        />
      </div>
    </LayoutContextProvider>
  );
}

function TileModerationOverlay({ interviewId }: { interviewId: string }) {
  const trackRef = useMaybeTrackRefContext();
  const [busy, setBusy] = useState<string | null>(null);

  const participant = trackRef?.participant as RemoteParticipant | LocalParticipant | undefined;
  if (!participant || (participant as any).isLocal) return null;

  const remote = participant as RemoteParticipant;
  const micPub = remote.getTrackPublication(Track.Source.Microphone);
  const camPub = remote.getTrackPublication(Track.Source.Camera);
  const micSid = micPub?.trackSid;
  const camSid = camPub?.trackSid;
  const micMuted = !!micPub?.isMuted;
  const camMuted = !!camPub?.isMuted;

  const run = async (
    key: string,
    action: "mute_track" | "unmute_track" | "remove_participant",
    trackSid?: string,
    source?: "microphone" | "camera",
  ) => {
    setBusy(key);
    try {
      await callModerate({
        interviewId,
        action,
        targetIdentity: remote.identity,
        trackSid,
        source,
      });
      toast.success(
        action === "remove_participant"
          ? "Participante removido."
          : action === "mute_track"
            ? "Trilha mutada."
            : "Trilha liberada.",
      );
    } catch (e: any) {
      toast.error(e?.message || "Falha na ação de moderação.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="absolute bottom-2 right-2 z-20 flex gap-1.5 rounded-md bg-black/60 p-1.5 backdrop-blur-sm opacity-90 hover:opacity-100 transition-opacity"
      onClick={(e) => e.stopPropagation()}
    >
      <Button
        size="icon"
        variant={micMuted ? "secondary" : "outline"}
        className="h-10 w-10 sm:h-7 sm:w-7"
        title={micMuted ? "Desmutar microfone" : "Mutar microfone"}
        disabled={!micSid || busy === `mic-${remote.identity}`}
        onClick={() =>
          run(
            `mic-${remote.identity}`,
            micMuted ? "unmute_track" : "mute_track",
            micSid,
            "microphone",
          )
        }
      >
        {micMuted ? <MicOff className="h-4 w-4 sm:h-3.5 sm:w-3.5" /> : <Mic className="h-4 w-4 sm:h-3.5 sm:w-3.5" />}
      </Button>
      <Button
        size="icon"
        variant={camMuted ? "secondary" : "outline"}
        className="h-10 w-10 sm:h-7 sm:w-7"
        title={camMuted ? "Liberar câmera" : "Mutar câmera"}
        disabled={!camSid || busy === `cam-${remote.identity}`}
        onClick={() =>
          run(
            `cam-${remote.identity}`,
            camMuted ? "unmute_track" : "mute_track",
            camSid,
            "camera",
          )
        }
      >
        {camMuted ? <VideoOff className="h-4 w-4 sm:h-3.5 sm:w-3.5" /> : <Video className="h-4 w-4 sm:h-3.5 sm:w-3.5" />}
      </Button>
      <Button
        size="icon"
        variant="destructive"
        className="h-10 w-10 sm:h-7 sm:w-7"
        title="Remover da sala"
        disabled={busy === `remove-${remote.identity}`}
        onClick={() => run(`remove-${remote.identity}`, "remove_participant")}
      >
        <UserX className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
      </Button>
    </div>
  );
}

function ModerationPanel({ interviewId }: { interviewId: string }) {
  const participants = useParticipants();
  const remotes = participants.filter((p) => !p.isLocal) as RemoteParticipant[];
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (
    key: string,
    action: "mute_track" | "unmute_track" | "remove_participant",
    targetIdentity: string,
    trackSid?: string,
    source?: "microphone" | "camera",
  ) => {
    setBusy(key);
    try {
      await callModerate({ interviewId, action, targetIdentity, trackSid, source });
      toast.success(
        action === "remove_participant"
          ? "Participante removido."
          : action === "mute_track"
            ? "Trilha mutada."
            : "Trilha liberada.",
      );
    } catch (e: any) {
      toast.error(e?.message || "Falha na ação de moderação.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          size="sm"
          variant="secondary"
          className="fixed right-2 z-50 shadow-lg text-xs sm:text-sm"
          style={{ top: "calc(env(safe-area-inset-top) + 8px)" }}
        >
          <Shield className="mr-1.5 h-4 w-4" /> Moderar ({remotes.length})
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:w-80">
        <SheetHeader>
          <SheetTitle>Participantes</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-3">
          {remotes.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum outro participante na sala.
            </p>
          )}
          {remotes.map((p) => {
            const micPub = p.getTrackPublication(Track.Source.Microphone);
            const camPub = p.getTrackPublication(Track.Source.Camera);
            const micSid = micPub?.trackSid;
            const camSid = camPub?.trackSid;
            const micMuted = !!micPub?.isMuted;
            const camMuted = !!camPub?.isMuted;
            return (
              <div key={p.identity} className="rounded-md border border-border p-3 space-y-2">
                <p className="text-sm font-medium truncate">{p.name || p.identity}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!micSid || busy === `mic-${p.identity}`}
                    onClick={() =>
                      run(`mic-${p.identity}`, micMuted ? "unmute_track" : "mute_track", p.identity, micSid, "microphone")
                    }
                  >
                    {micMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                    <span className="ml-1">{micMuted ? "Desmutar mic" : "Mutar mic"}</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!camSid || busy === `cam-${p.identity}`}
                    onClick={() =>
                      run(`cam-${p.identity}`, camMuted ? "unmute_track" : "mute_track", p.identity, camSid, "camera")
                    }
                  >
                    {camMuted ? <VideoOff className="h-4 w-4" /> : <Video className="h-4 w-4" />}
                    <span className="ml-1">{camMuted ? "Liberar cam" : "Mutar cam"}</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy === `remove-${p.identity}`}
                    onClick={() => run(`remove-${p.identity}`, "remove_participant", p.identity)}
                  >
                    <UserX className="mr-1 h-4 w-4" /> Remover
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}


