import { useRef, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Stethoscope,
  CheckCircle2,
  XCircle,
  Download,
  Lock,
  CalendarIcon,
  MapPin,
  Clock,
  Upload,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getStorageClient } from "@/lib/storageDirect";
import {
  useApplicationAso,
  useApplicationAsoRealtime,
  useAsoSchedulingGate,
  useScheduleAso,
  useApproveAso,
  useRejectAso,
  useUploadAsoLaudo,
  type AsoRow,
} from "@/hooks/useApplicationAso";
import { NativeFileInput, type NativeFileInputHandle } from "@/components/ui/NativeFileInput";
import {
  formatDateBR,
  ymdToLocalDate,
  dateToLocalYMD,
} from "@/lib/dateUtils";
import { cn } from "@/lib/utils";

// Time slots in 30-min steps from 06:00 to 20:00
const TIME_SLOTS: string[] = (() => {
  const out: string[] = [];
  for (let h = 6; h <= 20; h++) {
    for (const m of [0, 30]) {
      out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return out;
})();

interface AsoSectionProps {
  applicationId: string;
  candidateId: string;
  unitId?: string | null;
}

const STATUS_LABEL: Record<AsoRow["status"], { label: string; cls: string }> = {
  pendente_agendamento: {
    label: "A agendar",
    cls: "bg-gray-100 text-gray-700",
  },
  agendado: { label: "Agendado", cls: "bg-blue-100 text-blue-700" },
  laudo_enviado: {
    label: "Laudo enviado",
    cls: "bg-amber-100 text-amber-800",
  },
  aprovado: { label: "Aprovado", cls: "bg-emerald-100 text-emerald-700" },
  reprovado: { label: "Reprovado", cls: "bg-red-100 text-red-700" },
};

export function AsoSection({
  applicationId,
  candidateId,
  unitId,
}: AsoSectionProps) {
  const { data: aso } = useApplicationAso(applicationId);
  useApplicationAsoRealtime(applicationId);
  const { data: gate } = useAsoSchedulingGate(applicationId);
  const schedule = useScheduleAso();
  const approve = useApproveAso();
  const reject = useRejectAso();
  const uploadLaudo = useUploadAsoLaudo();
  const inputRef = useRef<NativeFileInputHandle>(null);

  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState(aso?.address || "");
  const [date, setDate] = useState(aso?.scheduled_date || "");
  const [time, setTime] = useState((aso?.scheduled_time || "").slice(0, 5));
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting, setRejecting] = useState(false);

  const canSchedule = !!gate?.canSchedule;
  const status = aso?.status ?? "pendente_agendamento";
  const statusConf = STATUS_LABEL[status];

  const handleDownload = async () => {
    if (!aso?.laudo_file_url) return;
    const storage = await getStorageClient();
    const { data } = await storage.storage
      .from("aso-laudos")
      .createSignedUrl(aso.laudo_file_url, 300);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };

  const submitSchedule = () => {
    if (!address.trim() || !date || !time) return;
    schedule.mutate(
      {
        applicationId,
        candidateId,
        unitId: unitId ?? null,
        address: address.trim(),
        scheduledDate: date,
        scheduledTime: time.length === 5 ? `${time}:00` : time,
      },
      { onSuccess: () => setEditing(false) },
    );
  };

  const handleAttachLaudo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !aso) return;
    await uploadLaudo.mutateAsync({
      asoId: aso.id,
      applicationId,
      candidateId,
      file,
    });
  };

  return (
    <Card className="border-emerald-200 bg-emerald-50/30 dark:bg-emerald-950/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Stethoscope className="h-4 w-4 text-emerald-700" />
            Exame admissional (ASO)
          </span>
          {aso && (
            <Badge className={`${statusConf.cls} border-0`}>
              {statusConf.label}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!canSchedule && !aso ? (
          <div className="flex items-start gap-2 rounded-md border border-dashed p-3 text-muted-foreground">
            <Lock className="h-4 w-4 shrink-0 mt-0.5" />
            <p>
              Disponível após o candidato enviar todos os documentos
              obrigatórios.
              {gate?.total
                ? ` Faltam ${gate.missing}/${gate.total}.`
                : ""}
            </p>
          </div>
        ) : null}

        {(canSchedule || aso) && (!aso || editing) && (
          <div className="space-y-3 rounded-lg border bg-background p-3">
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-emerald-700" />
                Endereço da clínica/laboratório
              </Label>
              <Input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Rua, número, bairro, cidade"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs flex items-center gap-1.5">
                  <CalendarIcon className="h-3.5 w-3.5 text-emerald-700" />
                  Data do exame
                </Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !date && "text-muted-foreground",
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {date ? formatDateBR(date) : "Selecionar"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={ymdToLocalDate(date) ?? undefined}
                      onSelect={(d) => setDate(d ? dateToLocalYMD(d) : "")}
                      disabled={(d) => {
                        const t = new Date();
                        t.setHours(0, 0, 0, 0);
                        return d < t;
                      }}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-emerald-700" />
                  Horário
                </Label>
                <Select value={time} onValueChange={setTime}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecionar" />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    {TIME_SLOTS.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={submitSchedule}
                disabled={
                  schedule.isPending || !address.trim() || !date || !time
                }
              >
                {aso ? "Reagendar" : "Agendar ASO"}
              </Button>
              {aso && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditing(false)}
                >
                  Cancelar
                </Button>
              )}
            </div>
          </div>
        )}

        {aso && !editing && (
          <div className="space-y-2">
            <div className="text-xs space-y-0.5">
              <p>
                <span className="text-muted-foreground">Local:</span>{" "}
                {aso.address || "—"}
              </p>
              <p>
                <span className="text-muted-foreground">Data/hora:</span>{" "}
                {formatDateBR(aso.scheduled_date)} {(aso.scheduled_time || "").slice(0, 5)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {status !== "aprovado" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setAddress(aso.address || "");
                    setDate(aso.scheduled_date || "");
                    setTime((aso.scheduled_time || "").slice(0, 5));
                    setEditing(true);
                  }}
                >
                  Reagendar
                </Button>
              )}
              {aso.laudo_file_url && (
                <Button size="sm" variant="outline" onClick={handleDownload}>
                  <Download className="h-3 w-3 mr-1" /> Ver laudo
                </Button>
              )}
            </div>

            {(aso.status === "agendado" || aso.status === "reprovado") && (
              <>
                <Button
                  size="sm"
                  onClick={() => inputRef.current?.click()}
                  disabled={uploadLaudo.isPending}
                >
                  <Upload className="h-3 w-3 mr-1" />
                  {uploadLaudo.isPending
                    ? "Anexando..."
                    : aso.status === "reprovado"
                      ? "Anexar novo laudo"
                      : "Anexar laudo"}
                </Button>
                <NativeFileInput
                  ref={inputRef}
                  accept="image/*,.pdf"
                  onChange={handleAttachLaudo}
                />
              </>
            )}

            {aso.status === "agendado" && !aso.laudo_file_url && (
              <div className="rounded-md border border-dashed border-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20 p-2.5 text-xs text-emerald-900 dark:text-emerald-200">
                Aguardando anexo do laudo pela equipe de recrutamento.
              </div>
            )}


            {aso.status === "laudo_enviado" && (
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700"
                  disabled={approve.isPending}
                  onClick={() =>
                    approve.mutate({ asoId: aso.id, applicationId })
                  }
                >
                  <CheckCircle2 className="h-3 w-3 mr-1" /> Aprovar ASO
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setRejecting(true)}
                >
                  <XCircle className="h-3 w-3 mr-1" /> Reprovar
                </Button>
              </div>
            )}

            {rejecting && (
              <div className="flex gap-2">
                <Input
                  placeholder="Motivo da reprovação"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  autoFocus
                />
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={!rejectReason.trim() || reject.isPending}
                  onClick={() =>
                    reject.mutate(
                      {
                        asoId: aso.id,
                        applicationId,
                        reason: rejectReason.trim(),
                      },
                      {
                        onSuccess: () => {
                          setRejecting(false);
                          setRejectReason("");
                        },
                      },
                    )
                  }
                >
                  Confirmar
                </Button>
              </div>
            )}

            {aso.status === "reprovado" && aso.rejection_reason && (
              <p className="text-xs text-destructive">
                Motivo: {aso.rejection_reason}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
