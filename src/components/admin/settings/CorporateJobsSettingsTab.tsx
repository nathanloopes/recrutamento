import { useGlobalSettings, useUpdateSetting } from "@/hooks/useGlobalSettings";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Briefcase } from "lucide-react";

export function CorporateJobsSettingsTab() {
  const { data: settings, isLoading } = useGlobalSettings("corporate_jobs");
  const updateSetting = useUpdateSetting();

  const getSetting = (key: string): any => {
    const s = settings?.find((s) => s.key === key);
    return s?.value;
  };

  const handleUpdate = (key: string, value: any, reason?: string) => {
    updateSetting.mutate({ category: "corporate_jobs", key, value, reason });
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  const autoPublish = getSetting("corporate_job_auto_publish") ?? true;
  const autoCloseDays = getSetting("corporate_auto_close_days") ?? 90;
  const allowSalaryHidden = getSetting("allow_salary_hidden") ?? false;
  const notificationChannels: string[] = getSetting("corporate_notification_channels") ?? ["push", "email"];
  const kanbanEnabled = getSetting("corporate_kanban_enabled") ?? false;

  const CHANNELS = [
    { value: "push", label: "Push" },
    { value: "email", label: "E-mail" },
    { value: "whatsapp", label: "WhatsApp" },
  ];

  const toggleChannel = (ch: string) => {
    const next = notificationChannels.includes(ch)
      ? notificationChannels.filter((c: string) => c !== ch)
      : [...notificationChannels, ch];
    handleUpdate("corporate_notification_channels", next);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Briefcase className="h-4 w-4" /> Publicação e Ciclo de Vida
          </CardTitle>
          <CardDescription>Regras de publicação automática e encerramento.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Publicação automática ao criar vaga</Label>
            <Switch
              checked={autoPublish}
              onCheckedChange={(v) => handleUpdate("corporate_job_auto_publish", v)}
            />
          </div>

          <div className="space-y-2">
            <Label>Encerramento automático após (dias)</Label>
            <p className="text-xs text-amber-600 dark:text-amber-400">⚠️ Informativo: Requer Edge Function cron para execução automática. Atualmente serve como referência operacional.</p>
            <div className="flex items-center gap-4">
              <Slider
                value={[autoCloseDays]}
                min={7}
                max={365}
                step={1}
                onValueCommit={(v) => handleUpdate("corporate_auto_close_days", v[0])}
                className="flex-1"
              />
              <Input
                type="number"
                min={7}
                max={365}
                value={autoCloseDays}
                onChange={() => {}}
                onBlur={(e) => {
                  const v = Number(e.target.value) || 90;
                  if (v >= 7 && v <= 365) handleUpdate("corporate_auto_close_days", v);
                }}
                className="w-20"
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <Label>Permitir ocultar salário na publicação</Label>
            <Switch
              checked={allowSalaryHidden}
              onCheckedChange={(v) => handleUpdate("allow_salary_hidden", v)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Canais de Notificação Padrão</CardTitle>
          <CardDescription>Canais utilizados nas notificações de eventos de vagas corporativas.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            {CHANNELS.map((ch) => (
              <label key={ch.value} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={notificationChannels.includes(ch.value)}
                  onCheckedChange={() => toggleChannel(ch.value)}
                />
                {ch.label}
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Visualização Kanban</CardTitle>
          <CardDescription>Habilita a interface Kanban para arrastar candidatos entre fases.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <Label>Kanban habilitado</Label>
            <Switch
              checked={kanbanEnabled}
              onCheckedChange={(v) => handleUpdate("corporate_kanban_enabled", v)}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
