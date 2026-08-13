import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { CalendarPlus, PlayCircle, Loader2, CalendarDays, Clock, MapPin } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { TestScheduleDialog } from "./TestScheduleDialog";
import { formatDateBR } from "@/lib/dateUtils";
import { useUnitAddress, formatFullAddress } from "@/hooks/useUnitAddress";
import type { PostInterviewTestState } from "@/hooks/useApplicationStatus";

interface Props {
  applicationId: string;
  state: PostInterviewTestState;
}

/**
 * Gate de modalidade do teste pós-entrevista (fluxo pipeline).
 *  - stage "choose":   candidato escolhe online (libera o teste do pipeline)
 *                      ou presencial (abre agendamento na unidade).
 *  - stage "schedule": modalidade presencial definida — falta agendar.
 *  - stage "scheduled": teste presencial agendado — mostra data/hora.
 */
export function PostInterviewModalityCard({ applicationId, state }: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [saving, setSaving] = useState<"online" | "presencial" | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const canChooseOnline = state.stage === "choose" && (state.modality === "online" || state.modality === "ambos");
  const canChoosePresencial = state.modality === "presencial" || state.modality === "ambos";

  const { data: unit } = useQuery({
    queryKey: ["unit_for_modality_card", state.unitId],
    enabled: !!state.unitId && state.stage === "scheduled" && state.modality === "presencial",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("units")
        .select("id, name, cep, city, state")
        .eq("id", state.unitId)
        .single();
      if (error) throw error;
      return data;
    },
  });
  const { data: resolvedAddress } = useUnitAddress(unit?.cep);
  console.log("[CANDIDATO][PostInterviewModalityCard] render", {
    applicationId,
    state,
    canChooseOnline,
    canChoosePresencial,
  });


  const saveChoice = async (modality: "online" | "presencial") => {
    setSaving(modality);
    try {
      const { error } = await (supabase as any).rpc("choose_post_interview_modality", {
        p_application_id: applicationId,
        p_modality: modality,
      });
      if (error) throw error;
      if (modality === "online") {
        await qc.invalidateQueries({ queryKey: ["application_status", applicationId] });
        navigate(`/triagem/${applicationId}`);
      } else {
        setScheduleOpen(true);
      }
    } catch (e: any) {
      toast.error(e.message || "Não foi possível registrar a escolha. Tente novamente.");
    } finally {
      setSaving(null);
    }
  };

  const handleOnline = () => {
    if (state.modality === "online") {
      navigate(`/triagem/${applicationId}`);
      return;
    }
    void saveChoice("online");
  };

  if (state.stage === "scheduled" && state.booking) {
    const fullAddress = formatFullAddress(resolvedAddress, unit?.city, unit?.state);
    return (
      <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 space-y-1">
        <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
          <CalendarDays className="h-3.5 w-3.5 text-primary shrink-0" />
          Teste presencial agendado
        </p>
        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <Clock className="h-3 w-3 shrink-0" />
          {formatDateBR(state.booking.scheduled_date)} às{" "}
          {state.booking.scheduled_time?.slice(0, 5)}
          {state.booking.end_time ? ` – ${state.booking.end_time.slice(0, 5)}` : ""}
        </p>
        <div className="text-[11px] text-muted-foreground flex items-start gap-1.5">
          <MapPin className="h-3 w-3 shrink-0 mt-0.5 text-foreground" />
          <div className="flex flex-col gap-0.5">
            {unit?.name && (
              <span className="font-medium text-foreground">{unit.name}</span>
            )}
            {fullAddress ? (
              <span>{fullAddress}</span>
            ) : (
              <span>
                {unit?.city && unit?.state
                  ? `${unit.city}, ${unit.state}`
                  : "Endereço da unidade indisponível"}
              </span>
            )}
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Compareça à unidade no horário marcado para realizar o teste.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 rounded-lg p-3 space-y-2">
      <p className="text-xs font-semibold text-amber-900 dark:text-amber-100">
        {state.stage === "choose"
          ? state.modality === "ambos" ? "Como você quer realizar o teste?" : "Teste disponível"
          : "Agende seu teste presencial"}
      </p>
      <p className="text-[11px] text-amber-800/80 dark:text-amber-200/80">
        {state.stage === "choose"
          ? state.modality === "ambos"
            ? "Sua entrevista foi aprovada. Escolha a modalidade do teste para continuar."
            : "Sua entrevista foi aprovada. Continue para realizar o teste."
          : "Escolha uma data e horário disponíveis na unidade."}
      </p>
      <div className="flex flex-wrap gap-2">
        {canChooseOnline && (
          <Button
            size="sm"
            className="flex-1 min-w-[140px]"
            disabled={!!saving}
            onClick={handleOnline}
          >
            {saving === "online" ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <PlayCircle className="h-4 w-4 mr-1" />
            )}
            Fazer teste online
          </Button>
        )}
        {canChoosePresencial && (
          <Button
            size="sm"
            variant={state.stage === "choose" ? "outline" : "default"}
            className="flex-1 min-w-[140px]"
            disabled={!!saving}
            onClick={() =>
              state.stage === "choose" ? saveChoice("presencial") : setScheduleOpen(true)
            }
          >
            {saving === "presencial" ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <CalendarPlus className="h-4 w-4 mr-1" />
            )}
            {state.stage === "choose" ? "Teste presencial" : "Agendar teste presencial"}
          </Button>
        )}
      </div>

      <TestScheduleDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        testAssignmentId={null}
        applicationId={applicationId}
        unitId={state.unitId}
        onBooked={() => qc.invalidateQueries({ queryKey: ["application_status", applicationId] })}
      />
    </div>
  );
}
