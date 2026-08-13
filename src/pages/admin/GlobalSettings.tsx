import { useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScoringRulesTab } from "@/components/admin/settings/ScoringRulesTab";
import { UnitDefaultsTab } from "@/components/admin/settings/UnitDefaultsTab";
import { FeatureFlagsTab } from "@/components/admin/settings/FeatureFlagsTab";
import { NotificationSettingsTab } from "@/components/admin/settings/NotificationSettingsTab";
import { CalendarSettingsTab } from "@/components/admin/settings/CalendarSettingsTab";
import { DocumentSettingsTab } from "@/components/admin/settings/DocumentSettingsTab";
import { AutomationRulesTab } from "@/components/admin/settings/AutomationRulesTab";
import { ConfigAuditTab } from "@/components/admin/settings/ConfigAuditTab";
import { DashboardSettingsTab } from "@/components/admin/settings/DashboardSettingsTab";
import { VoiceSettingsTab } from "@/components/admin/settings/VoiceSettingsTab";
import { AISettingsTab } from "@/components/admin/settings/AISettingsTab";
import { FAQSettingsTab } from "@/components/admin/settings/FAQSettingsTab";
import { MigrationSettingsTab } from "@/components/admin/settings/MigrationSettingsTab";
import { SecuritySettingsTab } from "@/components/admin/settings/SecuritySettingsTab";
import { JobsSettingsTab } from "@/components/admin/settings/JobsSettingsTab";
import { PipelineSettingsTab } from "@/components/admin/settings/PipelineSettingsTab";
import { CorporateJobsSettingsTab } from "@/components/admin/settings/CorporateJobsSettingsTab";
import { IntegrationsSettingsTab } from "@/components/admin/settings/IntegrationsSettingsTab";
import { TalentPoolSettingsTab } from "@/components/admin/settings/TalentPoolSettingsTab";
import { ServerMonitoringTab } from "@/components/admin/settings/ServerMonitoringTab";
import { PageHelp } from "@/components/ui/page-help";
import { logSensitiveAccess } from "@/lib/accessLogHelper";
import { useAuth } from "@/contexts/AuthContext";

export default function GlobalSettings() {
  const { hasRole } = useAuth();
  const canSeeServerMonitor = hasRole("admin");

  useEffect(() => { logSensitiveAccess("configuracoes_globais"); }, []);
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Configurações Globais</h1>
          <p className="text-muted-foreground">Painel de configuração centralizada do sistema. Alterações aqui impactam toda a rede.</p>
        </div>
        <PageHelp />
      </div>

      <Tabs defaultValue="scoring" className="space-y-4">
        <TabsList>
          <TabsTrigger value="scoring">Score</TabsTrigger>
          <TabsTrigger value="ai">IA</TabsTrigger>
          <TabsTrigger value="units">Unidades</TabsTrigger>
          <TabsTrigger value="features">Módulos</TabsTrigger>
          <TabsTrigger value="notifications">Notificações</TabsTrigger>
          <TabsTrigger value="calendar">Agenda</TabsTrigger>
          <TabsTrigger value="documents">Documentos</TabsTrigger>
          <TabsTrigger value="automations">Automações</TabsTrigger>
          <TabsTrigger value="voice">Voz</TabsTrigger>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="faq">FAQ</TabsTrigger>
          <TabsTrigger value="migration">Migração</TabsTrigger>
          <TabsTrigger value="audit">Auditoria</TabsTrigger>
          <TabsTrigger value="security">Segurança</TabsTrigger>
          <TabsTrigger value="jobs">Cargos</TabsTrigger>
          <TabsTrigger value="pipelines">Pipelines</TabsTrigger>
          <TabsTrigger value="corporate_jobs">Vagas Corp.</TabsTrigger>
          <TabsTrigger value="talent_pool">Banco Talentos</TabsTrigger>
          <TabsTrigger value="integrations">Integrações</TabsTrigger>
          {canSeeServerMonitor && <TabsTrigger value="monitoring">Monitoração</TabsTrigger>}
        </TabsList>

        <TabsContent value="scoring"><ScoringRulesTab /></TabsContent>
        <TabsContent value="ai"><AISettingsTab /></TabsContent>
        <TabsContent value="units"><UnitDefaultsTab /></TabsContent>
        <TabsContent value="features"><FeatureFlagsTab /></TabsContent>
        <TabsContent value="notifications"><NotificationSettingsTab /></TabsContent>
        <TabsContent value="calendar"><CalendarSettingsTab /></TabsContent>
        <TabsContent value="documents"><DocumentSettingsTab /></TabsContent>
        <TabsContent value="automations"><AutomationRulesTab /></TabsContent>
        <TabsContent value="voice"><VoiceSettingsTab /></TabsContent>
        <TabsContent value="dashboard"><DashboardSettingsTab /></TabsContent>
        <TabsContent value="faq"><FAQSettingsTab /></TabsContent>
        <TabsContent value="migration"><MigrationSettingsTab /></TabsContent>
        <TabsContent value="audit"><ConfigAuditTab /></TabsContent>
        <TabsContent value="security"><SecuritySettingsTab /></TabsContent>
        <TabsContent value="jobs"><JobsSettingsTab /></TabsContent>
        <TabsContent value="pipelines"><PipelineSettingsTab /></TabsContent>
        <TabsContent value="corporate_jobs"><CorporateJobsSettingsTab /></TabsContent>
        <TabsContent value="talent_pool"><TalentPoolSettingsTab /></TabsContent>
        <TabsContent value="integrations"><IntegrationsSettingsTab /></TabsContent>
        {canSeeServerMonitor && <TabsContent value="monitoring"><ServerMonitoringTab /></TabsContent>}
      </Tabs>
    </div>
  );
}