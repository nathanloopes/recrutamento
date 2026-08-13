import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, ChevronUp, ChevronDown, GripVertical, ImagePlus, Check, Loader2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { getStorageClient } from "@/lib/storageDirect";
import { toast } from "sonner";

const MAX_IMAGE_OPTIONS = 6;

// Normaliza pesos legados (correct: bool) para o novo formato alto/medio/baixo
function normalizeAnswerWeight(opt: any): "alto" | "medio" | "baixo" {
  if (opt?.weight === "alto" || opt?.weight === "medio" || opt?.weight === "baixo") return opt.weight;
  if (typeof opt?.correct === "boolean") return opt.correct ? "alto" : "baixo";
  return "medio";
}

interface Props {
  type: string;
  content: any;
  onChange: (content: any) => void;
  isOptional?: boolean;
  onOptionalChange?: (val: boolean) => void;
  isAutomated?: boolean;
  onAutomatedChange?: (val: boolean) => void;
  conditions?: any;
  onConditionsChange?: (val: any) => void;
}

// Migra content legado (quiz único, texto único, etc.) para questions[]
function ensureQuestionsArray(content: any, fallbackType: string): any[] {
  if (Array.isArray(content?.questions) && content.questions.length > 0 && content.questions[0]?.type) {
    return content.questions;
  }
  // Legacy entrevista_voz: questions é array de strings
  if (fallbackType === "entrevista_voz" && Array.isArray(content?.questions)) {
    return content.questions.map((q: any, i: number) => ({
      id: `q${i + 1}`,
      type: "voice",
      prompt: typeof q === "string" ? q : (q?.text || ""),
      max_seconds: 120,
      weight: 2,
    }));
  }
  // Wrap legado num array de 1. Etapa "misto" não é um tipo de pergunta válido — usa "texto".
  const defaultQType = fallbackType === "misto" ? "texto" : (fallbackType || "texto");
  return [{
    id: "q1",
    type: defaultQType,
    weight: 2,
    ...(content || {}),
  }];
}

function genQuestionId(existing: any[]): string {
  const used = new Set(existing.map((q) => q.id));
  let i = existing.length + 1;
  while (used.has(`q${i}`)) i++;
  return `q${i}`;
}

