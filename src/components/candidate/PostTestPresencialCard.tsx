import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, CalendarPlus, FlaskConical } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { TestScheduleDialog } from "@/components/candidate/TestScheduleDialog";
import { PostInterviewModalityCard } from "@/components/candidate/PostInterviewModalityCard";

/**
 * Etapa pós-teste-online do novo fluxo unificado "Online + Presencial".
 *
 * Aparece quando o candidato:
 *  - concluiu o teste ONLINE pós-entrevista (respostas gravadas na fase
 *    `avaliacao_pos_entrevista`, ou `test_assignment` post_interview concluído
 *    no fluxo legado); e
 *  - a unidade tem o teste habilitado (`unit_test_config.enabled`).
 *
 * Substitui o antigo "Bate-papo": em vez de agendar uma conversa, orienta o
 * candidato sobre a próxima etapa e permite agendar o TESTE PRESENCIAL usando
 * a agenda já existente da unidade (`TestScheduleDialog` → `test_bookings`).
 */
export function PostTestPresencialCard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [scheduling, setScheduling] = useState<null | { applicationId: string; unitId: string }>(null);

  const { data: candidates } = useQuery({
    queryKey: ["post_test_presencial_candidates", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      // 1. Candidaturas ativas do candidato (em processo, não terminais).
      const { data: apps } = await supabase
        .from("applications")
        .select("id, status, candidate_id, unit_jobs!inner(unit_id, job_id, jobs!inner(title))")
        .eq("candidate_id", user!.id)
        .in("status", ["em_andamento", "em_avaliacao", "aprovado"]);
      if (!apps || apps.length === 0) return [];
      const appIds = apps.map((a: any) => a.id);

      // 2. Teste ONLINE concluído:
      //    - pipeline: existe step_response na fase `avaliacao_pos_entrevista`; OU
      //    - legado: `test_assignment` post_interview concluído/avaliado.
      const [{ data: stepResps }, { data: assigns }] = await Promise.all([
        supabase
          .from("step_responses")
          .select("application_id, pipeline_steps!inner(pipeline_phases!inner(phase_kind))")
          .in("application_id", appIds)
          .eq("pipeline_steps.pipeline_phases.phase_kind", "avaliacao_pos_entrevista"),
        supabase
          .from("test_assignments" as any)
          .select("application_id, status, post_interview, completed_at")
          .in("application_id", appIds)
          .eq("post_interview", true),
      ]);
      const onlineDone = new Set<string>();
      ((stepResps || []) as any[]).forEach((r) => onlineDone.add(r.application_id));
      ((assigns || []) as any[]).forEach((a) => {
        if (a.completed_at || ["concluido", "avaliado", "aprovado"].includes(String(a.status))) {
          onlineDone.add(a.application_id);
        }
      });
      const doneApps = apps.filter((a: any) => onlineDone.has(a.id));
      if (doneApps.length === 0) return [];

      // 3. Unidade com teste habilitado.
      const unitIds = Array.from(new Set(doneApps.map((a: any) => a.unit_jobs?.unit_id).filter(Boolean)));
      const { data: cfgs } = await (supabase as any)
        .from("unit_test_config")
        .select("unit_id, enabled")
        .in("unit_id", unitIds);
      const enabledUnits = new Set(((cfgs || []) as any[]).filter((c) => c.enabled).map((c) => c.unit_id));

      // 4. Bookings presenciais existentes (ignora cancelado/no_show).
      const { data: bookings } = await (supabase as any)
        .from("test_bookings")
        .select("id, application_id, scheduled_date, scheduled_time, end_time, status")
        .in("application_id", doneApps.map((a: any) => a.id))
        .order("created_at", { ascending: false });
      const bookingByApp = new Map<string, any>();
      const liveByApp = new Map<string, any>();
      ((bookings || []) as any[]).forEach((b) => {
        if (b.status === "cancelado" || b.status === "no_show") return;
        if (!liveByApp.has(b.application_id)) liveByApp.set(b.application_id, b);
        if (b.status === "agendado" && !bookingByApp.has(b.application_id)) {
          bookingByApp.set(b.application_id, b);
        }
      });

      return doneApps
        .filter((a: any) => enabledUnits.has(a.unit_jobs?.unit_id))
        .map((a: any) => ({
          applicationId: a.id,
          unitId: a.unit_jobs?.unit_id as string,
          jobTitle: a.unit_jobs?.jobs?.title || "",
          booking: bookingByApp.get(a.id) || null,
          // Booking já realizado (não agendado e não morto) → etapa presencial concluída.
          presencialDone: !bookingByApp.get(a.id) && !!liveByApp.get(a.id),
        }));
    },
  });

  const items = useMemo(
    () => (candidates || []).filter((c) => !!c.unitId && !c.presencialDone),
    [candidates],
  );
  if (items.length === 0) return null;

  return (
    <>
      {items.map((it) => {
        // Já agendado → reaproveita o card "scheduled" do PostInterviewModalityCard
        // (mostra data/hora/endereço da unidade).
        if (it.booking) {
          return (
            <PostInterviewModalityCard
              key={it.applicationId}
              applicationId={it.applicationId}
              state={{
                stage: "scheduled",
                unitId: it.unitId,
                modality: "presencial",
                booking: it.booking,
              }}
            />
          );
        }

        // Ainda não agendou → mensagem + botão de agendamento.
        return (
          <Card
            key={it.applicationId}
            className="border-emerald-300 bg-emerald-50/60 flex flex-col min-w-0 overflow-hidden"
          >
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="rounded-full bg-emerald-600 p-2 text-white">
                  <CheckCircle2 className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">Teste online concluído</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {it.jobTitle ? `Vaga: ${it.jobTitle}` : "Próxima etapa do processo"}
                  </p>
                </div>
                <Badge variant="outline" className="border-emerald-600 text-emerald-700">
                  <FlaskConical className="h-3 w-3 mr-1" />
                  Teste presencial
                </Badge>
              </div>

              <p className="text-sm text-foreground/90">
                Você concluiu o teste online com sucesso! A próxima etapa é o{" "}
                <strong>teste presencial</strong> na unidade. Escolha abaixo o melhor dia e
                horário conforme a disponibilidade da unidade.
              </p>
              <Button
                size="sm"
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => setScheduling({ applicationId: it.applicationId, unitId: it.unitId })}
              >
                <CalendarPlus className="h-4 w-4 mr-1" />
                Agendar teste presencial
              </Button>
            </CardContent>
          </Card>
        );
      })}

      {scheduling && (
        <TestScheduleDialog
          open={!!scheduling}
          onOpenChange={(o) => !o && setScheduling(null)}
          testAssignmentId={null}
          applicationId={scheduling.applicationId}
          unitId={scheduling.unitId}
          onBooked={() => {
            setScheduling(null);
            qc.invalidateQueries({ queryKey: ["post_test_presencial_candidates", user?.id] });
            qc.invalidateQueries({ queryKey: ["application_status", scheduling.applicationId] });
          }}
        />
      )}
    </>
  );
}
