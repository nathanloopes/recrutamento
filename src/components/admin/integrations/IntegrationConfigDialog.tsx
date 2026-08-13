import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import type { IntegrationSetting } from "@/hooks/useIntegrations";

const CONFIG_FIELDS: Record<string, { key: string; label: string; placeholder: string }[]> = {
  whatsapp: [
    { key: "webhook_url", label: "Webhook URL", placeholder: "https://..." },
    { key: "description", label: "Descrição", placeholder: "Z-API WhatsApp Business" },
  ],
  email: [
    { key: "sender_name", label: "Nome do Remetente", placeholder: "Recruta - RH" },
    { key: "sender_email", label: "E-mail do Remetente", placeholder: "rh@example.com" },
    { key: "description", label: "Descrição", placeholder: "Brevo E-mail Transacional" },
  ],
  ai: [
    { key: "default_model", label: "Modelo Padrão", placeholder: "gpt-4o-mini" },
    { key: "description", label: "Descrição", placeholder: "OpenAI GPT & Whisper" },
  ],
  erp: [
    { key: "description", label: "Descrição", placeholder: "Integração ERP Intranet" },
  ],
  calendar: [
    { key: "scopes", label: "Escopos OAuth", placeholder: "https://www.googleapis.com/auth/calendar" },
    { key: "description", label: "Descrição", placeholder: "Google Calendar OAuth" },
  ],
  storage: [
    { key: "bucket_name", label: "Nome do Bucket", placeholder: "documents" },
    { key: "description", label: "Descrição", placeholder: "Supabase Storage" },
  ],
};

interface Props {
  integration: IntegrationSetting | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (id: string, config: Record<string, any>) => void;
  saving?: boolean;
}

export function IntegrationConfigDialog({ integration, open, onOpenChange, onSave, saving }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (integration) {
      const v: Record<string, string> = {};
      const fields = CONFIG_FIELDS[integration.integration_type] || [];
      fields.forEach((f) => {
        v[f.key] = String(integration.config_json?.[f.key] || "");
      });
      setValues(v);
    }
  }, [integration]);

  if (!integration) return null;

  const fields = CONFIG_FIELDS[integration.integration_type] || [];

  const handleSave = () => {
    const newConfig = { ...integration.config_json, ...values };
    onSave(integration.id, newConfig);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Configurar {integration.provider.toUpperCase()}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Configure parâmetros não sensíveis. Chaves de API são gerenciadas nos Supabase Secrets.
          </p>
          {fields.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label>{f.label}</Label>
              <Input
                value={values[f.key] || ""}
                onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
              />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
