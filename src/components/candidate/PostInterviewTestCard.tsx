import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FlaskConical, PlayCircle } from "lucide-react";
import { useMyTestAssignments } from "@/hooks/useTests";
import { useUnitTestConfig, useChooseOnlineTest } from "@/hooks/useTestBookings";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

/**
 * Card mostrado na Home/Candidaturas quando há um `test_assignment` com
 * `post_interview=true` pendente (fluxo legado, para vagas sem a fase de
 * pipeline `avaliacao_pos_entrevista`).
 *
 * No novo fluxo unificado "Online + Presencial", o teste ONLINE é sempre a
 * primeira etapa (obrigatória, sem escolha). O agendamento do teste presencial
 * é oferecido depois, pelo `PostTestPresencialCard`, ao concluir o online.
 */
export function PostInterviewTestCard() {
  const { data: tests } = useMyTestAssignments();
  const navigate = useNavigate();
  const chooseOnline = useChooseOnlineTest();

  const pending = useMemo(
    () =>
      (tests || []).filter(
        (t: any) =>
          t.post_interview === true &&
          (t.status === "pendente" || t.status === "em_andamento") &&
          !t.booking_id,
      ),
    [tests],
  );

  // Carrega unit_ids das pending para query de config
  const applicationIds = pending.map((t: any) => t.application_id);
  const { data: appsMeta } = useQuery({
    queryKey: ["pending_post_interview_apps", applicationIds.slice().sort().join(",")],
    enabled: applicationIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("applications")
        .select("id, unit_jobs!inner(unit_id, jobs!inner(title))")
        .in("id", applicationIds);
      return (data || []) as any[];
    },
  });

  const appMap = useMemo(() => {
    const m: Record<string, { unitId: string; jobTitle: string }> = {};
    (appsMeta || []).forEach((a: any) => {
      m[a.id] = {
        unitId: a.unit_jobs?.unit_id,
        jobTitle: a.unit_jobs?.jobs?.title || "",
      };
    });
    return m;
  }, [appsMeta]);

  if (pending.length === 0) return null;

  return (
    <>
      {pending.map((t: any) => {
        const meta = appMap[t.application_id];
        if (!meta?.unitId) return null;
        return (
          <PendingTestRow
            key={t.id}
            unitId={meta.unitId}
            jobTitle={meta.jobTitle}
            onOnline={async () => {
              await chooseOnline.mutateAsync(t.id);
              navigate(`/testes/${t.id}`);
            }}
          />
        );
      })}
    </>
  );
}

function PendingTestRow({
  unitId,
  jobTitle,
  onOnline,
}: {
  unitId: string;
  jobTitle: string;
  onOnline: () => void;
}) {
  const { data: cfg } = useUnitTestConfig(unitId);
  if (!cfg?.enabled) return null;

  return (
    <Card className="border-amber-300 bg-amber-50/60 flex flex-col min-w-0 overflow-hidden">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-amber-500 p-2 text-white">
            <FlaskConical className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm">Teste pós-entrevista liberado</p>
            <p className="text-xs text-muted-foreground truncate">
              {jobTitle ? `Vaga: ${jobTitle}` : "Próxima etapa do processo"}
            </p>
          </div>
          <Badge variant="outline" className="border-amber-500 text-amber-700">
            Teste online
          </Badge>
        </div>

        <p className="text-xs text-muted-foreground">
          Faça o teste online agora. Ao concluir, você poderá agendar o teste presencial na unidade.
        </p>

        <Button size="sm" onClick={onOnline} className="w-full">
          <PlayCircle className="h-4 w-4 mr-1" />
          Fazer teste online
        </Button>
      </CardContent>
    </Card>
  );
}
