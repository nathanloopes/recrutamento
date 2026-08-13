/**
 * Fonte única de verdade para detectar se uma fase do pipeline contém um
 * "teste executável" pelo candidato.
 *
 * Regra (v6.2):
 *  - Fase deve ter `phase_kind === 'avaliacao'` e estar ativa.
 *  - Pelo menos um step da fase deve ter perguntas executáveis:
 *      • modelo novo: `content.questions[]` não-vazio
 *      • legado single-pergunta: `content.prompt` ou `content.question`
 *      • legado por tipo: `step.type` em EXECUTABLE_STEP_TYPES
 *
 * Usado por:
 *   - src/lib/testResolver.ts        (decide rota /triagem vs /testes)
 *   - src/hooks/useApplicationStatus (decide se mostra "Realizar teste"
 *     vs "Aguardando avaliação" no card de candidatura)
 *
 * Mantenha as duas pontas alinhadas usando este módulo. NÃO duplicar a
 * lógica em outros arquivos.
 */

const EXECUTABLE_STEP_TYPES = new Set([
  "quiz",
  "texto",
  "text",
  "essay",
  "voice",
  "voice_question",
  "entrevista_voz",
  "imagem",
  "video",
  "audio",
  "scenario",
  "scale",
  "multiple_choice",
  "true_false",
]);

export function stepHasQuestions(step: any): boolean {
  if (!step) return false;
  const content = step.content || {};
  if (Array.isArray(content.questions) && content.questions.length > 0) return true;
  if (typeof content.prompt === "string" && content.prompt.trim()) return true;
  if (typeof content.question === "string" && content.question.trim()) return true;
  const type = String(step.type || step.step_type || "").toLowerCase();
  if (EXECUTABLE_STEP_TYPES.has(type)) return true;
  return false;
}

export function findPipelineTestPhase(phases: any[]): any | null {
  if (!Array.isArray(phases)) return null;
  const active = phases
    .filter((p: any) => p && p.is_active !== false)
    .slice()
    .sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0));
  return (
    active.find((p: any) => {
      const kind = p.phase_kind || "avaliacao";
      if (kind !== "avaliacao" && kind !== "avaliacao_pos_entrevista") return false;
      const steps = (p.pipeline_steps || []) as any[];
      return steps.some(stepHasQuestions);
    }) || null
  );
}
