/**
 * Fonte ÚNICA de verdade para o status apresentado de um candidato.
 *
 * Regra (decidida com o usuário):
 *   1) applications.status TERMINAL/inativo vence sempre.
 *      (standby, contratado, desligado, desistente, reprovado, pausado)
 *   2) applications.status ATIVO + entrevista ativa/final
 *      → exibe o estado da entrevista, nunca "Aprovado" antes da decisão manual.
 *   3) Caso contrário, exibe applications.status e suas variantes derivadas de
 *      documentação / teste pós-entrevista (apenas quando 'aprovado').
 *
 * IMPORTANTE: esta função NÃO faz fetch. Cada tela passa as entrevistas/docs
 * que já carrega via seus hooks atuais.
 */

export type CandidateStatusCode =
  | "pendente"
  | "em_andamento"
  | "apto_para_vaga"
  | "em_avaliacao"
  | "aprovado"
  | "aprovado_em_teste_pos_entrevista"
  | "aprovado_pendente_documentacao"
  | "aprovado_aguardando_aprovacao_docs"
  | "aprovado_docs_ok"
  | "contratado"
  | "standby"
  | "reprovado"
  | "desistente"
  | "desligado"
  | "declinado"
  | "pausado"
  | "pending_approval"
  | "confirmed"
  | "rescheduled"
  | "reschedule_requested"
  | "no_show"
  | "completed";

export const ACTIVE_APP_STATUSES = new Set<string>([
  "pendente",
  "em_andamento",
  "em_avaliacao",
  "apto_para_vaga",
  "aprovado",
]);

export const TERMINAL_APP_STATUSES = new Set<string>([
  "standby",
  "contratado",
  "desligado",
  "desistente",
  "declinado",
  "reprovado",
  "pausado",
]);

export interface CandidateStatusVisual {
  /** Código resolvido (pode ser app status, variante derivada ou estado de entrevista). */
  code: CandidateStatusCode | string;
  label: string;
  /** Para uso com <Badge className={...}> — bordas e fundos completos. */
  className: string;
  /** Cor do "ponto" indicador (top-right do card). */
  dotClassName: string;
  /** Variante shadcn para <Badge variant={...}>. */
  variant: "default" | "secondary" | "destructive" | "outline";
  /**
   * Indica se o rótulo veio de um estado FINAL de entrevista
   * (no_show/completed) que sobrescreveu um app.status ativo.
   */
  fromInterview: boolean;
}

export const STATUS_CONFIG: Record<string, Omit<CandidateStatusVisual, "code" | "fromInterview">> = {
  pendente: {
    label: "Pendente",
    className: "bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-700",
    dotClassName: "bg-blue-500",
    variant: "secondary",
  },
  em_andamento: {
    label: "Em andamento",
    className: "bg-warning/10 text-warning border-warning/20",
    dotClassName: "bg-warning",
    variant: "secondary",
  },
  apto_para_vaga: {
    label: "Apto para vaga",
    className: "bg-teal-100 text-teal-700 border-teal-300 dark:bg-teal-900/30 dark:text-teal-400 dark:border-teal-700",
    dotClassName: "bg-teal-500",
    variant: "secondary",
  },
  em_avaliacao: {
    label: "Em Avaliação",
    className: "bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-900/30 dark:text-purple-400 dark:border-purple-700",
    dotClassName: "bg-purple-500",
    variant: "secondary",
  },
  aprovado: {
    label: "Aprovado",
    className: "bg-success/10 text-success border-success/20",
    dotClassName: "bg-emerald-500",
    variant: "default",
  },
  aprovado_em_teste_pos_entrevista: {
    label: "Em teste pós-entrevista",
    className: "bg-indigo-100 text-indigo-700 border-indigo-300 dark:bg-indigo-900/30 dark:text-indigo-400 dark:border-indigo-700",
    dotClassName: "bg-indigo-500",
    variant: "secondary",
  },
  aprovado_pendente_documentacao: {
    label: "Você foi aprovado nessa etapa (Aguardando documentação)",
    className: "bg-yellow-100 text-yellow-700 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-700",
    dotClassName: "bg-yellow-500",
    variant: "secondary",
  },
  aprovado_aguardando_aprovacao_docs: {
    label: "Verificar documentos anexados",
    className: "bg-yellow-100 text-yellow-700 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-700",
    dotClassName: "bg-yellow-500",
    variant: "secondary",
  },
  aprovado_docs_ok: {
    label: "Pronto para contratar",
    className: "bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-700",
    dotClassName: "bg-emerald-500",
    variant: "default",
  },
  contratado: {
    label: "Contratado",
    className: "bg-primary/10 text-primary border-primary/20",
    dotClassName: "bg-primary",
    variant: "default",
  },
  standby: {
    label: "Standby",
    className: "bg-yellow-100 text-yellow-700 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-700",
    dotClassName: "bg-yellow-500",
    variant: "outline",
  },
  reprovado: {
    label: "Lista de Oportunidade",
    className: "bg-yellow-100 text-yellow-700 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-700",
    dotClassName: "bg-yellow-500",
    variant: "outline",
  },
  desligado: {
    label: "Desligado",
    className: "bg-rose-100 text-rose-700 border-rose-300 dark:bg-rose-900/30 dark:text-rose-400 dark:border-rose-700",
    dotClassName: "bg-rose-500",
    variant: "destructive",
  },
  desistente: {
    label: "Desistente",
    className: "bg-muted text-muted-foreground border-border",
    dotClassName: "bg-muted-foreground",
    variant: "outline",
  },
  declinado: {
    label: "Declinou a vaga",
    className: "bg-muted text-muted-foreground border-border",
    dotClassName: "bg-muted-foreground",
    variant: "outline",
  },
  pausado: {
    label: "Pausado",
    className: "bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700",
    dotClassName: "bg-amber-500",
    variant: "outline",
  },
  // Estados de entrevista que podem sobrescrever um app ativo
  pending_approval: {
    label: "Aguardando aprovação",
    className: "bg-yellow-100 text-yellow-700 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-700",
    dotClassName: "bg-yellow-500",
    variant: "secondary",
  },
  confirmed: {
    label: "Entrevista agendada",
    className: "bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-700",
    dotClassName: "bg-blue-500",
    variant: "secondary",
  },
  rescheduled: {
    label: "Entrevista remarcada",
    className: "bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-700",
    dotClassName: "bg-blue-500",
    variant: "secondary",
  },
  reschedule_requested: {
    label: "Aguardando remarcação",
    className: "bg-yellow-100 text-yellow-700 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-700",
    dotClassName: "bg-yellow-500",
    variant: "secondary",
  },
  no_show: {
    label: "Não compareceu",
    className: "bg-red-100 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-400 dark:border-red-700",
    dotClassName: "bg-red-500",
    variant: "destructive",
  },
  completed: {
    label: "Entrevista concluída",
    className: "bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-700",
    dotClassName: "bg-emerald-500",
    variant: "default",
  },
};

