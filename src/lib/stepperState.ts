/**
 * stepperState.ts — FONTE ÚNICA de verdade para o stepper de candidatura.
 *
 * Função pura, sem efeitos colaterais. Recebe os sinais brutos e retorna
 * o estado visual final dos 5 estágios genéricos + cores das linhas.
 *
 * REGRA DE OURO: TODA decisão visual do stepper vive aqui. NÃO adicione
 * `if`s de status no componente — adicione regras nesta função e cubra
 * com teste em `__tests__/stepperState.test.ts`.
 */
import type { PhaseStatus } from "@/hooks/useApplicationStatus";

export type GenericStage =
  | "Inscrição"
  | "Avaliação"
  | "Entrevista"
  | "Documentação"
  | "Resultado";

export const GENERIC_STAGES: GenericStage[] = [
  "Inscrição",
  "Avaliação",
  "Entrevista",
  "Documentação",
  "Resultado",
];

export type StageStatus = PhaseStatus["status"]; // 'completed' | 'current' | 'future' | 'rejected'

export interface GenericStageData {
  name: GenericStage;
  status: StageStatus;
  subPhases: { name: string; status: StageStatus }[];
}

export type LineColor = "green" | "yellow" | "gray";

export type RestartMode = "triagem" | "teste" | "entrevista" | "documentacao" | "last_valid";

export interface StepperInput {
  appStatus: string; // 'em_andamento' | 'em_avaliacao' | 'aprovado' | 'apto_para_vaga' | 'contratado' | 'reprovado' | 'standby' | ...
  pipelinePhases: PhaseStatus[];
  docs: {
    total: number;
    sent: number;
    pending: number;
    hasOpenRequest: boolean;
  };
  interviews: { has: boolean; allDone: boolean; decisionRejected: boolean; hadCancelled?: boolean; hasApprovedDecision?: boolean };
  tests: { has: boolean; allDone: boolean };
  /** Modo de reativação do ciclo ATIVO. Quando definido, força o stepper a refletir a etapa escolhida pelo recrutador. */
  restartMode?: RestartMode | null;
}

export interface StepperOutput {
  stages: GenericStageData[];
  /** Cor da linha ENTRE stages[i] e stages[i+1]. Tamanho = stages.length - 1. */
  lineColors: LineColor[];
}

const FRIENDLY_PHASE_NAMES: Record<string, string> = {
  "Triagem IA": "Análise do perfil",
  "Triagem": "Análise do perfil",
  "Avaliação Gestor": "Avaliação pela equipe",
  "Avaliacao Gestor": "Avaliação pela equipe",
  "Quiz Técnico": "Questionário técnico",
  "Quiz Tecnico": "Questionário técnico",
  "Entrevista Presencial": "Entrevista presencial",
  "Entrevista Online": "Entrevista online",
  "Documentação Admissional": "Documentos admissionais",
  "Documentacao Admissional": "Documentos admissionais",
  "Resultado Final": "Decisão final",
};

