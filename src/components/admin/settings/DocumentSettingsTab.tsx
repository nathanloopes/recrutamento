import { useGlobalSettings, useUpdateSetting } from "@/hooks/useGlobalSettings";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Loader2, Upload, FileText } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useDocumentTemplates, useCreateDocumentTemplate, useToggleDocumentTemplate } from "@/hooks/useDocumentTemplates";
import { DoubleConfirmDialog } from "@/components/admin/DoubleConfirmDialog";

export function DocumentSettingsTab() {
  const { data: settings, isLoading } = useGlobalSettings("documents");
  const updateSetting = useUpdateSetting();
  // Rich document metadata: {name, description, format, max_size_mb, required, gender_requirement}
  type GenderReq = "all" | "male" | "female";
  type DocMeta = { name: string; description: string; format: string; max_size_mb: number; required: boolean; gender_requirement?: GenderReq };
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [newDoc, setNewDoc] = useState("");
  const [newDocDesc, setNewDocDesc] = useState("");
  const [newDocFormat, setNewDocFormat] = useState("pdf,jpg,jpeg,png");
  const [newDocSize, setNewDocSize] = useState("10");
  const [newDocRequired, setNewDocRequired] = useState(true);
  const [newDocGender, setNewDocGender] = useState<GenderReq>("all");
  const [deadline, setDeadline] = useState("7");
  const [allowCustomDocs, setAllowCustomDocs] = useState(true);
  const [autoClose, setAutoClose] = useState(true);
  const [maxAttempts, setMaxAttempts] = useState("3");

  // Governance
  const [enforceGlobalDocs, setEnforceGlobalDocs] = useState(true);
  const [autoBlockExpired, setAutoBlockExpired] = useState(false);
  const [retentionAutoDelete, setRetentionAutoDelete] = useState(false);
  const [aiValidation, setAiValidation] = useState(false);

  // Reminders
  const [reminderDays, setReminderDays] = useState("3");

  // Retention
  const [retReprovado, setRetReprovado] = useState("6");
  const [retContratado, setRetContratado] = useState("60");
  const [retDesistente, setRetDesistente] = useState("3");

  // Templates
  const { data: templates, isLoading: loadingTemplates } = useDocumentTemplates();
  const createTemplate = useCreateDocumentTemplate();
  const toggleTemplate = useToggleDocumentTemplate();
  const [tplName, setTplName] = useState("");
  const [tplDesc, setTplDesc] = useState("");
  const [tplCategory, setTplCategory] = useState("outro");
  const tplFileRef = useRef<HTMLInputElement>(null);
  const [tplFile, setTplFile] = useState<File | null>(null);

  // DoubleConfirm state
  const [confirmEnforceOpen, setConfirmEnforceOpen] = useState(false);
  const [confirmBlockOpen, setConfirmBlockOpen] = useState(false);
  const [pendingEnforceValue, setPendingEnforceValue] = useState(false);
  const [pendingBlockValue, setPendingBlockValue] = useState(false);

  useEffect(() => {
    if (settings) {
      const get = (k: string) => settings.find((s) => s.key === k)?.value;
      const d = get("required_documents");
      // Support both legacy string[] and enriched object[]
      if (Array.isArray(d)) {
        setDocs(d.map((item: any) => typeof item === "string"
          ? { name: item, description: "", format: "pdf,jpg,jpeg,png", max_size_mb: 10, required: true, gender_requirement: "all" as GenderReq }
          : { gender_requirement: "all" as GenderReq, ...item }
        ));
      } else {
        setDocs([]);
      }
      setDeadline(String(get("deadline_days") ?? "7"));
      setAllowCustomDocs(get("allow_unit_custom_docs") !== false);
      setAutoClose(get("auto_close_on_complete") !== false);
      setMaxAttempts(String(get("max_upload_attempts") ?? "3"));

      setEnforceGlobalDocs(get("enforce_global_documents") === true || get("enforce_global_documents") === "true");
      setAutoBlockExpired(get("auto_block_if_expired") === true || get("auto_block_if_expired") === "true");
      setRetentionAutoDelete(get("retention_auto_delete") === true || get("retention_auto_delete") === "true");
      setAiValidation(get("allow_document_ai_validation") === true || get("allow_document_ai_validation") === "true");

      setReminderDays(String(get("reminder_frequency_days") ?? "3"));

      const ret = get("retention_policy");
      if (ret && typeof ret === "object") {
        const r = ret as any;
        setRetReprovado(String(r.reprovado ?? "6"));
        setRetContratado(String(r.contratado ?? "60"));
        setRetDesistente(String(r.desistente ?? "3"));
      }
    }
  }, [settings]);

  const save = (key: string, value: any) => updateSetting.mutate({ category: "documents", key, value });

  const addDoc = () => {
    if (newDoc.trim()) {
      const newMeta: DocMeta = {
        name: newDoc.trim(),
        description: newDocDesc.trim(),
        format: newDocFormat.trim() || "pdf,jpg,jpeg,png",
        max_size_mb: Number(newDocSize) || 10,
        required: newDocRequired,
        gender_requirement: newDocGender,
      };
      const updated = [...docs, newMeta];
      setDocs(updated);
      setNewDoc("");
      setNewDocDesc("");
      setNewDocFormat("pdf,jpg,jpeg,png");
      setNewDocSize("10");
      setNewDocRequired(true);
      setNewDocGender("all");
      save("required_documents", updated);
    }
  };

  const removeDoc = (index: number) => {
    const updated = docs.filter((_, i) => i !== index);
    setDocs(updated);
    save("required_documents", updated);
  };

  const updateDocField = (index: number, field: keyof DocMeta, value: any) => {
    const updated = [...docs];
    (updated[index] as any)[field] = value;
    setDocs(updated);
    save("required_documents", updated);
  };

  const handleCreateTemplate = () => {
    if (!tplName.trim()) return;
    createTemplate.mutate(
      { name: tplName.trim(), description: tplDesc, category: tplCategory, file: tplFile || undefined },
      {
        onSuccess: () => {
          setTplName("");
          setTplDesc("");
          setTplCategory("outro");
          setTplFile(null);
        },
      }
    );
  };

  if (isLoading) return <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-6">
      {/* Documentos Obrigatórios */}
      <Card>
        <CardHeader>
          <CardTitle>Documentos Obrigatórios</CardTitle>
          <CardDescription>Lista institucional de documentos exigidos para contratação.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Rich document list with metadata */}
          <div className="space-y-3">
            {docs.map((d, i) => {
              const gender = (d.gender_requirement || "all") as GenderReq;
              return (
                <div key={i} className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">{d.name}</span>
                    <div className="flex items-center gap-2">
                      {gender !== "all" && (
                        <Badge variant="secondary" className="text-[10px]">
                          {gender === "male" ? "Apenas homens" : "Apenas mulheres"}
                        </Badge>
                      )}
                      <Badge variant={d.required ? "default" : "outline"} className="text-[10px] cursor-pointer" onClick={() => updateDocField(i, "required", !d.required)}>
                        {d.required ? "Obrigatório" : "Opcional"}
                      </Badge>
                      <button onClick={() => removeDoc(i)} className="text-muted-foreground hover:text-destructive"><X className="h-3 w-3" /></button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                    <Input placeholder="Descrição" value={d.description} onChange={(e) => updateDocField(i, "description", e.target.value)} className="h-7 text-xs" />
                    <Input placeholder="Formatos (pdf,jpg)" value={d.format} onChange={(e) => updateDocField(i, "format", e.target.value)} className="h-7 text-xs" />
                    <Input type="number" placeholder="Max MB" value={d.max_size_mb} onChange={(e) => updateDocField(i, "max_size_mb", Number(e.target.value))} className="h-7 text-xs" />
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <Label className="text-xs text-muted-foreground shrink-0">Exigir para</Label>
                    <Select value={gender} onValueChange={(v) => updateDocField(i, "gender_requirement", v as GenderReq)}>
                      <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos os candidatos</SelectItem>
                        <SelectItem value="male">Apenas homens</SelectItem>
                        <SelectItem value="female">Apenas mulheres</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Add new document form */}
          <div className="border-t pt-3 space-y-2">
            <p className="text-sm font-medium text-muted-foreground">Adicionar documento</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <Input placeholder="Nome do documento" value={newDoc} onChange={(e) => setNewDoc(e.target.value)} />
              <Input placeholder="Descrição" value={newDocDesc} onChange={(e) => setNewDocDesc(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <Input placeholder="Formatos (pdf,jpg)" value={newDocFormat} onChange={(e) => setNewDocFormat(e.target.value)} />
              <Input type="number" placeholder="Max MB" value={newDocSize} onChange={(e) => setNewDocSize(e.target.value)} />
              <Select value={newDocGender} onValueChange={(v) => setNewDocGender(v as GenderReq)}>
                <SelectTrigger><SelectValue placeholder="Exigir para" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os candidatos</SelectItem>
                  <SelectItem value="male">Apenas homens</SelectItem>
                  <SelectItem value="female">Apenas mulheres</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={newDocRequired} onCheckedChange={setNewDocRequired} />
              <Label className="text-xs">{newDocRequired ? "Obrigatório" : "Opcional"}</Label>
            </div>
            <Button size="sm" onClick={addDoc} disabled={!newDoc.trim()}>Adicionar</Button>
          </div>
        </CardContent>
      </Card>

      {/* Prazos e Retenção */}
      <Card>
        <CardHeader>
          <CardTitle>Prazos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-end gap-3 sm:gap-4">
            <div className="flex-1 w-full space-y-1">
              <Label>Prazo para envio de documentos (dias)</Label>
              <Input type="number" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </div>
            <Button size="sm" onClick={() => save("deadline_days", Number(deadline))}>Salvar</Button>
          </div>
        </CardContent>
      </Card>

      {/* Governança */}
      <Card>
        <CardHeader>
          <CardTitle>Governança</CardTitle>
          <CardDescription>Controles de compliance e segurança documental.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Documentos institucionais obrigatórios protegidos</Label>
              <CardDescription>Impede remoção de docs da lista institucional por unidades</CardDescription>
            </div>
            <Switch checked={enforceGlobalDocs} onCheckedChange={(v) => { setPendingEnforceValue(v); setConfirmEnforceOpen(true); }} />
          </div>
          <DoubleConfirmDialog
            open={confirmEnforceOpen}
            onOpenChange={setConfirmEnforceOpen}
            title="Alterar proteção de documentos institucionais"
            description={pendingEnforceValue ? "Ao ativar, unidades não poderão remover documentos obrigatórios." : "Ao desativar, unidades poderão remover documentos da lista institucional."}
            onConfirm={() => { setEnforceGlobalDocs(pendingEnforceValue); save("enforce_global_documents", pendingEnforceValue); }}
          />
          <div className="flex items-center justify-between">
            <div>
              <Label>Bloquear envio após prazo expirado</Label>
              <CardDescription>Candidato não poderá enviar documentos após a data limite</CardDescription>
            </div>
            <Switch checked={autoBlockExpired} onCheckedChange={(v) => { setPendingBlockValue(v); setConfirmBlockOpen(true); }} />
          </div>
          <DoubleConfirmDialog
            open={confirmBlockOpen}
            onOpenChange={setConfirmBlockOpen}
            title="Alterar bloqueio por prazo expirado"
            description={pendingBlockValue ? "Ao ativar, candidatos serão bloqueados de enviar documentos após o prazo." : "Ao desativar, candidatos poderão enviar documentos mesmo após o prazo."}
            onConfirm={() => { setAutoBlockExpired(pendingBlockValue); save("auto_block_if_expired", pendingBlockValue); }}
          />
          <div className="flex items-center justify-between">
            <div>
              <Label>Permitir documentos extras por unidade</Label>
              <CardDescription>Unidades podem adicionar documentos além do checklist padrão</CardDescription>
            </div>
            <Switch checked={allowCustomDocs} onCheckedChange={(v) => { setAllowCustomDocs(v); save("allow_unit_custom_docs", v); }} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Fechar automaticamente ao completar</Label>
              <CardDescription>Marca contratação como completa quando todos os docs são aprovados</CardDescription>
            </div>
            <Switch checked={autoClose} onCheckedChange={(v) => { setAutoClose(v); save("auto_close_on_complete", v); }} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Exclusão automática por retenção</Label>
              <CardDescription>Remove documentos expirados conforme política de retenção</CardDescription>
            </div>
            <Switch checked={retentionAutoDelete} onCheckedChange={(v) => { setRetentionAutoDelete(v); save("retention_auto_delete", v); }} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Validação por IA (futuro)</Label>
              <CardDescription>IA valida legibilidade e tipo de documento automaticamente</CardDescription>
            </div>
            <Switch checked={aiValidation} onCheckedChange={(v) => { setAiValidation(v); save("allow_document_ai_validation", v); }} />
          </div>
          <div className="flex flex-col sm:flex-row items-start sm:items-end gap-3 sm:gap-4">
            <div className="flex-1 w-full space-y-1">
              <Label>Máximo de tentativas de upload</Label>
              <Input type="number" value={maxAttempts} onChange={(e) => setMaxAttempts(e.target.value)} />
            </div>
            <Button size="sm" onClick={() => save("max_upload_attempts", Number(maxAttempts))}>Salvar</Button>
          </div>

          {/* Formato e Tamanho por documento */}
          <div className="border-t pt-4 space-y-3">
            <p className="text-sm font-medium">Validação de Formato e Tamanho</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Formatos aceitos</Label>
                <Input
                  placeholder="pdf, jpg, jpeg, png"
                  defaultValue={(() => { const v = settings?.find(s => s.key === "document_accepted_formats")?.value; return Array.isArray(v) ? v.join(", ") : "pdf, jpg, jpeg, png"; })()}
                  onBlur={(e) => {
                    const formats = e.target.value.split(",").map(f => f.trim().toLowerCase()).filter(Boolean);
                    save("document_accepted_formats", formats);
                  }}
                />
                <p className="text-xs text-muted-foreground">Extensões separadas por vírgula</p>
              </div>
              <div className="space-y-1">
                <Label>Tamanho máximo (MB)</Label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  defaultValue={String(settings?.find(s => s.key === "document_max_size_mb")?.value ?? 10)}
                  onBlur={(e) => save("document_max_size_mb", Number(e.target.value))}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lembretes */}
      <Card>
        <CardHeader>
          <CardTitle>Lembretes</CardTitle>
          <CardDescription>Frequência de lembretes automáticos ao candidato.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row items-start sm:items-end gap-3 sm:gap-4">
            <div className="flex-1 w-full space-y-1">
              <Label>Intervalo entre lembretes (dias)</Label>
              <Input type="number" value={reminderDays} onChange={(e) => setReminderDays(e.target.value)} />
            </div>
            <Button size="sm" onClick={() => save("reminder_frequency_days", Number(reminderDays))}>Salvar</Button>
          </div>
        </CardContent>
      </Card>

      {/* Política de Retenção */}
      <Card>
        <CardHeader>
          <CardTitle>Política de Retenção</CardTitle>
          <CardDescription>Tempo de armazenamento de documentos por situação do candidato (em meses).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label>Não aprovados</Label>
              <Input type="number" value={retReprovado} onChange={(e) => setRetReprovado(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Contratados</Label>
              <Input type="number" value={retContratado} onChange={(e) => setRetContratado(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Desistentes</Label>
              <Input type="number" value={retDesistente} onChange={(e) => setRetDesistente(e.target.value)} />
            </div>
          </div>
          <Button
            size="sm"
            onClick={() =>
              save("retention_policy", {
                reprovado: Number(retReprovado),
                contratado: Number(retContratado),
                desistente: Number(retDesistente),
              })
            }
          >
            Salvar Política
          </Button>
        </CardContent>
      </Card>

      {/* Templates Institucionais */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" /> Templates Institucionais
          </CardTitle>
          <CardDescription>Modelos de documentos como termos, contratos e autorizações LGPD.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Template list */}
          {loadingTemplates ? (
            <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : (templates || []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum template criado ainda.</p>
          ) : (
            <div className="space-y-2">
              {(templates || []).map((t: any) => (
                <div key={t.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{t.name}</p>
                    <div className="flex gap-2 mt-1">
                      <Badge variant="outline" className="text-[10px]">{t.category}</Badge>
                      <Badge variant="secondary" className="text-[10px]">v{t.version}</Badge>
                    </div>
                  </div>
                  <Switch
                    checked={t.is_active}
                    onCheckedChange={(v) => toggleTemplate.mutate({ id: t.id, is_active: v })}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Add template form */}
          <div className="border-t pt-4 space-y-3">
            <p className="text-sm font-medium">Novo Template</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input placeholder="Nome do template" value={tplName} onChange={(e) => setTplName(e.target.value)} />
              <Select value={tplCategory} onValueChange={setTplCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="termo">Termo</SelectItem>
                  <SelectItem value="contrato">Contrato</SelectItem>
                  <SelectItem value="autorizacao">Autorização</SelectItem>
                  <SelectItem value="outro">Outro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Input placeholder="Descrição (opcional)" value={tplDesc} onChange={(e) => setTplDesc(e.target.value)} />
            <div className="flex gap-2">
              <input ref={tplFileRef} type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={(e) => setTplFile(e.target.files?.[0] || null)} />
              <Button size="sm" variant="outline" onClick={() => tplFileRef.current?.click()}>
                <Upload className="h-4 w-4 mr-1" /> {tplFile ? tplFile.name : "Anexar arquivo"}
              </Button>
              <Button size="sm" onClick={handleCreateTemplate} disabled={!tplName.trim() || createTemplate.isPending}>
                {createTemplate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Criar Template"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
