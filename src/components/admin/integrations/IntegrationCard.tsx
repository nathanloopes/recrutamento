import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Loader2, Wifi, Settings, History, MessageSquare, Mail, Brain, Globe, Calendar, HardDrive } from "lucide-react";
import type { IntegrationSetting } from "@/hooks/useIntegrations";

const ICONS: Record<string, React.ElementType> = {
  whatsapp: MessageSquare,
  email: Mail,
  ai: Brain,
  erp: Globe,
  calendar: Calendar,
  storage: HardDrive,
};

const TYPE_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  email: "E-mail Transacional",
  ai: "Inteligência Artificial",
  erp: "ERP Intranet",
  calendar: "Google Calendar",
  storage: "Storage",
};

function getHealthBadge(lastCheck: string | null) {
  if (!lastCheck) return null;
  const diff = Date.now() - new Date(lastCheck).getTime();
  const hours = diff / (1000 * 60 * 60);
  if (hours < 1) return { label: "Saudável", className: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" };
  if (hours < 24) return { label: "Atenção", className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" };
  return { label: "Desatualizado", className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" };
}

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  connected: { label: "Conectado", variant: "default" },
  disconnected: { label: "Desconectado", variant: "secondary" },
  error: { label: "Erro", variant: "destructive" },
};

interface Props {
  integration: IntegrationSetting;
  onTest: () => void;
  onConfigure: () => void;
  onToggle: (active: boolean) => void;
  onShowLogs: () => void;
  testing?: boolean;
}

export function IntegrationCard({ integration, onTest, onConfigure, onToggle, onShowLogs, testing }: Props) {
  const Icon = ICONS[integration.integration_type] || Globe;
  const statusCfg = STATUS_CONFIG[integration.status] || STATUS_CONFIG.disconnected;
  const description = integration.config_json?.description || integration.provider;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Icon className="h-5 w-5" />
            {TYPE_LABELS[integration.integration_type] || integration.integration_type}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={statusCfg.variant}>{statusCfg.label}</Badge>
            {(() => {
              const hb = getHealthBadge(integration.last_health_check);
              return hb ? <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${hb.className}`}>{hb.label}</span> : null;
            })()}
            <Switch checked={integration.is_active} onCheckedChange={onToggle} />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Provider: <span className="font-medium">{integration.provider.toUpperCase()}</span> — {description}
        </p>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={onTest} disabled={testing} className="gap-1.5">
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wifi className="h-3.5 w-3.5" />}
            Testar Conexão
          </Button>
          <Button size="sm" variant="outline" onClick={onConfigure} className="gap-1.5">
            <Settings className="h-3.5 w-3.5" /> Configurar
          </Button>
          <Button size="sm" variant="ghost" onClick={onShowLogs} className="gap-1.5">
            <History className="h-3.5 w-3.5" /> Histórico
          </Button>
          {integration.last_health_check && (
            <span className="text-xs text-muted-foreground ml-auto">
              Último check: {new Date(integration.last_health_check).toLocaleString("pt-BR")}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
