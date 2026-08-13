import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useGlobalSettings, useUpdateSetting } from "@/hooks/useGlobalSettings";
import { useState, useEffect } from "react";
import { Save, Shield, FileCheck } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

const SECURITY_KEYS = [
  { key: "enable_ai_audit", label: "Auditoria IA obrigatória", type: "select", options: ["true", "false"] },
  { key: "max_login_attempts", label: "Máximo de tentativas de login", type: "number" },
  { key: "session_timeout_minutes", label: "Timeout de sessão (minutos)", type: "number" },
  { key: "require_override_reason", label: "Justificativa obrigatória em override", type: "select", options: ["true", "false"] },
  { key: "auto_block_on_anomaly", label: "Bloqueio automático por anomalia", type: "select", options: ["true", "false"] },
  { key: "cpf_history_enabled", label: "Histórico por CPF ativo", type: "select", options: ["true", "false"] },
  { key: "audit_export_enabled", label: "Permitir exportação de auditoria", type: "select", options: ["true", "false"] },
  { key: "anomaly_threshold", label: "Sensibilidade de anomalias (threshold)", type: "number" },
  { key: "anomaly_detection_enabled", label: "Detecção de anomalias ativa", type: "select", options: ["true", "false"] },
];

const COMPLIANCE_KEYS = [
  { key: "log_retention_days", label: "Dias de retenção de logs", type: "number", hint: "⚠️ Informativo para compliance: Logs imutáveis não são deletados automaticamente (princípio constitucional de imutabilidade). Este valor serve como referência para política de retenção." },
  { key: "enable_ip_tracking", label: "Registrar IP nas ações", type: "select", options: ["true", "false"] },
  { key: "allow_export_pdf", label: "Permitir exportação em PDF", type: "select", options: ["true", "false"] },
  { key: "enable_ai_decision_log", label: "Log obrigatório de decisões IA", type: "select", options: ["true", "false"] },
  { key: "critical_change_alert", label: "Alertas de alterações críticas", type: "select", options: ["true", "false"] },
  { key: "audit_hash_verification", label: "Hash de integridade nos logs", type: "select", options: ["true", "false"], hint: "🔒 Sempre ativo por segurança: Os triggers de hash SHA-256 permanecem ativos independente desta configuração, garantindo a integridade jurídica dos logs." },
];

function SettingsSection({ title, icon: Icon, keys, settings, isLoading, category }: {
  title: string;
  icon: any;
  keys: typeof SECURITY_KEYS;
  settings: any[] | undefined;
  isLoading: boolean;
  category: string;
}) {
  const updateSetting = useUpdateSetting();
  const [values, setValues] = useState<Record<string, string>>({});
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (settings) {
      const v: Record<string, string> = {};
      settings.forEach((s: any) => {
        v[s.key] = typeof s.value === "string" ? s.value : JSON.stringify(s.value);
      });
      setValues(v);
    }
  }, [settings]);

  const handleSave = (key: string) => {
    setPendingKey(key);
    setReason("");
  };

  const [saveError, setSaveError] = useState<string | null>(null);

  const confirmSave = () => {
    if (pendingKey) {
      setSaveError(null);
      const keyToSave = pendingKey;
      updateSetting.mutate(
        { category, key: keyToSave, value: (() => {
            const raw = values[keyToSave];
            let parsed: any = raw;
            if (!isNaN(Number(raw)) && raw !== "") parsed = Number(raw);
            else if (raw === "true") parsed = true;
            else if (raw === "false") parsed = false;
            else { try { parsed = JSON.parse(raw); } catch { /* keep as string */ } }
            return parsed;
          })(), reason: reason || undefined },
        {
          onSuccess: () => {
            setPendingKey(null);
            setReason("");
            setSaveError(null);
          },
          onError: (err: any) => {
            setSaveError(err?.message || "Erro ao salvar. Tente novamente.");
          },
        }
      );
    }
  };

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5" />
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {keys.map((sk) => (
            <div key={sk.key} className="flex items-end gap-3">
              <div className="flex-1 space-y-1">
                <Label>{sk.label}</Label>
                {(sk as any).hint && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">{(sk as any).hint}</p>
                )}
                {sk.type === "select" ? (
                  <Select value={values[sk.key] || ""} onValueChange={(v) => setValues((prev) => ({ ...prev, [sk.key]: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {sk.options!.map((o) => <SelectItem key={o} value={o}>{o === "true" ? "Sim" : "Não"}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    type="number"
                    value={values[sk.key] || ""}
                    onChange={(e) => setValues((prev) => ({ ...prev, [sk.key]: e.target.value }))}
                  />
                )}
              </div>
              <Button size="sm" onClick={() => handleSave(sk.key)} disabled={updateSetting.isPending}>
                <Save className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={!!pendingKey} onOpenChange={(open) => { if (!open) { setPendingKey(null); setSaveError(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Justificativa da alteração</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Motivo da alteração em <strong>{pendingKey}</strong></Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Informe o motivo da alteração..."
              autoFocus
            />
            {saveError && (
              <p className="text-sm text-destructive">{saveError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPendingKey(null); setSaveError(null); }}>Cancelar</Button>
            <Button onClick={confirmSave} disabled={updateSetting.isPending}>
              <Save className="h-4 w-4 mr-2" /> Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
export function SecuritySettingsTab() {
  const { data: securitySettings, isLoading: loadingSecurity } = useGlobalSettings("security");
  const { data: complianceSettings, isLoading: loadingCompliance } = useGlobalSettings("compliance");

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Configurações de Segurança e Auditoria"
        icon={Shield}
        keys={SECURITY_KEYS}
        settings={securitySettings}
        isLoading={loadingSecurity}
        category="security"
      />
      <SettingsSection
        title="Compliance e Governança de Logs"
        icon={FileCheck}
        keys={COMPLIANCE_KEYS}
        settings={complianceSettings}
        isLoading={loadingCompliance}
        category="compliance"
      />
    </div>
  );
}
