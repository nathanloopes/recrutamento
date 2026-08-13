import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, PlayCircle, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { EVENT_TYPE_LABELS } from "@/lib/notificationLabels";

interface SimulationResult {
  simulation: boolean;
  would_send: boolean;
  channels: string[];
  checks_passed: {
    kill_switch: boolean;
    quiet_hours: boolean;
    rate_limit_hour: { current: number; limit: number };
    rate_limit_day: { current: number; limit: number };
    cooldown: boolean;
    global_daily: { current: number; limit: number };
    global_hourly: { current: number; limit: number };
  };
  event_routing: string;
  fallback_enabled: boolean;
}

interface BlockedResult {
  delivered: false;
  blocked: string;
  reason: string;
}

export function NotificationSimulator() {
  const [loading, setLoading] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState("");
  const [result, setResult] = useState<SimulationResult | BlockedResult | null>(null);

  const handleSimulate = async () => {
    if (!selectedEvent) {
      toast.error("Selecione um tipo de evento");
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      // Create a temporary notification to simulate
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) {
        toast.error("Usuário não autenticado");
        return;
      }

      // Insert a temporary notification
      const { data: tempNotif, error: insertErr } = await supabase
        .from("notifications")
        .insert({
          event_type: selectedEvent,
          recipient_id: user.user.id,
          channel: "push",
          title: "[SIMULAÇÃO] Teste",
          body: "Esta é uma simulação de disparo para verificar regras do motor.",
          status: "pending",
          payload: { simulation: true },
        })
        .select("id")
        .single();

      if (insertErr || !tempNotif) throw insertErr || new Error("Failed to create temp notification");

      // Call cascade with simulate=true
      const { data, error } = await supabase.functions.invoke("send-notification-cascade", {
        body: { notification_id: tempNotif.id, simulate: true },
      });

      if (error) throw error;

      setResult(data as SimulationResult | BlockedResult);

      // Clean up temp notification
      await supabase.from("notifications").delete().eq("id", tempNotif.id);
    } catch (e: any) {
      toast.error("Erro na simulação: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const isBlocked = result && "blocked" in result;
  const isSimulation = result && "simulation" in result;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PlayCircle className="h-5 w-5" />
          Simulador de Disparo
        </CardTitle>
        <CardDescription>
          Simula o envio sem disparar de verdade. Verifica kill switch, quiet hours, rate limits e canal por evento.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <Select value={selectedEvent} onValueChange={setSelectedEvent}>
              <SelectTrigger><SelectValue placeholder="Selecione o tipo de evento" /></SelectTrigger>
              <SelectContent>
                {Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleSimulate} disabled={loading || !selectedEvent}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <PlayCircle className="h-4 w-4 mr-1" />}
            Simular
          </Button>
        </div>

        {isBlocked && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 space-y-2">
            <div className="flex items-center gap-2 text-destructive font-semibold">
              <XCircle className="h-5 w-5" />
              Envio BLOQUEADO
            </div>
            <p className="text-sm"><strong>Motivo:</strong> {(result as BlockedResult).blocked}</p>
            <p className="text-sm text-muted-foreground">{(result as BlockedResult).reason}</p>
          </div>
        )}

        {isSimulation && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
            <div className="flex items-center gap-2 text-primary font-semibold">
              <CheckCircle2 className="h-5 w-5" />
              Envio seria PERMITIDO
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="font-medium">Canais</p>
                <div className="flex gap-1 mt-1">
                  {(result as SimulationResult).channels.map((ch) => (
                    <Badge key={ch} variant="outline">{ch}</Badge>
                  ))}
                </div>
              </div>
              <div>
                <p className="font-medium">Roteamento</p>
                <Badge variant="secondary">
                  {(result as SimulationResult).event_routing === "per_event" ? "Por Evento" : "Cascata Global"}
                </Badge>
              </div>
            </div>

            <div className="space-y-1 text-sm">
              <p className="font-medium">Verificações</p>
              {(() => {
                const checks = (result as SimulationResult).checks_passed;
                return (
                  <div className="grid grid-cols-2 gap-1">
                    <CheckItem label="Kill Switch" ok={checks.kill_switch} />
                    <CheckItem label="Quiet Hours" ok={checks.quiet_hours} />
                    <CheckItem label="Cooldown" ok={checks.cooldown} />
                    <CheckItem
                      label={`Rate/hora: ${checks.rate_limit_hour.current}/${checks.rate_limit_hour.limit}`}
                      ok={checks.rate_limit_hour.current < checks.rate_limit_hour.limit}
                    />
                    <CheckItem
                      label={`Rate/dia: ${checks.rate_limit_day.current}/${checks.rate_limit_day.limit}`}
                      ok={checks.rate_limit_day.current < checks.rate_limit_day.limit}
                    />
                    <CheckItem
                      label={`Global/dia: ${checks.global_daily.current}/${checks.global_daily.limit}`}
                      ok={checks.global_daily.current < checks.global_daily.limit}
                    />
                    <CheckItem
                      label={`Global/hora: ${checks.global_hourly.current}/${checks.global_hourly.limit}`}
                      ok={checks.global_hourly.current < checks.global_hourly.limit}
                    />
                    <CheckItem
                      label="Fallback"
                      ok={(result as SimulationResult).fallback_enabled}
                    />
                  </div>
                );
              })()}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CheckItem({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-1">
      {ok ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
      ) : (
        <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
      )}
      <span className={ok ? "" : "text-destructive"}>{label}</span>
    </div>
  );
}
