import { useGlobalSettings, useUpdateSetting } from "@/hooks/useGlobalSettings";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { DoubleConfirmDialog } from "@/components/admin/DoubleConfirmDialog";

export function CalendarSettingsTab() {
  const { data: settings, isLoading } = useGlobalSettings("calendar");
  const { data: agendamentoSettings, isLoading: agendLoading } = useGlobalSettings("agendamento");
  const { data: auditSettings, isLoading: auditLoading } = useGlobalSettings("interview_audit");
  const updateSetting = useUpdateSetting();
  const [vals, setVals] = useState<Record<string, string>>({});
  const [showKillSwitchConfirm, setShowKillSwitchConfirm] = useState(false);

  useEffect(() => {
    if (settings || agendamentoSettings || auditSettings) {
      const v: Record<string, string> = {};
      settings?.forEach((s) => (v[s.key] = typeof s.value === "string" ? s.value : JSON.stringify(s.value)));
      agendamentoSettings?.forEach((s) => (v[s.key + "_val"] = typeof s.value === "string" ? s.value : JSON.stringify(s.value)));
      auditSettings?.forEach((s) => (v[s.key + "_audit"] = typeof s.value === "string" ? s.value : JSON.stringify(s.value)));
      setVals(v);
    }
  }, [settings, agendamentoSettings, auditSettings]);

  const save = (key: string) => {
    const v = vals[key];
    const num = Number(v);
    updateSetting.mutate({ category: "calendar", key, value: isNaN(num) ? v : num });
  };

  const saveBool = (key: string, val: boolean) => {
    updateSetting.mutate({ category: "calendar", key, value: val });
  };

  if (isLoading || agendLoading || auditLoading) return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  const parseBool = (key: string, fallback = true) => {
    const v = vals[key]?.replace(/"/g, "");
    if (v === "true") return true;
    if (v === "false") return false;
    return fallback;
  };

  return (
    <div className="space-y-6">
      {/* Kill Switch & CrossConfig */}
      <Card>
        <CardHeader>
          <CardTitle>Controles Globais</CardTitle>
          <CardDescription>Kill switches e configurações de governança do módulo de agenda.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
            { key: "scheduling_enabled", label: "Agendamento habilitado (Kill Switch)", desc: "Desativar bloqueia todos os novos agendamentos.", critical: true },
            { key: "enforce_buffer", label: "Aplicar buffer obrigatório", desc: "Força intervalo mínimo entre entrevistas.", critical: false },
            { key: "enforce_daily_limit", label: "Aplicar limite diário", desc: "Bloqueia horários após atingir o máximo por dia.", critical: false },
            { key: "no_show_tracking_enabled", label: "Monitoramento de no-show", desc: "Ativa bloqueio automático para candidatos ausentes.", critical: false },
          ].map((f) => (
            <div key={f.key} className="flex items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label className="text-base">{f.label}</Label>
                <p className="text-sm text-muted-foreground">{f.desc}</p>
              </div>
              <Switch
                checked={parseBool(f.key)}
                onCheckedChange={(v) => {
                  if (f.critical && !v) {
                    setShowKillSwitchConfirm(true);
                  } else {
                    saveBool(f.key, v);
                  }
                }}
              />
            </div>
          ))}

          <div className="space-y-1 pt-2">
            <Label>Fuso horário padrão</Label>
            <Select value={vals["timezone_default"]?.replace(/"/g, "") ?? "America/Sao_Paulo"} onValueChange={(v) => updateSetting.mutate({ category: "calendar", key: "timezone_default", value: v })}>
              <SelectTrigger className="w-full sm:max-w-[300px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="America/Sao_Paulo">América/São Paulo (BRT)</SelectItem>
                <SelectItem value="America/Manaus">América/Manaus (AMT)</SelectItem>
                <SelectItem value="America/Belem">América/Belém (BRT)</SelectItem>
                <SelectItem value="America/Cuiaba">América/Cuiabá (AMT)</SelectItem>
                <SelectItem value="America/Fortaleza">América/Fortaleza (BRT)</SelectItem>
                <SelectItem value="America/Recife">América/Recife (BRT)</SelectItem>
                <SelectItem value="America/Rio_Branco">América/Rio Branco (ACT)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Parâmetros de Agenda */}
      <Card>
        <CardHeader>
          <CardTitle>Parâmetros de Agendamento</CardTitle>
          <CardDescription>Regras de agendamento de entrevistas e comportamento do sistema.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-end gap-3 sm:gap-4">
            <div className="flex-1 w-full space-y-1">
              <Label>Tempo mínimo para remarcar (horas)</Label>
              <p className="text-xs text-muted-foreground">
                Contado a partir do momento em que a entrevista é confirmada (manual ou automaticamente). O candidato só poderá remarcar após esse intervalo; a cada nova confirmação, o tempo é reiniciado.
              </p>
              <Input
                type="number"
                min={0}
                value={vals["reschedule_min_hours"] ?? ""}
                onChange={(e) => setVals((p) => ({ ...p, reschedule_min_hours: e.target.value }))}
              />
            </div>
            <Button size="sm" onClick={() => save("reschedule_min_hours")}>Salvar</Button>
          </div>

          {[
            { key: "interview_buffer_minutes", label: "Buffer entre entrevistas (minutos)" },
            { key: "min_gap_between_interviews", label: "Intervalo mínimo entre entrevistas (minutos)" },
            { key: "max_interviews_per_day", label: "Limite de entrevistas por dia" },
            { key: "default_interview_duration", label: "Duração padrão da entrevista (minutos)" },
          ].map((f) => (
            <div key={f.key} className="flex flex-col sm:flex-row items-start sm:items-end gap-3 sm:gap-4">
              <div className="flex-1 w-full space-y-1">
                <Label>{f.label}</Label>
                <Input type="number" value={vals[f.key] ?? ""} onChange={(e) => setVals((p) => ({ ...p, [f.key]: e.target.value }))} />
              </div>
              <Button size="sm" onClick={() => save(f.key)}>Salvar</Button>
            </div>
          ))}

          <div className="flex flex-col sm:flex-row items-start sm:items-end gap-3 sm:gap-4">
            <div className="flex-1 w-full space-y-1">
              <Label>Número máximo de reagendamentos por entrevista</Label>
              <p className="text-xs text-muted-foreground">
                Quantas vezes o candidato pode reagendar a mesma entrevista antes do sistema bloquear novas remarcações. Recomendado: 3.
              </p>
              <Input
                type="number"
                min={0}
                max={20}
                value={vals["max_reschedule_allowed_audit"]?.replace(/"/g, "") ?? "3"}
                onChange={(e) => setVals((p) => ({ ...p, max_reschedule_allowed_audit: e.target.value }))}
              />
            </div>
            <Button
              size="sm"
              onClick={() => {
                const n = Number(vals["max_reschedule_allowed_audit"]);
                updateSetting.mutate({
                  category: "interview_audit",
                  key: "max_reschedule_allowed",
                  value: isNaN(n) || n < 0 ? 3 : n,
                });
              }}
            >
              Salvar
            </Button>
          </div>

          <div className="space-y-1">
            <Label>Política de no-show</Label>
            <Select value={vals["no_show_policy"]?.replace(/"/g, "") ?? "block_24h"} onValueChange={(v) => updateSetting.mutate({ category: "calendar", key: "no_show_policy", value: v })}>
              <SelectTrigger className="w-full sm:max-w-[300px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="block_24h">Bloquear por 24h</SelectItem>
                <SelectItem value="block_48h">Bloquear por 48h</SelectItem>
                <SelectItem value="block_7d">Bloquear por 7 dias</SelectItem>
                <SelectItem value="warning_only">Apenas aviso (sem bloqueio)</SelectItem>
                <SelectItem value="auto_reject">Rejeição automática</SelectItem>
                <SelectItem value="manual_review_required">Revisão manual obrigatória</SelectItem>
                <SelectItem value="none">Sem bloqueio</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-4 pt-4 border-t">
            <h4 className="font-medium text-foreground">Opções</h4>
            {[
              { key: "allow_reschedule", label: "Permitir remarcação pelo candidato" },
              { key: "allow_online_interviews", label: "Permitir entrevistas online" },
            ].map((f) => (
              <div key={f.key} className="flex items-center justify-between">
                <Label>{f.label}</Label>
                <Switch checked={parseBool(f.key)} onCheckedChange={(v) => saveBool(f.key, v)} />
              </div>
            ))}
          </div>

          <div className="space-y-3 pt-4 border-t">
            <h4 className="font-medium text-foreground">Lembretes de Entrevista</h4>
            <p className="text-sm text-muted-foreground">Horários antes da entrevista em que lembretes serão enviados automaticamente.</p>
            <Input
              placeholder="24, 2"
              defaultValue={(() => {
                const v = vals["reminder_hours_before"]?.replace(/"/g, "");
                try { return JSON.parse(v || "[]").join(", "); } catch { return "24, 2"; }
              })()}
              onBlur={(e) => {
                const hours = e.target.value.split(",").map(h => Number(h.trim())).filter(h => !isNaN(h) && h > 0);
                updateSetting.mutate({ category: "calendar", key: "reminder_hours_before", value: hours });
              }}
            />
            <p className="text-xs text-muted-foreground">Horas antes da entrevista, separadas por vírgula (ex: 24, 2)</p>
          </div>

          <div className="space-y-4 pt-4 border-t">
            <h4 className="font-medium text-foreground">Fluxo de Aprovação</h4>
            <p className="text-sm text-muted-foreground">Controle de aprovação quando o candidato faz autoagendamento.</p>

            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label className="text-base">Exigir aprovação do admin</Label>
                <p className="text-sm text-muted-foreground">Quando ativo, agendamentos feitos pelo candidato ficam pendentes até aprovação do administrador.</p>
              </div>
              <Switch
                checked={parseBool("require_interview_approval_val")}
                onCheckedChange={(v) => updateSetting.mutate({ category: "agendamento", key: "require_interview_approval", value: v })}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label className="text-base">Reabrir agendamento ao não aprovar</Label>
                <p className="text-sm text-muted-foreground">Quando não aprovado, permite automaticamente que o candidato escolha um novo horário.</p>
              </div>
              <Switch
                checked={parseBool("auto_reschedule_on_reject_val")}
                onCheckedChange={(v) => updateSetting.mutate({ category: "agendamento", key: "auto_reschedule_on_reject", value: v })}
              />
            </div>

            <div className="flex flex-col sm:flex-row items-start sm:items-end gap-3 sm:gap-4">
              <div className="flex-1 w-full space-y-1">
                <Label>Timeout para aprovação automática (horas)</Label>
                <p className="text-xs text-muted-foreground">0 = sem timeout (aprovação manual obrigatória)</p>
                <Input type="number" value={vals["approval_timeout_hours_val"] ?? "12"} onChange={(e) => setVals((p) => ({ ...p, approval_timeout_hours_val: e.target.value }))} />
              </div>
              <Button size="sm" onClick={() => updateSetting.mutate({ category: "agendamento", key: "approval_timeout_hours", value: Number(vals["approval_timeout_hours_val"] ?? 12) })}>Salvar</Button>
            </div>
          </div>

          <div className="pt-4 border-t space-y-4">
            <h4 className="font-medium text-foreground">Integração Google Calendar</h4>
            <p className="text-sm text-muted-foreground">Sincronização bidirecional com Google Calendar para criar eventos de entrevista automaticamente.</p>

            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label className="text-base">Habilitar sincronização</Label>
                <p className="text-sm text-muted-foreground">Quando ativo, entrevistas agendadas criam eventos no Google Calendar automaticamente.</p>
              </div>
              <Switch
                checked={parseBool("calendar_sync_enabled", false)}
                onCheckedChange={(v) => saveBool("calendar_sync_enabled", v)}
              />
            </div>

            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
              <p className="text-sm font-medium text-amber-700 dark:text-amber-400">⚙️ Configuração necessária</p>
              <p className="text-xs text-muted-foreground mt-1">
                Para ativar a sincronização, configure os seguintes secrets nas Edge Functions do Supabase:
              </p>
              <ul className="text-xs text-muted-foreground mt-2 space-y-1 list-disc list-inside">
                <li><code className="font-mono bg-muted px-1 rounded">GOOGLE_CALENDAR_CLIENT_ID</code></li>
                <li><code className="font-mono bg-muted px-1 rounded">GOOGLE_CALENDAR_CLIENT_SECRET</code></li>
                <li><code className="font-mono bg-muted px-1 rounded">GOOGLE_CALENDAR_REFRESH_TOKEN</code></li>
              </ul>
            </div>
          </div>

          <div className="pt-4 border-t space-y-2">
            <h4 className="font-medium text-foreground">Prompts IA (Roadmap)</h4>
            <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-4 space-y-2">
              <p className="text-sm text-muted-foreground">
                <strong>🔮 Sugestão IA de melhor horário:</strong> Em desenvolvimento. O sistema sugerirá automaticamente o melhor horário com base no histórico do candidato e da unidade.
              </p>
              <p className="text-sm text-muted-foreground">
                <strong>📊 Análise de padrão de no-show:</strong> Em desenvolvimento. Um relatório semanal analisará padrões de ausências para detectar tendências e prevenir recorrências.
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
            <p className="text-xs text-muted-foreground">
              <strong>ℹ️ Fuso horário:</strong> O fuso horário configurado ({vals["timezone_default"]?.replace(/"/g, "") || "America/Sao_Paulo"}) é exibido como referência para administradores. Os cálculos de slot utilizam a hora local do servidor.
            </p>
          </div>
        </CardContent>
      </Card>

      <DoubleConfirmDialog
        open={showKillSwitchConfirm}
        onOpenChange={setShowKillSwitchConfirm}
        title="Desativar agendamentos?"
        description="Ao desativar, TODOS os novos agendamentos serão bloqueados em todo o sistema. Entrevistas já marcadas não serão canceladas, mas nenhuma nova poderá ser criada."
        onConfirm={() => saveBool("scheduling_enabled", false)}
      />
    </div>
  );
}
