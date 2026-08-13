import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  MessageSquare, Mail, Brain, CheckCircle2, XCircle, Loader2, Send, Wifi, AlertTriangle,
} from "lucide-react";

type TestResult = {
  success: boolean;
  provider: string;
  action: string;
  response: any;
  error?: string;
  timestamp: string;
};

export function IntegrationTestPanel() {
  const [results, setResults] = useState<TestResult[]>([]);
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  const [metaPhone, setMetaPhone] = useState("");
  const [metaMode, setMetaMode] = useState<"template" | "text">("template");
  const [metaTemplate, setMetaTemplate] = useState("lembrete_entrevista_10min");
  const [metaLanguage, setMetaLanguage] = useState("pt_BR");
  const [metaVariables, setMetaVariables] = useState("Teste, Vendedor, https://recrutamento.example.com");
  const [metaMessage, setMetaMessage] = useState("🔧 Teste WhatsApp via Meta Cloud API");
  const [brevoEmail, setBrevoEmail] = useState("");
  const [brevoSubject, setBrevoSubject] = useState("🔧 Teste de integração Brevo");
  const [openaiPrompt, setOpenaiPrompt] = useState("Responda em uma frase: O que faz um bom candidato?");
  const [openaiModel, setOpenaiModel] = useState("gpt-4o-mini");
  const [availableModels, setAvailableModels] = useState<string[]>(["gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"]);

  const callTest = async (provider: string, payload: any, loadingKey: string) => {
    setLoading((prev) => ({ ...prev, [loadingKey]: true }));
    try {
      const { data, error } = await supabase.functions.invoke("test-integrations", {
        body: { provider, payload },
      });
      if (error) throw error;

      const result: TestResult = { ...data, timestamp: new Date().toLocaleTimeString("pt-BR") };
      setResults((prev) => [result, ...prev]);

      if (provider === "openai" && data.action === "models_check" && data.response?.available_models) {
        setAvailableModels(data.response.available_models);
      }

      if (data.success) {
        toast.success(`${provider.toUpperCase()}: Teste bem-sucedido!`);
      } else {
        toast.error(`${provider.toUpperCase()}: ${data.error || "Falha no teste"}`);
      }
    } catch (err: any) {
      setResults((prev) => [{
        success: false, provider, action: "error", response: null, error: err.message,
        timestamp: new Date().toLocaleTimeString("pt-BR"),
      }, ...prev]);
      toast.error(`Erro: ${err.message}`);
    } finally {
      setLoading((prev) => ({ ...prev, [loadingKey]: false }));
    }
  };

  const callMetaSend = async () => {
    const loadingKey = "meta_send";
    setLoading((prev) => ({ ...prev, [loadingKey]: true }));
    try {
      const body: any = { phone: metaPhone };
      if (metaMode === "template") {
        body.template_name = metaTemplate.trim();
        body.template_language = metaLanguage.trim() || "pt_BR";
        const vars = metaVariables.split(",").map((v) => v.trim()).filter(Boolean);
        if (vars.length > 0) {
          body.template_components = [
            { type: "body", parameters: vars.map((v) => ({ type: "text", text: v })) },
          ];
        }
      } else {
        body.message = metaMessage;
      }
      const { data, error } = await supabase.functions.invoke("send-whatsapp", { body });
      if (error) throw error;
      const success = !!data?.success;
      const result: TestResult = {
        success,
        provider: "meta_whatsapp",
        action: metaMode === "template" ? `template:${metaTemplate}` : "text",
        response: data,
        error: success ? undefined : (data?.error || data?.reason),
        timestamp: new Date().toLocaleTimeString("pt-BR"),
      };
      setResults((prev) => [result, ...prev]);
      if (success) toast.success("Meta WhatsApp: mensagem enviada!");
      else toast.error(`Meta: ${data?.error || data?.reason || "Falha"}`);
    } catch (err: any) {
      setResults((prev) => [{
        success: false, provider: "meta_whatsapp", action: "error", response: null, error: err.message,
        timestamp: new Date().toLocaleTimeString("pt-BR"),
      }, ...prev]);
      toast.error(`Erro: ${err.message}`);
    } finally {
      setLoading((prev) => ({ ...prev, [loadingKey]: false }));
    }
  };

  return (
    <div className="space-y-4">
      <Tabs defaultValue="zapi">
        <TabsList>
          <TabsTrigger value="meta" className="gap-2"><MessageSquare className="h-4 w-4" /> Meta WhatsApp</TabsTrigger>
          <TabsTrigger value="brevo" className="gap-2"><Mail className="h-4 w-4" /> Brevo</TabsTrigger>
          <TabsTrigger value="openai" className="gap-2"><Brain className="h-4 w-4" /> OpenAI</TabsTrigger>
        </TabsList>

        <TabsContent value="meta" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><MessageSquare className="h-5 w-5" /> Meta Cloud API — WhatsApp</CardTitle>
              <CardDescription>
                Envia via <code>send-whatsapp</code> (Graph v21). Para reabrir conversa fora da janela de 24h use um template HSM aprovado.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Modo de envio</Label>
                <Select value={metaMode} onValueChange={(v: any) => setMetaMode(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="template">Template HSM (aprovado)</SelectItem>
                    <SelectItem value="text">Texto livre (só dentro da janela 24h)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Telefone (com DDD, sem +55)</Label>
                <Input placeholder="11999998888" value={metaPhone} onChange={(e) => setMetaPhone(e.target.value)} />
              </div>
              {metaMode === "template" ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Nome do template</Label>
                      <Input placeholder="lembrete_entrevista_10min" value={metaTemplate} onChange={(e) => setMetaTemplate(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Idioma</Label>
                      <Input placeholder="pt_BR" value={metaLanguage} onChange={(e) => setMetaLanguage(e.target.value)} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Variáveis do corpo (separadas por vírgula, na ordem {`{{1}}, {{2}}…`})</Label>
                    <Textarea
                      rows={2}
                      placeholder="Nome, Vendedor, https://link.com"
                      value={metaVariables}
                      onChange={(e) => setMetaVariables(e.target.value)}
                    />
                  </div>
                </>
              ) : (
                <div className="space-y-2">
                  <Label>Mensagem</Label>
                  <Textarea value={metaMessage} onChange={(e) => setMetaMessage(e.target.value)} rows={3} />
                </div>
              )}
              <Button onClick={callMetaSend} disabled={loading.meta_send || !metaPhone} className="gap-2">
                {loading.meta_send ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Enviar via Meta
              </Button>
            </CardContent>
          </Card>
        </TabsContent>


        <TabsContent value="brevo" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Mail className="h-5 w-5" /> Brevo — E-mail</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button onClick={() => callTest("brevo", {}, "brevo_status")} disabled={loading.brevo_status} variant="outline" className="gap-2">
                {loading.brevo_status ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />} Verificar Conta
              </Button>
              <div className="border-t pt-4 space-y-3">
                <h4 className="font-medium text-sm">Enviar E-mail de Teste</h4>
                <div className="space-y-2">
                  <Label>E-mail destinatário</Label>
                  <Input type="email" placeholder="email@exemplo.com" value={brevoEmail} onChange={(e) => setBrevoEmail(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Assunto</Label>
                  <Input value={brevoSubject} onChange={(e) => setBrevoSubject(e.target.value)} />
                </div>
                <Button onClick={() => callTest("brevo", { send_email: true, to_email: brevoEmail, subject: brevoSubject }, "brevo_send")} disabled={loading.brevo_send || !brevoEmail} className="gap-2">
                  {loading.brevo_send ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Enviar E-mail
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="openai" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Brain className="h-5 w-5" /> OpenAI — GPT & Whisper</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button onClick={() => callTest("openai", {}, "openai_status")} disabled={loading.openai_status} variant="outline" className="gap-2">
                {loading.openai_status ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />} Listar Modelos
              </Button>
              <div className="border-t pt-4 space-y-3">
                <h4 className="font-medium text-sm">Testar Chat Completion</h4>
                <div className="space-y-2">
                  <Label>Modelo</Label>
                  <Select value={openaiModel} onValueChange={setOpenaiModel}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{availableModels.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Prompt</Label>
                  <Textarea value={openaiPrompt} onChange={(e) => setOpenaiPrompt(e.target.value)} rows={2} />
                </div>
                <Button onClick={() => callTest("openai", { test_completion: true, prompt: openaiPrompt, model: openaiModel }, "openai_completion")} disabled={loading.openai_completion || !openaiPrompt} className="gap-2">
                  {loading.openai_completion ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Enviar Prompt
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Resultados dos Testes</CardTitle>
            <CardDescription>Histórico desta sessão</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {results.map((r, i) => (
              <div key={i} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {r.success ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-destructive" />}
                    <Badge variant={r.success ? "default" : "destructive"}>{r.provider?.toUpperCase()}</Badge>
                    <span className="text-xs text-muted-foreground">{r.action}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{r.timestamp}</span>
                </div>
                {r.error && (
                  <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 p-2 rounded">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />{r.error}
                  </div>
                )}
                {r.response && (
                  <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-32">{JSON.stringify(r.response, null, 2)}</pre>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
