import { useGlobalSettings, useUpdateSetting } from "@/hooks/useGlobalSettings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Loader2, Mic, Save } from "lucide-react";
import { useState, useEffect } from "react";

const VOICE_KEYS = [
  { key: "min_voice_score", label: "Score mínimo de voz", type: "number", default: 60, description: "Pontuação mínima para aprovação na etapa de voz" },
  { key: "max_voice_retries", label: "Máximo de tentativas", type: "number", default: 2, description: "Quantas vezes o candidato pode regravar" },
  { key: "allow_repeat_voice", label: "Permitir repetição", type: "boolean", default: true, description: "Candidato pode ouvir e regravar sua resposta" },
  { key: "max_response_time", label: "Tempo máximo (segundos)", type: "number", default: 120, description: "Duração máxima de cada resposta de voz" },
  { key: "voice_weight", label: "Peso da voz no score (%)", type: "number", default: 25, description: "Peso da etapa de voz no score final do candidato" },
  { key: "allow_human_escalation", label: "Escalar para humano", type: "boolean", default: true, description: "Permitir encaminhamento para avaliação humana se score ambíguo" },
];

export function VoiceSettingsTab() {
  const { data: settings, isLoading } = useGlobalSettings("voice");
  const updateSetting = useUpdateSetting();
  const [values, setValues] = useState<Record<string, any>>({});

  useEffect(() => {
    if (settings) {
      const v: Record<string, any> = {};
      settings.forEach((s) => { v[s.key] = s.value; });
      setValues(v);
    }
  }, [settings]);

  const getValue = (key: string, defaultVal: any) => values[key] ?? defaultVal;

  const save = (key: string, value: any) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    updateSetting.mutate({ category: "voice", key, value });
  };

  if (isLoading) return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mic className="h-5 w-5 text-primary" />
            Configurações de Entrevista por Voz
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {VOICE_KEYS.map((vk) => (
            <div key={vk.key} className="flex items-center justify-between gap-4 py-2 border-b last:border-b-0">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">{vk.label}</Label>
                <p className="text-xs text-muted-foreground">{vk.description}</p>
              </div>
              {vk.type === "boolean" ? (
                <Switch
                  checked={!!getValue(vk.key, vk.default)}
                  onCheckedChange={(checked) => save(vk.key, checked)}
                />
              ) : (
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    className="w-24"
                    value={getValue(vk.key, vk.default)}
                    onChange={(e) => setValues((prev) => ({ ...prev, [vk.key]: Number(e.target.value) }))}
                  />
                  <Button size="sm" variant="outline" onClick={() => save(vk.key, getValue(vk.key, vk.default))} disabled={updateSetting.isPending}>
                    <Save className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
