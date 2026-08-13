import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useIntegrationSettings, useUpdateIntegrationConfig, useTestIntegration } from "@/hooks/useIntegrations";
import { IntegrationCard } from "@/components/admin/integrations/IntegrationCard";
import { IntegrationConfigDialog } from "@/components/admin/integrations/IntegrationConfigDialog";
import { IntegrationLogsPanel } from "@/components/admin/integrations/IntegrationLogsPanel";
import { IntegrationTestPanel } from "@/components/admin/integrations/IntegrationTestPanel";
import { DoubleConfirmDialog } from "@/components/admin/DoubleConfirmDialog";
import type { IntegrationSetting } from "@/hooks/useIntegrations";
import { PageHelp } from "@/components/ui/page-help";

export default function IntegrationTests() {
  const { data: integrations, isLoading } = useIntegrationSettings();
  const updateConfig = useUpdateIntegrationConfig();
  const testIntegration = useTestIntegration();

  const [configDialog, setConfigDialog] = useState<IntegrationSetting | null>(null);
  const [logsDialog, setLogsDialog] = useState<{ id: string; provider: string } | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [pendingSave, setPendingSave] = useState<{ id: string; config: Record<string, any> } | null>(null);

  const handleTest = async (integration: IntegrationSetting) => {
    setTestingId(integration.id);
    try {
      const data = await testIntegration.mutateAsync({
        provider: integration.provider,
        integrationId: integration.id,
      });
      if (data.success) {
        toast.success(`${integration.provider.toUpperCase()}: Conectado!`);
      } else {
        toast.error(`${integration.provider.toUpperCase()}: ${data.error || "Falha"}`);
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setTestingId(null);
    }
  };

  const handleToggle = (integration: IntegrationSetting, active: boolean) => {
    updateConfig.mutate({ id: integration.id, is_active: active });
  };

  const handleSaveConfig = (id: string, config: Record<string, any>) => {
    setPendingSave({ id, config });
  };

  const confirmSaveConfig = () => {
    if (!pendingSave) return;
    updateConfig.mutate({ id: pendingSave.id, config_json: pendingSave.config }, {
      onSuccess: () => { setConfigDialog(null); setPendingSave(null); },
    });
  };

  if (isLoading) {
    return <div className="flex justify-center p-12"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Central de Integrações</h1>
          <p className="text-muted-foreground">
            Gerencie, monitore e teste todas as integrações externas da plataforma
          </p>
        </div>
        <PageHelp />
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Visão Geral</TabsTrigger>
          <TabsTrigger value="tests">Testes Avançados</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 mt-4">
          {integrations?.map((integration) => (
            <IntegrationCard
              key={integration.id}
              integration={integration}
              onTest={() => handleTest(integration)}
              onConfigure={() => setConfigDialog(integration)}
              onToggle={(active) => handleToggle(integration, active)}
              onShowLogs={() => setLogsDialog({ id: integration.id, provider: integration.provider })}
              testing={testingId === integration.id}
            />
          ))}
          {(!integrations || integrations.length === 0) && (
            <p className="text-sm text-muted-foreground text-center py-8">
              Nenhuma integração configurada. Execute a migração de seed primeiro.
            </p>
          )}
        </TabsContent>

        <TabsContent value="tests" className="mt-4">
          <IntegrationTestPanel />
        </TabsContent>
      </Tabs>

      <IntegrationConfigDialog
        integration={configDialog}
        open={!!configDialog}
        onOpenChange={(open) => !open && setConfigDialog(null)}
        onSave={handleSaveConfig}
        saving={updateConfig.isPending}
      />

      <IntegrationLogsPanel
        integrationId={logsDialog?.id || null}
        providerName={logsDialog?.provider || ""}
        open={!!logsDialog}
        onOpenChange={(open) => !open && setLogsDialog(null)}
      />

      <DoubleConfirmDialog
        open={!!pendingSave}
        onOpenChange={(open) => !open && setPendingSave(null)}
        title="Confirmar alteração de configuração"
        description="Alterações em integrações podem impactar o funcionamento do sistema. Deseja continuar?"
        onConfirm={confirmSaveConfig}
      />
    </div>
  );
}
