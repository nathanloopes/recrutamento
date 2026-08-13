import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { PageHelp } from "@/components/ui/page-help";
import {
  Mic,
  Search,
  Download,
  Play,
  User,
  Clock,
  CheckCircle2,
  XCircle,
  Award,
  Filter,
  FileText,
  BarChart3,
  AlertTriangle,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

// ─── Types ──────────────────────────────────────────────────────────────────────

interface VoiceInterview {
  id: string;
  candidate_id: string;
  job_title: string | null;
  status: string;
  final_score: number | null;
  final_decision: string | null;
  created_at: string;
  ended_at: string | null;
  consent_given_at: string;
  config_snapshot: any;
  profiles?: { full_name: string | null; email: string | null } | null;
}

interface Transcript {
  id: string;
  voice_interview_id: string;
  question_index: number;
  question_text: string;
  transcription: string | null;
  audio_storage_path: string | null;
  duration_seconds: number | null;
  created_at: string;
}

interface AIScore {
  id: string;
  voice_interview_id: string;
  transcript_id: string | null;
  dimension: string;
  score: number;
  justification: string | null;
  model_used: string | null;
}

// ─── Hook ───────────────────────────────────────────────────────────────────────

function useVoiceInterviews(filters: {
  status?: string;
  minScore?: number;
  maxScore?: number;
  search?: string;
}) {
  return useQuery({
    queryKey: ["voice_interviews_admin", filters],
    queryFn: async () => {
      let q = supabase
        .from("voice_interviews" as any)
        .select("*, profiles:candidate_id(full_name, email)")
        .order("created_at", { ascending: false })
        .limit(100);

      if (filters.status && filters.status !== "all") {
        if (filters.status === "escalated") {
          q = q.eq("final_decision", "ESCALATED");
        } else {
          q = q.eq("status", filters.status);
        }
      }
      if (filters.minScore != null) {
        q = q.gte("final_score", filters.minScore);
      }
      if (filters.maxScore != null) {
        q = q.lte("final_score", filters.maxScore);
      }

      const { data, error } = await q;
      if (error) throw error;

      let interviews = (data || []) as unknown as VoiceInterview[];

      // Client-side search filter
      if (filters.search) {
        const term = filters.search.toLowerCase();
        interviews = interviews.filter(
          (i) =>
            i.profiles?.full_name?.toLowerCase().includes(term) ||
            i.job_title?.toLowerCase().includes(term)
        );
      }

      return interviews;
    },
  });
}

function useInterviewDetail(interviewId?: string) {
  const transcripts = useQuery({
    queryKey: ["voice_interview_transcripts", interviewId],
    enabled: !!interviewId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("voice_interview_transcripts" as any)
        .select("*")
        .eq("voice_interview_id", interviewId!)
        .order("question_index", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as Transcript[];
    },
  });

  const scores = useQuery({
    queryKey: ["voice_interview_scores", interviewId],
    enabled: !!interviewId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("voice_interview_scores" as any)
        .select("*")
        .eq("voice_interview_id", interviewId!);
      if (error) throw error;
      return (data || []) as unknown as AIScore[];
    },
  });

  return { transcripts, scores };
}

// ─── Component ──────────────────────────────────────────────────────────────────

