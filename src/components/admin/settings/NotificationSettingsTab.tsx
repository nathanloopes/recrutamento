import { useState } from "react";
import { useGlobalSettings, useUpdateSetting } from "@/hooks/useGlobalSettings";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { MaskedDateInput } from "@/components/ui/masked-date-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Power, ShieldAlert, Clock, Zap } from "lucide-react";
import { DoubleConfirmDialog } from "@/components/admin/DoubleConfirmDialog";

export function NotificationSettingsTab() {
  const [killSwitchConfirmOpen, setKillSwitchConfirmOpen] = useState(false);
  const { data: settings, isLoading } = useGlobalSettings("notifications");
  const updateSetting = useUpdateSetting();

  const getValue = (key: string) => {
    const s = settings?.find((s) => s.key === key)?.value;
    return typeof s === "string" ? s : String(s ?? "");
  };
  const getBool = (key: string) => {
    const v = settings?.find((s) => s.key === key)?.value;
    return v === true || v === "true";
  };
  const getNum = (key: string, fallback: number) => {
    const v = settings?.find((s) => s.key === key)?.value;
    const n = Number(v);
    return isNaN(n) ? fallback : n;
  };

  if (isLoading) return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-6">
      {/* Kill Switch Global */}
      <Card className="border-2 border-primary/20">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2"><Power className="h-5 w-5" /> Controle Global</CardTitle>
          <CardDescription>Kill switch global do sistema de notificações</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-4 bg-muted/50">
            <div>
              <Label className="font-semibold">Notificações habilitadas (Kill Switch)</Label>
              <p className="text-xs text-muted-foreground">Desativar bloqueia TODOS os envios do sistema</p>
            </div>
            <Switch
              checked={getBool("notifications_enabled")}
              onCheckedChange={(v) => {
                if (!v) {
                  setKillSwitchConfirmOpen(true);
                } else {
                  updateSetting.mutate({ category: "notifications", key: "notifications_enabled", value: true });
                }
              }}
            />
          </div>
          <DoubleConfirmDialog
            open={killSwitchConfirmOpen}
            onOpenChange={setKillSwitchConfirmOpen}
            title="Desativar Notificações Globalmente"
            description="Esta ação bloqueará TODOS os envios do sistema (Push, WhatsApp e E-mail). Nenhuma notificação será disparada até reativar."
            onConfirm={() => updateSetting.mutate({ category: "notifications", key: "notifications_enabled", value: false })}
          />
        </CardContent>
      </Card>


      {/* Canais */}
      <Card className="border-2 border-primary/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Zap className="h-5 w-5" /> Canais de Notificação</CardTitle>
          <CardDescription>
            <strong>Fonte única de roteamento.</strong> O canal padrão sempre dispara. Os demais canais são adicionais e só enviam se estiverem habilitados aqui e tiverem template ativo para o evento.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Canal padrão</Label>
            <Select value={getValue("default_channel")} onValueChange={(v) => updateSetting.mutate({ category: "notifications", key: "default_channel", value: v })}>
              <SelectTrigger className="max-w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="push">Push</SelectItem>
                <SelectItem value="email">E-mail</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Todo evento é enviado por este canal automaticamente, sem depender de template nem do canal salvo no evento.</p>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <Label>Push adicional habilitado</Label>
              <p className="text-xs text-muted-foreground">Envio adicional quando houver template push do evento</p>
            </div>
            <Switch checked={getBool("enable_push")} onCheckedChange={(v) => updateSetting.mutate({ category: "notifications", key: "enable_push", value: v })} />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <Label>E-mail adicional habilitado</Label>
              <p className="text-xs text-muted-foreground">Envio adicional quando houver template e-mail do evento (requer provedor)</p>
            </div>
            <Switch checked={getBool("email_enabled")} onCheckedChange={(v) => updateSetting.mutate({ category: "notifications", key: "email_enabled", value: v })} />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <Label>WhatsApp adicional habilitado</Label>
              <p className="text-xs text-muted-foreground">Envio adicional quando houver template WhatsApp do evento (requer Z-API)</p>
            </div>
            <Switch checked={getBool("whatsapp_enabled")} onCheckedChange={(v) => updateSetting.mutate({ category: "notifications", key: "whatsapp_enabled", value: v })} />
          </div>
        </CardContent>
      </Card>


      {/* Rate Limiting */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5" /> Rate Limiting (Anti-Spam)</CardTitle>
          <CardDescription>Controle de frequência de envios por destinatário</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Máx. por hora</Label>
              <Input type="number" min={1} max={100} value={getNum("max_per_hour", 10)} onChange={(e) => updateSetting.mutate({ category: "notifications", key: "max_per_hour", value: parseInt(e.target.value) || 10 })} />
              <p className="text-xs text-muted-foreground">Por destinatário</p>
            </div>
            <div className="space-y-2">
              <Label>Máx. por dia</Label>
              <Input type="number" min={1} max={500} value={getNum("max_per_day", 30)} onChange={(e) => updateSetting.mutate({ category: "notifications", key: "max_per_day", value: parseInt(e.target.value) || 30 })} />
              <p className="text-xs text-muted-foreground">Por destinatário</p>
            </div>
            <div className="space-y-2">
              <Label>Cooldown (minutos)</Label>
              <Input type="number" min={0} max={60} value={getNum("cooldown_minutes", 5)} onChange={(e) => updateSetting.mutate({ category: "notifications", key: "cooldown_minutes", value: parseInt(e.target.value) || 5 })} />
              <p className="text-xs text-muted-foreground">Intervalo mínimo entre envios</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Horário de Silêncio */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Clock className="h-5 w-5" /> Horário de Silêncio</CardTitle>
          <CardDescription>Período em que notificações não são enviadas</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>Início</Label>
              <MaskedDateInput format="HH:mm" value={getValue("quiet_hours_start") ? new Date(`2000-01-01T${getValue("quiet_hours_start")}`) : null} onChange={(d) => updateSetting.mutate({ category: "notifications", key: "quiet_hours_start", value: d ? d.toTimeString().slice(0, 5) : "" })} placeholder="HH:mm" />
            </div>
            <div>
              <Label>Fim</Label>
              <MaskedDateInput format="HH:mm" value={getValue("quiet_hours_end") ? new Date(`2000-01-01T${getValue("quiet_hours_end")}`) : null} onChange={(d) => updateSetting.mutate({ category: "notifications", key: "quiet_hours_end", value: d ? d.toTimeString().slice(0, 5) : "" })} placeholder="HH:mm" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Configurações Avançadas */}
      <Card>
        <CardHeader>
          <CardTitle>Configurações Avançadas</CardTitle>
          <CardDescription>Controle de retry e fallback</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <Label>Reenvio automático em falha</Label>
              <p className="text-xs text-muted-foreground">Se habilitado, tenta reenviar automaticamente quando o envio falha</p>
            </div>
            <Switch checked={getBool("retry_on_failure")} onCheckedChange={(v) => updateSetting.mutate({ category: "notifications", key: "retry_on_failure", value: v })} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Tentativas de reenvio</Label>
              <Input type="number" min={1} max={10} value={getValue("retry_attempts")} onChange={(e) => updateSetting.mutate({ category: "notifications", key: "retry_attempts", value: parseInt(e.target.value) || 3 })} />
            </div>
            <div className="space-y-2">
              <Label>Intervalo entre tentativas (min)</Label>
              <Input type="number" min={1} max={60} value={getNum("retry_interval_minutes", 5)} onChange={(e) => updateSetting.mutate({ category: "notifications", key: "retry_interval_minutes", value: parseInt(e.target.value) || 5 })} />
              <p className="text-xs text-muted-foreground">Minutos entre cada tentativa de reenvio</p>
              <p className="text-xs text-muted-foreground">Minutos entre cada tentativa de reenvio. Consumido pela Edge Function retry-failed-notifications.</p>
            </div>
            <div className="space-y-2">
              <Label>Limite global diário</Label>
              <Input type="number" min={100} max={100000} value={getNum("global_daily_limit", 1000)} onChange={(e) => updateSetting.mutate({ category: "notifications", key: "global_daily_limit", value: parseInt(e.target.value) || 1000 })} />
              <p className="text-xs text-muted-foreground">Total de envios por dia (todo o sistema)</p>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <Label>Permitir reprocessamento manual</Label>
              <p className="text-xs text-muted-foreground">Habilita botão de reenvio nos logs de falha</p>
            </div>
            <Switch checked={getBool("allow_manual_reprocess")} onCheckedChange={(v) => updateSetting.mutate({ category: "notifications", key: "allow_manual_reprocess", value: v })} />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <Label>Exigir aprovação de templates</Label>
              <p className="text-xs text-muted-foreground">Templates precisam ser aprovados antes de ativar</p>
            </div>
            <Switch checked={getBool("require_template_approval")} onCheckedChange={(v) => updateSetting.mutate({ category: "notifications", key: "require_template_approval", value: v })} />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <Label>Revisão IA de templates</Label>
              <p className="text-xs text-muted-foreground">IA sugere melhorias de clareza ao editar templates</p>
            </div>
            <Switch checked={getBool("ai_template_review_enabled")} onCheckedChange={(v) => updateSetting.mutate({ category: "notifications", key: "ai_template_review_enabled", value: v })} />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <Label>Monitoramento de canais</Label>
              <p className="text-xs text-muted-foreground">Ativa aba de health check e latência dos canais de comunicação</p>
            </div>
            <Switch checked={getBool("channel_health_monitoring")} onCheckedChange={(v) => updateSetting.mutate({ category: "notifications", key: "channel_health_monitoring", value: v })} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
