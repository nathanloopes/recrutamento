/**
 * Camada centralizada de mensagens para o usuário (PT-BR).
 * Nunca expõe nomes de tabelas, colunas, migrations ou stack traces.
 * Erros técnicos reais são logados apenas no console (dev).
 */

export const SETTINGS_MESSAGES = {
  saveSuccess: {
    title: "Configurações salvas",
    description: "Suas alterações foram aplicadas com sucesso.",
  },
  saveError: {
    title: "Não foi possível salvar",
    description: "Ocorreu um erro ao salvar as configurações. Tente novamente.",
  },
  updateSuccess: {
    title: "Alteração realizada",
    description: "As informações foram atualizadas.",
  },
  deleteSuccess: {
    title: "Item removido",
    description: "O item foi excluído com sucesso.",
  },
  createSuccess: {
    title: "Cadastro realizado",
    description: "O item foi criado com sucesso.",
  },
  permissionDenied: {
    title: "Permissão negada",
    description: "Você não tem permissão para realizar esta ação.",
  },
  networkError: {
    title: "Sem conexão",
    description: "Verifique sua internet e tente novamente.",
  },
  sessionExpired: {
    title: "Sessão expirada",
    description: "Faça login novamente para continuar.",
  },
  duplicate: {
    title: "Registro duplicado",
    description: "Já existe um item com essas informações.",
  },
  validation: {
    title: "Dados inválidos",
    description: "Revise as informações e tente novamente.",
  },
  generic: {
    title: "Não foi possível concluir a ação",
    description: "Tente novamente em instantes.",
  },
} as const;

/**
 * Textos-padrão de justificativa para decisões do recrutador.
 * Linguagem neutra (sem flexão de gênero). Servem como pré-preenchimento
 * editável: o recrutador pode enviar como está ou ajustar antes de confirmar.
 */
export const DEFAULT_INTERVIEW_APPROVE_REASON =
  "Parabéns! Seu desempenho na entrevista foi positivo e você avançou para a próxima etapa do processo seletivo. Em breve enviaremos as instruções dos próximos passos.";

export const DEFAULT_INTERVIEW_STANDBY_REASON =
  "Agradecemos sua participação no processo. No momento, optamos por seguir com outros perfis para esta vaga, mas seu currículo permanece em nosso banco de talentos e poderá ser considerado em futuras oportunidades compatíveis com seu perfil.";

export const DEFAULT_POST_EVALUATION_STANDBY_REASON =
  "Agradecemos sua participação até aqui. Após a avaliação, seu perfil ficou em standby para esta vaga, mas seu cadastro continua ativo em nosso banco de talentos para futuras oportunidades.";

export const DEFAULT_DOCUMENT_REJECTION_REASON =
  "O documento enviado não está legível ou apresenta divergências. Por favor, envie uma nova versão clara e completa para darmos sequência ao processo.";

export const DEFAULT_FRANCHISEE_RELEASE_REASON =
  "Candidato liberado pela unidade. O perfil volta ao pool e fica disponível para outras unidades.";

export const DEFAULT_CLOSE_PROCESS_REASON =
  "Agradecemos sua participação no processo seletivo. Nesta oportunidade, optamos por encerrar sua candidatura, mas seu cadastro permanece em nosso banco de talentos para futuras vagas compatíveis com seu perfil.";

/**
 * Converte qualquer erro (Supabase / Postgres / Edge Function / Network)
 * em uma mensagem amigável em PT-BR. Loga o erro técnico no console.
 */
export function humanizeError(error: unknown, context?: string): string {
  // Log técnico (dev/console) — nunca exposto ao usuário.
  // eslint-disable-next-line no-console
  console.error(`[UserError]${context ? ` ${context}:` : ""}`, error);

  const raw =
    typeof error === "string"
      ? error
      : (error as any)?.message || (error as any)?.error_description || "";

  const msg = String(raw).toLowerCase();

  if (!msg) return SETTINGS_MESSAGES.generic.description;

  // Códigos PostgREST / Postgres
  if (
    /pgrst\d+/i.test(msg) ||
    msg.includes("relation ") ||
    msg.includes("schema ") ||
    msg.includes("does not exist") ||
    /\b(42p01|42703|22p02|23502|23503|23505|23514|p0001)\b/.test(msg)
  ) {
    // 23505 = unique violation
    if (msg.includes("23505") || msg.includes("duplicate")) {
      return SETTINGS_MESSAGES.duplicate.description;
    }
    // 42P01 / 42703 = relation/column not found — vazamento técnico
    if (/\b(42p01|42703)\b/.test(msg) || msg.includes("does not exist")) {
      return SETTINGS_MESSAGES.generic.description;
    }
    if (/\b(23502|23503|23514|22p02)\b/.test(msg)) {
      return SETTINGS_MESSAGES.validation.description;
    }
  }

  // Edge Function — non-2xx / FunctionsHttpError
  if (
    msg.includes("functionshttperror") ||
    msg.includes("non-2xx") ||
    msg.includes("edge function returned")
  ) {
    return SETTINGS_MESSAGES.generic.description;
  }

  // Rede / timeout
  if (
    msg.includes("failed to fetch") ||
    msg.includes("network") ||
    msg.includes("networkerror") ||
    msg.includes("timeout") ||
    msg.includes("timed out")
  ) {
    return SETTINGS_MESSAGES.networkError.description;
  }

  // Sessão / auth
  if (
    msg.includes("jwt") ||
    msg.includes("invalid token") ||
    msg.includes("not authenticated") ||
    msg.includes("auth session")
  ) {
    return SETTINGS_MESSAGES.sessionExpired.description;
  }

  // Permissão / RLS
  if (
    msg.includes("permission denied") ||
    msg.includes("not allowed") ||
    msg.includes("forbidden") ||
    msg.includes("rls") ||
    msg.includes("row-level security") ||
    msg.includes("row level security")
  ) {
    return SETTINGS_MESSAGES.permissionDenied.description;
  }

  // Duplicidade
  if (
    msg.includes("duplicate key") ||
    msg.includes("already exists") ||
    msg.includes("unique constraint")
  ) {
    return SETTINGS_MESSAGES.duplicate.description;
  }

  // Validação / FK / coluna
  if (
    msg.includes("foreign key") ||
    msg.includes("violates") ||
    msg.includes("column") ||
    msg.includes("invalid input") ||
    msg.includes("null value") ||
    msg.includes("check constraint")
  ) {
    return SETTINGS_MESSAGES.validation.description;
  }

  // Mensagens já em português podem passar quando explicitamente lançadas no app
  // (ex: "Justificativa obrigatória..."). Heurística simples: contém acentos
  // ou palavras comuns em PT-BR.
  const looksPortuguese =
    /[áàâãéêíóôõúç]/i.test(raw) ||
    /\b(não|você|está|configura|usuário|senha|justificativa|obrigatóri|inválid|permiss)/i.test(
      raw,
    );

  if (looksPortuguese && raw.length < 200) {
    return raw;
  }

  return SETTINGS_MESSAGES.generic.description;
}