export default function VoiceInterviewReview() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedInterview, setSelectedInterview] = useState<VoiceInterview | null>(null);

  const { data: interviews, isLoading } = useVoiceInterviews({
    status: statusFilter,
    search: searchTerm,
  });

  const handleExportCSV = () => {
    if (!interviews?.length) return;

    const headers = ["Candidato", "Email", "Cargo", "Status", "Score", "Decisão", "Data", "Consentimento LGPD"];
    const rows = interviews.map((i) => [
      i.profiles?.full_name || "N/A",
      i.profiles?.email || "N/A",
      i.job_title || "N/A",
      i.status,
      i.final_score ?? "N/A",
      i.final_decision || "N/A",
      format(new Date(i.created_at), "dd/MM/yyyy HH:mm"),
      i.consent_given_at ? "Sim" : "Não",
    ]);

    const csv = [headers, ...rows].map((r) => r.join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `entrevistas-ia-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const stats = {
    total: interviews?.length || 0,
    completed: interviews?.filter((i) => i.status === "completed").length || 0,
    approved: interviews?.filter((i) => i.final_decision === "APPROVED").length || 0,
    escalated: interviews?.filter((i) => i.final_decision === "ESCALATED").length || 0,
    avgScore: interviews?.length
      ? Math.round(
          interviews.reduce((sum, i) => sum + (i.final_score || 0), 0) /
            interviews.filter((i) => i.final_score != null).length || 1
        )
      : 0,
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Mic className="h-6 w-6" />
            Entrevistas com IA
          </h1>
          <p className="text-sm text-muted-foreground">Revise e audite entrevistas realizadas por IA</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={!interviews?.length}>
            <Download className="h-4 w-4 mr-1" />
            Exportar CSV
          </Button>
          <PageHelp />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{stats.total}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-green-600">{stats.completed}</p>
            <p className="text-xs text-muted-foreground">Concluídas</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-primary">{stats.approved}</p>
            <p className="text-xs text-muted-foreground">Aprovados</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-orange-600">{stats.escalated}</p>
            <p className="text-xs text-muted-foreground">Escalados</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{stats.avgScore}</p>
            <p className="text-xs text-muted-foreground">Score Médio</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou cargo..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent disableSearch>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="completed">Concluídas</SelectItem>
            <SelectItem value="in_progress">Em andamento</SelectItem>
            <SelectItem value="escalated">Escalados</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Interview List */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      ) : !interviews?.length ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Nenhuma entrevista com IA encontrada.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {interviews.map((interview) => (
            <Card
              key={interview.id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => setSelectedInterview(interview)}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <User className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-semibold">{interview.profiles?.full_name || "Candidato"}</p>
                      <p className="text-xs text-muted-foreground">{interview.job_title || "Cargo não informado"}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {interview.final_score != null && (
                      <span className="text-lg font-bold">{interview.final_score}</span>
                    )}
                    <DecisionBadge decision={interview.final_decision} />
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(interview.created_at), "dd/MM/yy HH:mm")}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Detail Dialog */}
      {selectedInterview && (
        <InterviewDetailDialog
          interview={selectedInterview}
          open={!!selectedInterview}
          onOpenChange={(open) => { if (!open) setSelectedInterview(null); }}
        />
      )}
    </div>
  );
}

// ─── Sub Components ─────────────────────────────────────────────────────────────

function DecisionBadge({ decision }: { decision: string | null }) {
  if (!decision) return <Badge variant="secondary">Pendente</Badge>;

  const config: Record<string, { label: string; className: string; icon: any }> = {
    APPROVED: { label: "Aprovado", className: "bg-green-100 text-green-700", icon: CheckCircle2 },
    TALENT_POOL: { label: "Banco de Talentos", className: "bg-blue-100 text-blue-700", icon: Award },
    REJECTED: { label: "Standby", className: "bg-yellow-100 text-yellow-700", icon: Clock },
    ESCALATED: { label: "Escalado p/ RH", className: "bg-orange-100 text-orange-700", icon: AlertTriangle },
  };
  const c = config[decision] || { label: decision, className: "", icon: Clock };
  return (
    <Badge variant="secondary" className={`text-[10px] ${c.className}`}>
      <c.icon className="h-3 w-3 mr-1" />
      {c.label}
    </Badge>
  );
}

function InterviewDetailDialog({
  interview,
  open,
  onOpenChange,
}: {
  interview: VoiceInterview;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { transcripts, scores } = useInterviewDetail(interview.id);
  const [playingAudio, setPlayingAudio] = useState<string | null>(null);

  const dimensionLabels: Record<string, string> = {
    communication: "Comunicação",
    confidence: "Confiança",
    technical_level: "Nível Técnico",
    reasoning: "Raciocínio",
    clarity: "Clareza",
    behavioral_signals: "Comportamento",
  };

  // Aggregate scores by dimension
  const dimensionAverages: Record<string, { total: number; count: number }> = {};
  (scores.data || []).forEach((s) => {
    if (!dimensionAverages[s.dimension]) {
      dimensionAverages[s.dimension] = { total: 0, count: 0 };
    }
    dimensionAverages[s.dimension].total += s.score;
    dimensionAverages[s.dimension].count += 1;
  });

  const handlePlayAudio = async (path: string) => {
    if (playingAudio === path) {
      setPlayingAudio(null);
      return;
    }
    try {
      const { data } = await supabase.storage.from("voice-recordings").createSignedUrl(path, 600);
      if (data?.signedUrl) {
        const audio = new Audio(data.signedUrl);
        audio.onended = () => setPlayingAudio(null);
        audio.play();
        setPlayingAudio(path);
      }
    } catch {}
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mic className="h-5 w-5" />
            Entrevista — {interview.profiles?.full_name || "Candidato"}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[75vh]">
          <div className="space-y-6 pr-4">
            {/* Summary */}
            <Card>
              <CardContent className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">Cargo</p>
                  <p className="font-medium">{interview.job_title || "N/A"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Score Final</p>
                  <p className="font-bold text-lg">{interview.final_score ?? "N/A"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Decisão</p>
                  <DecisionBadge decision={interview.final_decision} />
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Data</p>
                  <p>{format(new Date(interview.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}</p>
                </div>
              </CardContent>
            </Card>

            {/* Dimension Scores */}
            {Object.keys(dimensionAverages).length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <BarChart3 className="h-4 w-4" />
                    Scores por Dimensão
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {Object.entries(dimensionAverages).map(([dim, data]) => {
                    const avg = Math.round(data.total / data.count);
                    return (
                      <div key={dim} className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span>{dimensionLabels[dim] || dim}</span>
                          <span className="font-semibold">{avg}/100</span>
                        </div>
                        <Progress value={avg} className="h-2" />
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}

            {/* Transcriptions */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Transcrições ({transcripts.data?.length || 0} perguntas)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {transcripts.isLoading ? (
                  <p className="text-sm text-muted-foreground">Carregando...</p>
                ) : !transcripts.data?.length ? (
                  <p className="text-sm text-muted-foreground">Nenhuma transcrição disponível.</p>
                ) : (
                  transcripts.data.map((t, idx) => (
                    <div key={t.id} className="border rounded-lg p-3 space-y-2">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="text-xs font-medium text-primary">
                            Pergunta {t.question_index + 1}
                          </p>
                          <p className="text-sm font-medium">{t.question_text}</p>
                        </div>
                        {t.audio_storage_path && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handlePlayAudio(t.audio_storage_path!)}
                            className="ml-2"
                          >
                            <Play className={`h-4 w-4 ${playingAudio === t.audio_storage_path ? "text-primary" : ""}`} />
                          </Button>
                        )}
                      </div>
                      <div className="bg-muted/50 rounded p-2">
                        <p className="text-xs text-muted-foreground mb-1">Resposta do candidato:</p>
                        <p className="text-sm">{t.transcription || <em className="text-muted-foreground">Sem transcrição</em>}</p>
                      </div>
                      {t.duration_seconds && (
                        <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {t.duration_seconds}s
                        </p>
                      )}

                      {/* Per-turn scores */}
                      {(() => {
                        const turnScores = (scores.data || []).filter((s) => s.transcript_id === t.id);
                        if (!turnScores.length) return null;
                        return (
                          <div className="grid grid-cols-3 gap-1 mt-2">
                            {turnScores.map((s) => (
                              <div key={s.id} className="text-[10px] bg-muted rounded px-2 py-1">
                                <span className="text-muted-foreground">{dimensionLabels[s.dimension] || s.dimension}: </span>
                                <span className="font-semibold">{s.score}</span>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {/* Score Justifications */}
            {(scores.data || []).filter((s) => s.justification).length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Justificativas da IA</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {(scores.data || [])
                    .filter((s) => s.justification)
                    .map((s) => (
                      <div key={s.id} className="text-xs border-l-2 border-primary/30 pl-3">
                        <span className="font-medium">{dimensionLabels[s.dimension] || s.dimension}:</span>{" "}
                        {s.justification}
                      </div>
                    ))}
                </CardContent>
              </Card>
            )}

            {/* LGPD Info */}
            <div className="text-[10px] text-muted-foreground text-center">
              Consentimento LGPD: {interview.consent_given_at ? format(new Date(interview.consent_given_at), "dd/MM/yyyy HH:mm:ss") : "N/A"}
              {" · "}ID: {interview.id.slice(0, 8)}
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