export default function StepContentEditor({
  type,
  content,
  onChange,
  isOptional,
  onOptionalChange,
  isAutomated,
  onAutomatedChange,
  conditions,
  onConditionsChange,
}: Props) {
  const questions = ensureQuestionsArray(content, type);

  // Refs para evitar stale closures em callbacks assíncronos (ex: upload de imagens).
  // Sem isso, o onChange disparado após um upload usa uma versão antiga de content/questions
  // e apaga campos digitados durante o upload (ex: o enunciado da pergunta).
  const contentRef = useRef(content);
  contentRef.current = content;
  const questionsRef = useRef(questions);
  questionsRef.current = questions;

  const updateQuestion = (idx: number, patch: any) => {
    const latest = ensureQuestionsArray(contentRef.current, type);
    const updated = [...latest];
    updated[idx] = { ...updated[idx], ...patch };
    onChange({ ...contentRef.current, questions: updated });
  };

  const isMixed = type === "misto";

  const addQuestion = () => {
    const latest = ensureQuestionsArray(contentRef.current, type);
    const newQ = {
      id: genQuestionId(latest),
      type: isMixed ? "texto" : type,
      prompt: "",
      weight: 2,
    };
    onChange({ ...contentRef.current, questions: [...latest, newQ] });
  };

  const removeQuestion = (idx: number) => {
    const latest = ensureQuestionsArray(contentRef.current, type);
    if (latest.length <= 1) return;
    onChange({ ...contentRef.current, questions: latest.filter((_, i) => i !== idx) });
  };

  const moveQuestion = (idx: number, dir: -1 | 1) => {
    const latest = ensureQuestionsArray(contentRef.current, type);
    const target = idx + dir;
    if (target < 0 || target >= latest.length) return;
    const updated = [...latest];
    [updated[idx], updated[target]] = [updated[target], updated[idx]];
    onChange({ ...contentRef.current, questions: updated });
  };

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-sm font-semibold">Perguntas desta etapa</Label>
        <p className="text-xs text-muted-foreground">
          {isMixed
            ? "Cada pergunta pode ter seu próprio tipo de resposta (Texto, Quiz, Imagem, Vídeo, Áudio ou Voz)."
            : "Adicione quantas perguntas quiser. Todas usarão o tipo definido no topo do formulário."}
        </p>
      </div>


      <div className="space-y-3">
        {questions.map((q: any, idx: number) => (
          <Card key={q.id || idx} className="p-3 space-y-3 bg-muted/30">
            <div className="flex items-center gap-2">
              <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-xs font-semibold text-muted-foreground shrink-0">
                Pergunta {idx + 1}
              </span>
              <div className="flex-1" />
              <Button
                type="button" variant="ghost" size="icon" className="h-7 w-7"
                onClick={() => moveQuestion(idx, -1)} disabled={idx === 0}
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button" variant="ghost" size="icon" className="h-7 w-7"
                onClick={() => moveQuestion(idx, 1)} disabled={idx === questions.length - 1}
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button" variant="ghost" size="icon" className="h-7 w-7"
                onClick={() => removeQuestion(idx)} disabled={questions.length <= 1}
              >
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>

            <QuestionSubEditor
              blockType={type}
              question={q}
              onChange={(patch) => updateQuestion(idx, patch)}
            />
          </Card>
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addQuestion}
        className="w-full border-dashed"
      >
        <Plus className="h-3.5 w-3.5 mr-1" />
        Adicionar pergunta
      </Button>

      {/* Step flags: optional, automated, conditions */}
      <div className="border-t pt-4 space-y-3">
        <h4 className="text-sm font-semibold text-muted-foreground">Configurações da etapa</h4>

        {onOptionalChange && (
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Etapa opcional</Label>
              <p className="text-xs text-muted-foreground">Candidato pode pular sem penalidade no score</p>
            </div>
            <Switch checked={isOptional || false} onCheckedChange={onOptionalChange} />
          </div>
        )}

        {onAutomatedChange && (
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Avaliação automática (IA)</Label>
              <p className="text-xs text-muted-foreground">Se desativado, a avaliação será manual pelo gestor</p>
            </div>
            <Switch checked={isAutomated !== false} onCheckedChange={onAutomatedChange} />
          </div>
        )}

        {onConditionsChange && (
          <div className="space-y-2">
            <Label className="text-sm">Condição de exibição</Label>
            <p className="text-xs text-muted-foreground">Mostrar etapa apenas se o perfil do candidato atender a condição</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Select
                value={conditions?.field || "none"}
                onValueChange={(v) => onConditionsChange(v === "none" ? null : { ...conditions, field: v })}
              >
                <SelectTrigger className="text-xs"><SelectValue placeholder="Campo" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem condição</SelectItem>
                  <SelectItem value="gender">Gênero</SelectItem>
                  <SelectItem value="city">Cidade</SelectItem>
                  <SelectItem value="state">Estado</SelectItem>
                </SelectContent>
              </Select>
              {conditions?.field && (
                <Input
                  className="text-xs"
                  value={conditions?.value || ""}
                  onChange={(e) => onConditionsChange({ ...conditions, value: e.target.value })}
                  placeholder={`Valor (ex: ${conditions.field === "gender" ? "feminino" : "SP"})`}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// SubEditor por pergunta — reaproveita os blocos antigos
// ============================================================

function QuestionSubEditor({ blockType, question, onChange }: { blockType: string; question: any; onChange: (patch: any) => void }) {
  const isMixed = blockType === "misto";
  // Em etapas mistas, cada pergunta carrega o próprio tipo. Nas demais, herda da etapa.
  const t = isMixed ? (question.type || "texto") : blockType;

  // Peso da pergunta (não aparece em quiz — quiz usa peso por alternativa)
  const showWeight = t !== "quiz" && t !== "true_false";

  return (
    <div className="space-y-3">
      {isMixed && (
        <div>
          <Label className="text-xs">Tipo de resposta</Label>
          <p className="text-[11px] text-muted-foreground mb-1">
            Define como o candidato verá e responderá esta pergunta.
          </p>
          <Select
            value={t}
            onValueChange={(v) => {
              // Limpa campos específicos do tipo anterior que não fazem sentido no novo
              const patch: any = { type: v };
              if (v !== "quiz" && v !== "imagem") patch.options = undefined;
              if (v !== "true_false") patch.statements = undefined;
              if (v === "true_false") {
                const hasStatements = Array.isArray(question.statements) && question.statements.length > 0;
                if (!hasStatements) {
                  patch.statements = [{ id: "s1", text: "", correct: false }];
                }
                patch.options = undefined;
              }
              onChange(patch);
            }}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="texto">Texto (dissertativa)</SelectItem>
              <SelectItem value="quiz">Quiz (alternativas com peso)</SelectItem>
              <SelectItem value="true_false">Verdadeiro / Falso</SelectItem>
              <SelectItem value="imagem">Imagem (escolha visual)</SelectItem>
              <SelectItem value="video">Vídeo (resposta gravada)</SelectItem>
              <SelectItem value="audio">Áudio (resposta gravada)</SelectItem>
              <SelectItem value="voice">Voz (gravação curta)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <div>
        <Label className="text-xs">Pergunta para o candidato</Label>
        <p className="text-[11px] text-muted-foreground mb-1">
          Escreva aqui a pergunta exatamente como o candidato verá.
        </p>
        <Textarea
          rows={2}
          value={question.prompt || question.question || ""}
          onChange={(e) => onChange({ prompt: e.target.value, question: undefined })}
          placeholder="Ex: Conte sobre uma situação em que você precisou lidar com um cliente difícil."
        />
      </div>


      {t === "quiz" && (
        <QuizOptionsEditor
          options={question.options || []}
          onChange={(opts) => onChange({ options: opts })}
        />
      )}

      {t === "true_false" && (
        <TrueFalseEditor
          statements={Array.isArray(question.statements) ? question.statements : []}
          legacyOptions={Array.isArray(question.options) ? question.options : []}
          onChange={(statements) => onChange({ statements, options: undefined })}
        />
      )}

      {t === "texto" && (
        <div className="space-y-3 rounded-md border border-dashed p-3 bg-background/50">
          <div>
            <Label className="text-xs">Resposta esperada (referência para a IA)</Label>
            <p className="text-[11px] text-muted-foreground mb-1">
              Descreva a resposta ideal. A IA usa este texto para comparar semanticamente o que o candidato responder.
            </p>
            <Textarea
              rows={3}
              value={question.expected_answer || ""}
              onChange={(e) => onChange({ expected_answer: e.target.value })}
              placeholder="Ex: O candidato deve demonstrar empatia, escutar o cliente e propor uma solução prática, mantendo a calma."
            />
          </div>
          <div>
            <Label className="text-xs">Critérios de avaliação (opcional)</Label>
            <p className="text-[11px] text-muted-foreground mb-1">
              Palavras-chave separadas por vírgula que a IA deve procurar na resposta.
            </p>
            <Input
              className="h-8"
              value={Array.isArray(question.evaluation_criteria) ? question.evaluation_criteria.join(", ") : (question.evaluation_criteria || "")}
              onChange={(e) => {
                const raw = e.target.value;
                const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
                onChange({ evaluation_criteria: list });
              }}
              placeholder="Ex: empatia, clareza, proatividade"
            />
          </div>
        </div>
      )}

      {(t === "video" || t === "audio") && (
        <div>
          <Label className="text-xs">Duração máxima (segundos)</Label>
          <Input
            type="number"
            className="w-32 h-8"
            value={question.max_duration_seconds || ""}
            onChange={(e) => onChange({ max_duration_seconds: Number(e.target.value) || undefined })}
            placeholder="120"
          />
        </div>
      )}

      {t === "imagem" && (
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Instruções adicionais</Label>
            <Input
              className="h-8"
              value={question.instructions || ""}
              onChange={(e) => onChange({ instructions: e.target.value })}
              placeholder="Ex: escolha a imagem que melhor representa a situação descrita"
            />
          </div>
          <ImageOptionsEditor
            options={Array.isArray(question.options) ? question.options : []}
            onChange={(opts) => onChange({ options: opts })}
          />
        </div>
      )}

      {t === "voice" && (
        <div>
          <Label className="text-xs">Tempo máximo de gravação (segundos)</Label>
          <Input
            type="number"
            className="w-32 h-8"
            value={question.max_seconds || ""}
            onChange={(e) => onChange({ max_seconds: Number(e.target.value) || undefined })}
            placeholder="120"
          />
        </div>
      )}

      {showWeight && (
        <div className="flex items-center gap-2">
          <Label className="text-xs">Peso da pergunta</Label>
          <Select
            value={String(question.weight ?? 2)}
            onValueChange={(v) => onChange({ weight: Number(v) })}
          >
            <SelectTrigger className="w-[110px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1 — Baixo</SelectItem>
              <SelectItem value="2">2 — Médio</SelectItem>
              <SelectItem value="3">3 — Alto</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

function QuizOptionsEditor({ options, onChange }: { options: any[]; onChange: (opts: any[]) => void }) {
  return (
    <div className="space-y-2">
      <Label className="text-xs">Alternativas (peso por resposta)</Label>
      <p className="text-[11px] text-muted-foreground">
        <strong>Alto</strong> (3) · <strong>Médio</strong> (2) · <strong>Baixo</strong> (1). O score = peso da resposta escolhida.
      </p>
      {options.map((opt, i) => {
        const currentWeight = normalizeAnswerWeight(opt);
        return (
          <div key={i} className="flex items-center gap-2">
            <Input
              className="flex-1 h-8"
              value={opt.text || ""}
              onChange={(e) => {
                const updated = [...options];
                updated[i] = { ...updated[i], text: e.target.value };
                onChange(updated);
              }}
              placeholder={`Alternativa ${i + 1}`}
            />
            <Select
              value={currentWeight}
              onValueChange={(v) => {
                const updated = [...options];
                const { correct, ...rest } = updated[i] || {};
                updated[i] = { ...rest, weight: v };
                onChange(updated);
              }}
            >
              <SelectTrigger className="w-[110px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="alto">Alto (3)</SelectItem>
                <SelectItem value="medio">Médio (2)</SelectItem>
                <SelectItem value="baixo">Baixo (1)</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button" variant="ghost" size="icon" className="h-7 w-7"
              onClick={() => onChange(options.filter((_, j) => j !== i))}
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        );
      })}
      <Button
        type="button" variant="outline" size="sm" className="text-xs h-7"
        onClick={() => onChange([...options, { text: "", weight: "medio" }])}
      >
        <Plus className="h-3 w-3 mr-1" />Alternativa
      </Button>
    </div>
  );
}

function ImageOptionsEditor({ options, onChange }: { options: any[]; onChange: (opts: any[]) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);

  const setCorrect = (idx: number) => {
    onChange(options.map((o, i) => ({ ...o, correct: i === idx })));
  };

  const removeAt = (idx: number) => {
    const next = options.filter((_, i) => i !== idx);
    if (next.length > 0 && !next.some((o) => o.correct)) next[0].correct = true;
    onChange(next);
  };

  const compressImage = async (file: File): Promise<File> => {
    // Downscale/re-encode grandes PNGs/JPEGs para caber no limite do proxy
    // (evita HTTP 413 no /sb/). Mantém proporções; alvo ~1600px lado maior.
    try {
      const bitmap = await createImageBitmap(file);
      const MAX = 1280;
      const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
      const w = Math.round(bitmap.width * scale);
      const h = Math.round(bitmap.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return file;
      ctx.drawImage(bitmap, 0, 0, w, h);
      const blob: Blob | null = await new Promise((res) =>
        canvas.toBlob((b) => res(b), "image/jpeg", 0.8)
      );

      if (!blob) return file;
      // Só usa a versão comprimida se ficou menor
      if (blob.size >= file.size) return file;
      return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
    } catch {
      return file;
    }
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const remaining = MAX_IMAGE_OPTIONS - options.length;
    if (remaining <= 0) {
      toast.error(`Máximo de ${MAX_IMAGE_OPTIONS} imagens por pergunta.`);
      return;
    }
    const toUpload = Array.from(files).slice(0, remaining);
    setUploadingIdx(options.length);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const uid = user?.id || "anon";
      const uploaded: any[] = [];
      for (const raw of toUpload) {
        if (!raw.type.startsWith("image/")) {
          toast.error(`"${raw.name}" não é uma imagem.`);
          continue;
        }
        if (raw.size > 20 * 1024 * 1024) {
          toast.error(`"${raw.name}" excede 20MB.`);
          continue;
        }
        const file = await compressImage(raw);
        const ext = (file.type === "image/jpeg" ? "jpg" : (file.name.split(".").pop() || "png"));
        const path = `${uid}/pipeline-questions/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const storage = await getStorageClient();
        const { error } = await storage.storage.from("avatars").upload(path, file, { upsert: false, contentType: file.type });
        if (error) {
          console.error("[pipeline-image-upload] falhou", {
            path,
            bucket: "avatars",
            file_type: file.type,
            file_size: file.size,
            error_name: (error as any).name,
            error_status: (error as any).status,
            error_status_code: (error as any).statusCode,
            error_message: error.message,
            error,
          });
          toast.error(`Falha ao enviar ${raw.name}: ${error.message}`);
          continue;
        }

        const { data: urlData } = storage.storage.from("avatars").getPublicUrl(path);
        uploaded.push({ image_url: urlData.publicUrl, storage_path: path, correct: false });

      }
      const merged = [...options, ...uploaded];
      if (merged.length > 0 && !merged.some((o) => o.correct)) merged[0].correct = true;
      onChange(merged);
    } finally {
      setUploadingIdx(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-dashed p-3 bg-background/50">
      <div className="flex items-center justify-between">
        <Label className="text-xs">Alternativas (imagens)</Label>
        <span className="text-[11px] text-muted-foreground">{options.length}/{MAX_IMAGE_OPTIONS}</span>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Envie até {MAX_IMAGE_OPTIONS} imagens e marque qual é a <strong>resposta correta</strong>.
      </p>

      {options.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {options.map((opt, i) => (
            <div
              key={i}
              className={`relative rounded-md border overflow-hidden bg-muted ${opt.correct ? "ring-2 ring-primary border-primary" : "border-border"}`}
            >
              <img
                src={opt.image_url}
                alt={`Alternativa ${i + 1}`}
                className="w-full h-24 object-cover"
              />
              <button
                type="button"
                onClick={() => setCorrect(i)}
                className={`absolute top-1 left-1 h-6 px-2 rounded-full text-[10px] font-semibold flex items-center gap-1 ${opt.correct ? "bg-primary text-primary-foreground" : "bg-background/80 text-foreground hover:bg-background"}`}
                title={opt.correct ? "Resposta correta" : "Marcar como correta"}
              >
                {opt.correct ? <><Check className="h-3 w-3" /> Correta</> : "Marcar"}
              </button>
              <button
                type="button"
                onClick={() => removeAt(i)}
                className="absolute top-1 right-1 h-6 w-6 rounded-full bg-background/80 hover:bg-destructive hover:text-destructive-foreground flex items-center justify-center"
                title="Remover"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => uploadFiles(e.target.files)}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full text-xs h-8"
        disabled={options.length >= MAX_IMAGE_OPTIONS || uploadingIdx !== null}
        onClick={() => inputRef.current?.click()}
      >
        {uploadingIdx !== null ? (
          <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Enviando...</>
        ) : (
          <><ImagePlus className="h-3.5 w-3.5 mr-1" /> Adicionar imagem{options.length < MAX_IMAGE_OPTIONS - 1 ? "(ns)" : ""}</>
        )}
      </Button>
    </div>
  );
}

// ============================================================
// TrueFalseEditor — caso particular de quiz com 2 alternativas fixas
// Admin escolhe qual é a correta. A correta grava weight="alto" (=100),
// a outra weight="baixo" (=0). Reusa quizScoreFromOption + pipeline-score-engine.
// ============================================================
function TrueFalseEditor({
  statements,
  legacyOptions,
  onChange,
}: {
  statements: any[];
  legacyOptions: any[];
  onChange: (statements: any[]) => void;
}) {
  // Migra formato legado (2 options [Verdadeiro, Falso] com weight) → 1 afirmativa
  const list = (() => {
    if (statements.length > 0) return statements;
    if (legacyOptions.length === 2) {
      const v = legacyOptions.find((o) => o?.text === "Verdadeiro");
      // Se "Verdadeiro" estava marcado como correto → afirmativa cuja resposta é true.
      // Sem isso, sem palpite: deixa como false por padrão.
      const correct = v?.weight === "alto";
      return [{ id: "s1", text: "", correct }];
    }
    return [{ id: "s1", text: "", correct: false }];
  })();

  const genId = () => {
    const used = new Set(list.map((s) => s.id));
    let i = list.length + 1;
    while (used.has(`s${i}`)) i++;
    return `s${i}`;
  };

  const update = (idx: number, patch: any) => {
    const next = list.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    onChange(next);
  };

  const add = () => onChange([...list, { id: genId(), text: "", correct: false }]);
  const remove = (idx: number) => {
    if (list.length <= 1) return;
    onChange(list.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-3 rounded-md border border-dashed p-3 bg-background/50">
      <div>
        <Label className="text-xs">Afirmativas (Verdadeiro / Falso)</Label>
        <p className="text-[11px] text-muted-foreground">
          Liste afirmativas sob o enunciado da pergunta. Para cada uma marque se é <strong>Verdadeira</strong> ou <strong>Falsa</strong>.
          O score é a % de afirmativas que o candidato acertar.
        </p>
      </div>

      <div className="space-y-2">
        {list.map((s, i) => (
          <div key={s.id || i} className="flex items-start gap-2">
            <span className="text-xs text-muted-foreground pt-2 w-6 shrink-0">{i + 1}.</span>
            <Textarea
              rows={2}
              className="flex-1"
              value={s.text || ""}
              onChange={(e) => update(i, { text: e.target.value })}
              placeholder={`Afirmativa ${i + 1}`}
            />
            <div className="flex flex-col gap-1 shrink-0">
              <Button
                type="button"
                size="sm"
                variant={s.correct === true ? "default" : "outline"}
                className="h-7 px-2 text-[11px]"
                onClick={() => update(i, { correct: true })}
              >
                {s.correct === true && <Check className="h-3 w-3 mr-1" />}V
              </Button>
              <Button
                type="button"
                size="sm"
                variant={s.correct === false ? "default" : "outline"}
                className="h-7 px-2 text-[11px]"
                onClick={() => update(i, { correct: false })}
              >
                {s.correct === false && <Check className="h-3 w-3 mr-1" />}F
              </Button>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => remove(i)}
              disabled={list.length <= 1}
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        ))}
      </div>

      <Button type="button" variant="outline" size="sm" className="w-full border-dashed" onClick={add}>
        <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar afirmativa
      </Button>
    </div>
  );
}
