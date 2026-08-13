import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useGlobalSettings } from "@/hooks/useGlobalSettings";
import { CalendarClock, CheckCircle2, XCircle, Clock, AlertTriangle } from "lucide-react";

function getVal(settings: any[] | undefined, key: string, fallback: any = null) {
  if (!settings) return fallback;
  const s = settings.find((s: any) => s.key === key);
  if (!s) return fallback;
  const v = s.value;
  if (typeof v === "string") {
    try { return JSON.parse(v); } catch { return v; }
  }
  return v;
}

interface SimSlot {
  time: string;
  available: boolean;
  reason?: string;
}

export function ScheduleSimulator() {
  const { data: calSettings } = useGlobalSettings("calendar");
  const [existingTimes, setExistingTimes] = useState("09:00, 10:30, 14:00");
  const [simulated, setSimulated] = useState<SimSlot[] | null>(null);

  const bufferMinutes = Number(getVal(calSettings, "interview_buffer_minutes", 15));
  const minGap = Number(getVal(calSettings, "min_gap_between_interviews", 30));
  const duration = Number(getVal(calSettings, "default_interview_duration", 30));
  const maxPerDay = Number(getVal(calSettings, "max_interviews_per_day", 10));
  const enforceBuffer = getVal(calSettings, "enforce_buffer", true) !== false;
  const enforceDailyLimit = getVal(calSettings, "enforce_daily_limit", true) !== false;
  const effectiveExclusion = Math.max(bufferMinutes, minGap);

  const timeToMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + (m || 0);
  };

  const simulate = () => {
    const booked = existingTimes
      .split(",")
      .map((t) => t.trim())
      .filter((t) => /^\d{2}:\d{2}$/.test(t));

    const bookedMinutes = booked.map(timeToMin);

    // Generate all 30-min slots from 08:00 to 18:00
    const allSlots: SimSlot[] = [];
    for (let min = 8 * 60; min <= 18 * 60; min += 30) {
      const h = Math.floor(min / 60);
      const m = min % 60;
      const time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

      // Check daily limit
      if (enforceDailyLimit && booked.length >= maxPerDay) {
        allSlots.push({ time, available: false, reason: `Limite diário atingido (${maxPerDay})` });
        continue;
      }

      // Check exact conflict
      if (booked.includes(time)) {
        allSlots.push({ time, available: false, reason: "Horário já ocupado" });
        continue;
      }

      // Check buffer/gap conflict
      let blocked = false;
      let blockReason = "";
      if (enforceBuffer) {
        for (const bm of bookedMinutes) {
          const windowStart = bm - effectiveExclusion;
          const windowEnd = bm + duration + effectiveExclusion;
          if (min >= windowStart && min < windowEnd) {
            blocked = true;
            blockReason = `Conflito com buffer/gap (${effectiveExclusion}min)`;
            break;
          }
        }
      }

      allSlots.push({ time, available: !blocked, reason: blocked ? blockReason : undefined });
    }

    setSimulated(allSlots);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5" />
          Simulador de Agenda
        </CardTitle>
        <CardDescription>
          Simule como ficaria a agenda de um dia com as regras atuais de buffer, gap e limite diário.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-muted bg-muted/30 p-3 space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Regras ativas:</p>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="text-xs">Buffer: {bufferMinutes}min</Badge>
            <Badge variant="outline" className="text-xs">Gap mínimo: {minGap}min</Badge>
            <Badge variant="outline" className="text-xs">Exclusão efetiva: {effectiveExclusion}min</Badge>
            <Badge variant="outline" className="text-xs">Duração: {duration}min</Badge>
            <Badge variant="outline" className="text-xs">Limite/dia: {maxPerDay}</Badge>
            <Badge variant={enforceBuffer ? "default" : "secondary"} className="text-xs">
              Buffer: {enforceBuffer ? "Ativo" : "Inativo"}
            </Badge>
            <Badge variant={enforceDailyLimit ? "default" : "secondary"} className="text-xs">
              Limite diário: {enforceDailyLimit ? "Ativo" : "Inativo"}
            </Badge>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Entrevistas já agendadas (HH:MM, separadas por vírgula)</Label>
          <Input
            value={existingTimes}
            onChange={(e) => setExistingTimes(e.target.value)}
            placeholder="09:00, 10:30, 14:00"
          />
        </div>

        <Button onClick={simulate} className="w-full">
          <CalendarClock className="h-4 w-4 mr-2" />
          Simular Disponibilidade
        </Button>

        {simulated && (
          <div className="space-y-2">
            <p className="text-sm font-medium">
              Resultado: {simulated.filter((s) => s.available).length} horários disponíveis de {simulated.length}
            </p>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-[300px] overflow-y-auto">
              {simulated.map((slot) => (
                <div
                  key={slot.time}
                  className={`flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs ${
                    slot.available
                      ? "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400"
                      : "border-destructive/30 bg-destructive/10 text-destructive"
                  }`}
                  title={slot.reason || "Disponível"}
                >
                  {slot.available ? (
                    <CheckCircle2 className="h-3 w-3 shrink-0" />
                  ) : (
                    <XCircle className="h-3 w-3 shrink-0" />
                  )}
                  <span className="font-mono">{slot.time}</span>
                </div>
              ))}
            </div>
            {simulated.some((s) => !s.available && s.reason) && (
              <div className="space-y-1 pt-2 border-t">
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> Motivos de bloqueio:
                </p>
                {[...new Set(simulated.filter((s) => !s.available).map((s) => s.reason))].map((reason) => (
                  <p key={reason} className="text-xs text-muted-foreground">• {reason}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