function friendlyPhaseName(name: string): string {
  if (FRIENDLY_PHASE_NAMES[name]) return FRIENDLY_PHASE_NAMES[name];
  return (
    name
      .replace(/\b(IA|Gestor|Admin|Sistema|Bot|Automático|Automatico)\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim() || name
  );
}

export function classifyPhase(name: string): GenericStage {
  const lower = name.toLowerCase();
  if (
    lower.includes("inscri") ||
    lower.includes("cadastro") ||
    lower.includes("candidatura")
  )
    return "Inscrição";
  if (lower.includes("entrevista") || lower.includes("interview"))
    return "Entrevista";
  if (lower.includes("document") || lower.includes("admiss"))
    return "Documentação";
  if (
    lower.includes("resultado") ||
    lower.includes("decisão") ||
    lower.includes("decisao") ||
    lower.includes("contrata") ||
    lower.includes("final")
  )
    return "Resultado";
  return "Avaliação";
}

/**
 * Função pura — fonte única de verdade do stepper.
 */
export function computeStepperState(input: StepperInput): StepperOutput {
  const { appStatus, pipelinePhases, docs, interviews, tests } = input;

  const isContratado = appStatus === "contratado";
  const isAprovado = appStatus === "aprovado" || appStatus === "apto_para_vaga";
  // Saída terminal do funil: qualquer destes anula completed/current das fases finais.
  const isReprovado =
    appStatus === "reprovado" ||
    appStatus === "standby" ||
    appStatus === "desligado" ||
    appStatus === "desistente" ||
    appStatus === "declinado";
  const isExited = isReprovado;

  // 1) Distribuir subfases do pipeline por estágio genérico (apenas para detalhe expandido).
  const subPhases: Record<GenericStage, { name: string; status: StageStatus }[]> = {
    "Inscrição": [],
    "Avaliação": [],
    "Entrevista": [],
    "Documentação": [],
    "Resultado": [],
  };
  for (const p of pipelinePhases) {
    const stage = classifyPhase(p.name);
    subPhases[stage].push({ name: friendlyPhaseName(p.name), status: p.status });
  }
  if (subPhases["Inscrição"].length === 0) {
    subPhases["Inscrição"].push({ name: "Candidatura enviada", status: "completed" });
  }

  // 2) Status base de cada estágio (regras explícitas, na ordem).
  const status: Record<GenericStage, StageStatus> = {
    "Inscrição": "completed", // sempre — se há application, inscrição feita
    "Avaliação": "future",
    "Entrevista": "future",
    "Documentação": "future",
    "Resultado": "future",
  };

  // Avaliação
  if (isContratado || isAprovado) {
    status["Avaliação"] = "completed";
  } else if (isReprovado && !interviews.has && !docs.hasOpenRequest) {
    // Reprovado já na avaliação (sem entrevista nem docs depois)
    status["Avaliação"] = "rejected";
  } else if (tests.has && tests.allDone) {
    status["Avaliação"] = "completed";
  } else if (tests.has) {
    status["Avaliação"] = "current";
  } else if (appStatus === "em_avaliacao") {
    status["Avaliação"] = "current";
  } else {
    status["Avaliação"] = "current"; // default quando ainda não há nada decidido
  }

  // Entrevista — exige evidência de DECISÃO manual do recrutador.
  // status='completed' em `interviews` significa apenas "presença registrada".
  const hasApprovedDecision = interviews.hasApprovedDecision === true;
  if (interviews.decisionRejected) {
    status["Entrevista"] = "rejected";
  } else if (isReprovado && interviews.has) {
    status["Entrevista"] = "rejected";
  } else if (isContratado) {
    status["Entrevista"] = "completed";
  } else if (interviews.has && interviews.allDone && hasApprovedDecision) {
    status["Entrevista"] = "completed";
  } else if (interviews.has && interviews.allDone && !hasApprovedDecision) {
    // Entrevista realizada (comparecimento registrado) mas ainda aguardando
    // decisão do recrutador (aprovado/standby). NÃO marcar como completed.
    status["Entrevista"] = "current";
  } else if (interviews.has) {
    status["Entrevista"] = "current";
  } else if (interviews.hadCancelled) {
    // Havia entrevista, foi cancelada e nada ativo no lugar → volta a pendente.
    status["Entrevista"] = "current";
  } else {
    status["Entrevista"] = "future";
  }

  // Documentação — exige solicitação real (não inferir a partir de appStatus='aprovado').
  if (interviews.decisionRejected) {
    status["Documentação"] = docs.total > 0 || docs.hasOpenRequest ? "rejected" : "future";
  } else if (isContratado) {
    status["Documentação"] = "completed";
  } else if (isReprovado) {
    status["Documentação"] = docs.total > 0 || docs.hasOpenRequest ? "rejected" : "future";
  } else if (docs.total > 0 && docs.pending === 0 && !docs.hasOpenRequest) {
    status["Documentação"] = "completed";
  } else if (docs.pending > 0 || docs.hasOpenRequest) {
    status["Documentação"] = "current";
  } else {
    status["Documentação"] = "future";
  }

  // Resultado — só conclui quando contratado. Vira `current` apenas com evidência
  // real de que documentação foi finalizada (não basta ser 'aprovado').
  if (isContratado) {
    status["Resultado"] = "completed";
  } else if (interviews.decisionRejected || isReprovado) {
    status["Resultado"] = "rejected";
  } else if (
    isAprovado &&
    docs.total > 0 &&
    docs.pending === 0 &&
    !docs.hasOpenRequest
  ) {
    // Docs efetivamente aprovados → aguardando contratação final.
    status["Resultado"] = "current";
  } else {
    status["Resultado"] = "future";
  }

  // 2.5) Saída terminal: candidato fora do funil (reprovado/standby/desligado/desistente)
  // não pode exibir verde/atual em fases POSTERIORES à saída. Força "rejected" onde havia
  // resíduo de histórico (entrevistas antigas, docs antigos) e não promove fases futuras.
  if (isExited && !isContratado) {
    for (const s of ["Entrevista", "Documentação", "Resultado"] as GenericStage[]) {
      if (status[s] === "completed" || status[s] === "current") {
        status[s] = "rejected";
      }
    }
  }

  // 3) Consistência sequencial: só promove future→completed quando o candidato
  // foi efetivamente contratado. Em qualquer outro caso, cada estágio precisa
  // de evidência própria — sem contágio entre fases.
  if (isContratado) {
    for (let i = 0; i < GENERIC_STAGES.length; i++) {
      if (status[GENERIC_STAGES[i]] === "future") {
        status[GENERIC_STAGES[i]] = "completed";
      }
    }
  }

  // 3.5) Override por restart_mode do ciclo ativo. Quando o recrutador
  // reativa a candidatura escolhendo uma etapa específica, o stepper PRECISA
  // refletir essa escolha — independente de o pipeline do cargo ter ou não
  // fases nominais para entrevista/documentação. Não se aplica a estados
  // terminais nem ao modo `last_valid` (que restaura o estado anterior).
  if (
    input.restartMode &&
    input.restartMode !== "last_valid" &&
    !isExited &&
    !isContratado
  ) {
    const mode = input.restartMode;
    if (mode === "triagem" || mode === "teste") {
      status["Inscrição"] = "completed";
      status["Avaliação"] = "current";
      status["Entrevista"] = "future";
      status["Documentação"] = "future";
      status["Resultado"] = "future";
    } else if (mode === "entrevista") {
      status["Inscrição"] = "completed";
      status["Avaliação"] = "completed";
      // Se já existe interview agendada/realizada, deixa a derivação natural valer
      if (!interviews.has) {
        status["Entrevista"] = "current";
      }
      status["Documentação"] = "future";
      status["Resultado"] = "future";
    } else if (mode === "documentacao") {
      status["Inscrição"] = "completed";
      status["Avaliação"] = "completed";
      status["Entrevista"] = "completed";
      // Se já há request de docs aberto, derivação natural já marcou current
      if (!docs.hasOpenRequest && docs.total === 0) {
        status["Documentação"] = "current";
      }
      status["Resultado"] = "future";
    }
  }

  // 4) Cores das linhas — função pura sobre os pares.
  const lineColors: LineColor[] = [];
  for (let i = 0; i < GENERIC_STAGES.length - 1; i++) {
    const a = status[GENERIC_STAGES[i]];
    const b = status[GENERIC_STAGES[i + 1]];
    const aReached = a === "completed" || a === "current";
    const bReached = b === "completed" || b === "current";
    if (!aReached || !bReached) {
      lineColors.push("gray");
      continue;
    }
    // Ambos atingidos. Se algum dos dois é "current" e o motivo é doc pendente,
    // a linha fica amarela. Caso contrário, verde.
    const docsZone = a === "current" || b === "current";
    if (docsZone && docs.pending > 0) {
      lineColors.push("yellow");
    } else {
      lineColors.push("green");
    }
  }

  const stages: GenericStageData[] = GENERIC_STAGES.map((name) => ({
    name,
    status: status[name],
    subPhases: subPhases[name],
  }));

  return { stages, lineColors };
}
