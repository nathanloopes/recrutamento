import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Save, Activity, RefreshCw } from "lucide-react";
import { useGlobalSettings, useUpdateSetting } from "@/hooks/useGlobalSettings";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { humanizeError } from "@/lib/userMessages";

const PARAMS = [
  { key: "default_ai_provider", label: "Provider IA Padrão", type: "text", placeholder: "openai" },
  { key: "allow_multi_providers", label: "Permitir Múltiplos Providers", type: "boolean" },
  { key: "auto_fallback_enabled", label: "Fallback Automático", type: "boolean" },
  { key: "health_check_interval_min", label: "Intervalo Health Check (min)", type: "number", placeholder: "60" },
  { key: "allow_storage_external", label: "Permitir Storage Externo", type: "boolean" },
];

export function IntegrationsSettingsTab() {
  const { data: settings, isLoading } = useGlobalSettings("integrations");
  const updateSetting = useUpdateSetting();
  const [values, setValues] = useState<Record<string, any>>({});
  const [healthCheckRunning, setHealthCheckRunning] = useState(false);
  const [lastHealthResult, setLastHealthResult] = useState<any>(null);

  useEffect(() => {
    if (settings) {
      const v: Record<string, any> = {};
      settings.forEach((s) => {
        const param = PARAMS.find((p) => p.key === s.key);
        if (param) v[s.key] = s.value;
      });
      setValues(v);
    }
  }, [settings]);

  if (isLoading) {
    return <div className="space-y-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>;
  }

  const handleSave = (key: string) => {
    updateSetting.mutate({ category: "integrations", key, value: values[key] });
  };

  const handleRunHealthCheck = async () => {
    setHealthCheckRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("integration-health-check", {
        body: {},
      });
      if (error) throw error;
      setLastHealthResult(data);
      const healthy = (data.results || []).filter((r: any) => r.status === "healthy").length;
      const total = (data.results || []).length;
      toast.success(`Health check concluído: ${healthy}/${total} integrações saudáveis`);
    } catch (err: any) {
      toast.error(humanizeError(err, "integration-health-check"));
    } finally {
      setHealthCheckRunning(false);
    }
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case "healthy": return <Badge className="bg-green-600 text-xs">Saudável</Badge>;
      case "degraded": return <Badge className="bg-yellow-600 text-xs">Degradado</Badge>;
      case "unhealthy": return <Badge variant="destructive" className="text-xs">Indisponível</Badge>;
      case "disabled": return <Badge variant="secondary" className="text-xs">Desabilitado</Badge>;
      default: return <Badge variant="outline" className="text-xs">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Configurações de Integrações</CardTitle>
          <p className="text-sm text-muted-foreground">
            Parâmetros globais que controlam o comportamento das integrações externas.
            Alterações são aplicadas imediatamente pelo motor de integrações.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {PARAMS.map((param) => {
            const val = values[param.key];
            return (
              <div key={param.key} className="space-y-1">
                <div className="flex items-center justify-between gap-4">
                  <Label className="min-w-[200px]">{param.label}</Label>
                  {param.type === "boolean" ? (
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={val === true || val === "true"}
                        onCheckedChange={(checked) => {
                          setValues((p) => ({ ...p, [param.key]: checked }));
                          updateSetting.mutate({ category: "integrations", key: param.key, value: checked });
                        }}
                      />
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Input
                        type={param.type === "number" ? "number" : "text"}
                        value={String(val ?? "")}
                        onChange={(e) => setValues((p) => ({ ...p, [param.key]: param.type === "number" ? Number(e.target.value) : e.target.value }))}
                        placeholder={param.placeholder}
                        className="w-48"
                      />
                      <Button size="sm" variant="outline" onClick={() => handleSave(param.key)} disabled={updateSetting.isPending}>
                        {updateSetting.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-3">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-lg flex items-center gap-2">
              <Activity className="h-5 w-5 shrink-0" />
              Health Check de Integrações
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Executa verificação de saúde em todas as integrações ativas, aplicando as regras de provider, fallback e storage.
            </p>
          </div>
          <Button
            variant="outline"
            className="shrink-0"
            onClick={handleRunHealthCheck}
            disabled={healthCheckRunning}
          >
            {healthCheckRunning ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Executar Health Check
          </Button>
        </CardHeader>
        {lastHealthResult && (
          <CardContent>
            <div className="space-y-2">
              <div className="flex gap-4 text-sm text-muted-foreground">
                <span>Provider padrão: <strong>{lastHealthResult.default_provider}</strong></span>
                <span>Multi-provider: <strong>{lastHealthResult.allow_multi_providers ? "Sim" : "Não"}</strong></span>
                <span>Fallback: <strong>{lastHealthResult.auto_fallback_enabled ? "Ativo" : "Inativo"}</strong></span>
              </div>
              {lastHealthResult.results?.length > 0 ? (
                <div className="space-y-2 mt-3">
                  {lastHealthResult.results.map((r: any) => (
                    <div key={r.id} className="flex items-center justify-between border rounded-md p-3">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium">{r.provider}</span>
                        <Badge variant="outline" className="text-xs">{r.type}</Badge>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">{r.latency_ms}ms</span>
                        {statusBadge(r.status)}
                        {r.error && <span className="text-xs text-destructive">{r.error}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhuma integração ativa encontrada.</p>
              )}
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