export interface GetCandidateStatusArgs {
  application: { status?: string | null } | null | undefined;
  /** Lista (ou única) de entrevistas vinculadas. Pode ser omitida. */
  interviews?: Array<{ status?: string | null }> | { status?: string | null } | null;
  docContext?: {
    docTotal?: number;
    docApproved?: number;
    docUploaded?: number;
    hasPostInterviewTestAssigned?: boolean;
  };
}

const INTERVIEW_DISPLAY_STATES = new Set<string>([
  "pending_approval",
  "confirmed",
  "rescheduled",
  "reschedule_requested",
  "no_show",
  "completed",
]);

function pickInterviewDisplayStatus(
  interviews: GetCandidateStatusArgs["interviews"],
): string | null {
  if (!interviews) return null;
  const list = Array.isArray(interviews) ? interviews : [interviews];
  // Última entrevista relevante encontrada vence (assume-se ordem por data crescente
  // na maioria dos hooks; se vier desordenado, ainda evita exibir "Aprovado" indevido).
  for (let i = list.length - 1; i >= 0; i--) {
    const st = list[i]?.status;
    if (st && INTERVIEW_DISPLAY_STATES.has(st)) return st;
  }
  return null;
}

export function getCandidateStatus(args: GetCandidateStatusArgs): CandidateStatusVisual {
  const appStatus = args.application?.status || "em_andamento";

  // 1) Terminais/inativos vencem sempre.
  if (TERMINAL_APP_STATUSES.has(appStatus)) {
    const cfg = STATUS_CONFIG[appStatus] ?? STATUS_CONFIG.em_andamento;
    return { code: appStatus, fromInterview: false, ...cfg };
  }

  // 2) App ativo + entrevista ativa/final → estado da entrevista.
  if (ACTIVE_APP_STATUSES.has(appStatus)) {
    const interviewStatus = pickInterviewDisplayStatus(args.interviews);
    if (interviewStatus) {
      const cfg = STATUS_CONFIG[interviewStatus] ?? STATUS_CONFIG.em_andamento;
      return { code: interviewStatus, fromInterview: true, ...cfg };
    }
  }

  // 3) Variantes derivadas para 'aprovado' (docs / teste pós-entrevista).
  if (appStatus === "aprovado" && args.docContext) {
    const { docTotal = 0, docApproved = 0, docUploaded = 0, hasPostInterviewTestAssigned = false } =
      args.docContext;
    let derived = "aprovado";
    if (hasPostInterviewTestAssigned && docTotal === 0) {
      derived = "aprovado_em_teste_pos_entrevista";
    } else if (docTotal > 0) {
      if (docApproved >= docTotal) derived = "aprovado_docs_ok";
      else if (docUploaded >= docTotal) derived = "aprovado_aguardando_aprovacao_docs";
      else derived = "aprovado_pendente_documentacao";
    }
    const cfg = STATUS_CONFIG[derived] ?? STATUS_CONFIG.aprovado;
    return { code: derived, fromInterview: false, ...cfg };
  }

  // 4) Padrão: app.status literal.
  const cfg = STATUS_CONFIG[appStatus] ?? STATUS_CONFIG.em_andamento;
  return { code: appStatus, fromInterview: false, ...cfg };
}
