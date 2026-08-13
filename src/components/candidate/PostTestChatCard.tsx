import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MessageCircle, CalendarCheck2, CalendarPlus } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PostTestChatScheduler } from "@/components/candidate/PostTestChatScheduler";

/**
 * Etapa "Informações do processo" — aparece quando:
 *  - o candidato tem teste pós-entrevista APROVADO; e
 *  - a modalidade escolhida para o teste foi ONLINE.
 *
 * Reutiliza integralmente o `InterviewScheduler` para agendar um bate-papo
 * com o recrutador (purpose='bate_papo' diferencia do compromisso de
 * entrevista no banco). Toda a agenda, disponibilidade, conflitos,
 * notificações e regras existentes são herdadas.
 */
export function PostTestChatCard() {
  const { user } = useAuth();
  const [scheduling, setScheduling] = useState<null | { applicationId: string; unitId: string; jobTitle?: string; jobId?: string }>(null);

  const { data: candidates } = useQuery({
    queryKey: ["post_test_chat_candidates", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      // Fonte principal: candidaturas do usuário com modalidade online do
      // pós-teste definida E que já foram aprovadas (via test_assignment ou
      // via step_responses do pipeline). O campo `post_interview_modality`
      // é gravado nos dois fluxos, então serve como âncora.
      const { data: apps } = await supabase
        .from("applications")
        .select("id, status, post_interview_modality, candidate_id, unit_jobs!inner(unit_id, job_id, jobs!inner(title))")
        .eq("candidate_id", user!.id)
        .eq("post_interview_modality", "online")
        .in("status", ["aprovado", "em_avaliacao"]);
      if (!apps || apps.length === 0) return [];

      // Confirma que houve aprovação real do teste pós-entrevista:
      // 1) via test_assignments (fluxo legado), OU
      // 2) via step_responses de fase avaliacao_pos_entrevista (pipeline).
      const appIds = apps.map((a: any) => a.id);
      const [{ data: assigns }, { data: stepResps }] = await Promise.all([
        supabase
          .from("test_assignments" as any)
          .select("application_id, status, post_interview")
          .in("application_id", appIds)
          .eq("post_interview", true)
          .eq("status", "aprovado"),
        supabase
          .from("step_responses")
          .select("application_id, pipeline_steps!inner(pipeline_phases!inner(phase_kind))")
          .in("application_id", appIds)
          .eq("pipeline_steps.pipeline_phases.phase_kind", "avaliacao_pos_entrevista"),
      ]);
      const approvedByAssign = new Set(((assigns || []) as any[]).map((a) => a.application_id));
      const answeredByStep = new Set(((stepResps || []) as any[]).map((r) => r.application_id));
      const approvedApps = apps.filter(
        (a: any) =>
          approvedByAssign.has(a.id) ||
          (a.status === "aprovado" && answeredByStep.has(a.id)),
      );
      if (approvedApps.length === 0) return [];

      // Bate-papos já agendados
      const { data: existing } = await supabase
        .from("interviews")
        .select("id, application_id, scheduled_date, scheduled_time, status, purpose")
        .in("application_id", approvedApps.map((a: any) => a.id))
        .eq("purpose", "bate_papo")
        .neq("status", "cancelled");
      const byApp = new Map<string, any>();
      (existing || []).forEach((row: any) => {
        if (!byApp.get(row.application_id)) byApp.set(row.application_id, row);
      });

      return approvedApps.map((a: any) => ({
        applicationId: a.id,
        unitId: a.unit_jobs?.unit_id,
        jobId: a.unit_jobs?.job_id,
        jobTitle: a.unit_jobs?.jobs?.title || "",
        chat: byApp.get(a.id) || null,
      }));
    },
  });

  const items = useMemo(() => (candidates || []).filter((c) => !!c.unitId), [candidates]);
  if (items.length === 0) return null;

  return (
    <>
      {items.map((it) => {
        const chat = it.chat;
        return (
          <Card
            key={it.applicationId}
            className="border-emerald-300 bg-emerald-50/60 flex flex-col min-w-0 overflow-hidden"
          >
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="rounded-full bg-emerald-600 p-2 text-white">
                  <MessageCircle className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">Informações do processo</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {it.jobTitle ? `Vaga: ${it.jobTitle}` : "Próximo passo do processo"}
                  </p>
                </div>
                <Badge variant="outline" className="border-emerald-600 text-emerald-700">
                  Bate-papo
                </Badge>
              </div>

              {chat ? (
                <div className="rounded-md border border-emerald-200 bg-white/70 p-3 text-sm space-y-1">
                  <div className="flex items-center gap-2">
                    <CalendarCheck2 className="h-4 w-4 text-emerald-700" />
                    <span className="font-medium">
                      {format(new Date(chat.scheduled_date + "T12:00:00"), "EEEE, dd 'de' MMMM", { locale: ptBR })}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Horário: {String(chat.scheduled_time).slice(0, 5)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {chat.status === "pending_approval"
                      ? "Aguardando confirmação do recrutador."
                      : "Bate-papo confirmado. O link/local será enviado pelo recrutador."}
                  </p>
                </div>
              ) : (
                <>
                  <p className="text-sm text-foreground/90">
                    Parabéns! Você foi aprovado(a) nesta etapa do processo seletivo.
                    O próximo passo é agendar um breve bate-papo com o recrutador para
                    alinhar os detalhes finais. Escolha abaixo o melhor dia e horário.
                  </p>
                  <Button
                    size="sm"
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={() =>
                      setScheduling({
                        applicationId: it.applicationId,
                        unitId: it.unitId,
                        jobTitle: it.jobTitle,
                        jobId: it.jobId,
                      })
                    }
                  >
                    <CalendarPlus className="h-4 w-4 mr-1" />
                    Agendar bate-papo
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        );
      })}

      {scheduling && (
        <PostTestChatScheduler
          applicationId={scheduling.applicationId}
          unitId={scheduling.unitId}
          jobTitle={scheduling.jobTitle}
          open={!!scheduling}
          onOpenChange={(o) => !o && setScheduling(null)}
          onScheduled={() => setScheduling(null)}
        />
      )}
    </>
  );
}
