import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Plus, X, RotateCcw, Save, FileCheck } from "lucide-react";
import { useGlobalSettings, useUpdateSetting } from "@/hooks/useGlobalSettings";
import { toast } from "sonner";

const SUGGESTED_DOCS = [
  "RG",
  "CPF",
  "Comprovante de Endereço",
  "Certidão de Nascimento/Casamento",
  "Reservista",
  "Título de Eleitor",
  "CNH (Opcional)",
  "Dependentes e Infos dos Dependentes",
  "Comprovante de Escolaridade",
  "CIVP - Carteirinha de Vacinação",
  "Carteira de Trabalho Digital",
];

export function DefaultDocumentsTab() {
  const { data: settings, isLoading } = useGlobalSettings("documents");
  const updateSetting = useUpdateSetting();
  const [docs, setDocs] = useState<string[]>([]);
  const [newDoc, setNewDoc] = useState("");
  const [hasChanges, setHasChanges] = useState(false);

  const savedDocs = (() => {
    const setting = settings?.find((s) => s.key === "required_documents");
    if (setting?.value && Array.isArray(setting.value)) {
      return (setting.value as any[])
        .map((d) => (typeof d === "string" ? d : d?.name ? String(d.name) : ""))
        .filter(Boolean);
    }
    return [];
  })();

  useEffect(() => {
    if (!isLoading && settings) {
      setDocs(savedDocs);
      setHasChanges(false);
    }
  }, [isLoading, settings]);

  const addDoc = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || docs.includes(trimmed)) return;
    setDocs((prev) => [...prev, trimmed]);
    setNewDoc("");
    setHasChanges(true);
  };

  const removeDoc = (name: string) => {
    setDocs((prev) => prev.filter((d) => d !== name));
    setHasChanges(true);
  };

  const handleSave = () => {
    updateSetting.mutate(
      { category: "documents", key: "required_documents", value: docs },
      {
        onSuccess: () => {
          setHasChanges(false);
          toast.success("Checklist padrão salvo com sucesso");
        },
      }
    );
  };

  const resetToSuggestions = () => {
    setDocs([...SUGGESTED_DOCS]);
    setHasChanges(true);
  };

  const suggestionsNotAdded = SUGGESTED_DOCS.filter((s) => !docs.includes(s));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileCheck className="h-5 w-5 text-primary" />
            Checklist Padrão de Documentos
          </CardTitle>
          <CardDescription>
            Defina a lista de documentos que será pré-selecionada ao solicitar documentos para um candidato.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Current list */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Documentos configurados ({docs.length})</Label>
            {docs.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum documento configurado. Adicione abaixo ou use as sugestões.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {docs.map((doc) => (
                  <Badge key={doc} variant="secondary" className="gap-1 pr-1 text-sm">
                    {doc}
                    <button
                      onClick={() => removeDoc(doc)}
                      className="ml-1 rounded-full p-0.5 hover:bg-destructive/20 transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Add custom */}
          <div className="flex gap-2">
            <Input
              placeholder="Nome do documento..."
              value={newDoc}
              onChange={(e) => setNewDoc(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addDoc(newDoc))}
              className="max-w-sm"
            />
            <Button variant="outline" size="sm" onClick={() => addDoc(newDoc)} disabled={!newDoc.trim()}>
              <Plus className="h-4 w-4 mr-1" /> Adicionar
            </Button>
          </div>

          <Separator />

          {/* Quick suggestions */}
          {suggestionsNotAdded.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Sugestões rápidas (clique para adicionar)</Label>
              <div className="flex flex-wrap gap-1.5">
                {suggestionsNotAdded.map((s) => (
                  <Badge
                    key={s}
                    variant="outline"
                    className="cursor-pointer hover:bg-accent transition-colors text-xs"
                    onClick={() => addDoc(s)}
                  >
                    <Plus className="h-3 w-3 mr-0.5" /> {s}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <Separator />

          {/* Actions */}
          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={!hasChanges || updateSetting.isPending}>
              <Save className="h-4 w-4 mr-1" />
              {updateSetting.isPending ? "Salvando..." : "Salvar checklist"}
            </Button>
            <Button variant="outline" onClick={resetToSuggestions}>
              <RotateCcw className="h-4 w-4 mr-1" /> Restaurar sugestões
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
