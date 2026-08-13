// Biblioteca curada de "traits" (gostos / atividades) usados na conversa de
// descoberta de cargo. Cada trait pertence a um eixo (o-que-faz, publico,
// ritmo, metas) e tem uma lista de palavras-chave que, se aparecerem no
// título ou descrição do cargo, indicam que aquele cargo "casa" com aquele
// gosto. É usado como FALLBACK quando o cargo não tem `discovery_traits`
// configurados pela Sede.

export type DiscoveryAxis = "atividade" | "publico" | "ritmo" | "metas";

export interface DiscoveryTrait {
  id: string;
  axis: DiscoveryAxis;
  /** Frase exibida na bolha como opção pra candidata (1ª pessoa). */
  label: string;
  /** Palavras-chave para casar com title+description quando o cargo não tem traits configurados. */
  keywords: string[];
}

export const DISCOVERY_TRAITS: DiscoveryTrait[] = [
  // Eixo: o que faz / atividade principal
  { id: "atendimento", axis: "atividade", label: "Conversar e atender pessoas", keywords: ["vendedor", "vendedora", "atendente", "atendimento", "vendas", "consultor"] },
  { id: "fotos_redes", axis: "atividade", label: "Tirar fotos e mexer com redes sociais", keywords: ["social", "mídia", "midia", "marketing", "conteúdo", "conteudo", "foto"] },
  { id: "numeros", axis: "atividade", label: "Mexer com números e fechar caixa", keywords: ["caixa", "financeiro", "operador de caixa"] },
  { id: "organizar", axis: "atividade", label: "Organizar produtos e ambiente", keywords: ["estoque", "estoquista", "logística", "logistica", "organizaç"] },
  { id: "cuidar_criancas", axis: "atividade", label: "Cuidar e avaliar com carinho (crianças/bebês)", keywords: ["avaliador", "avaliadora", "triagem", "infantil", "bebê", "bebe"] },
  { id: "limpeza_apoio", axis: "atividade", label: "Cuidar do ambiente e dar suporte à equipe", keywords: ["serviços gerais", "servicos gerais", "limpeza", "apoio"] },

  // Eixo: público / com quem trabalha
  { id: "pub_clientes", axis: "publico", label: "Direto com clientes na loja", keywords: ["vendedor", "atendente", "atendimento", "caixa", "consultor"] },
  { id: "pub_equipe", axis: "publico", label: "Mais com a equipe interna", keywords: ["administrativo", "estoque", "rh", "financeiro"] },
  { id: "pub_online", axis: "publico", label: "Mais com o público online", keywords: ["social", "mídia", "midia", "marketing", "conteúdo", "conteudo"] },

  // Eixo: ritmo do dia
  { id: "rit_movimentado", axis: "ritmo", label: "Dia movimentado, sempre em pé", keywords: ["vendedor", "atendente", "estoque", "caixa", "serviços gerais"] },
  { id: "rit_focado", axis: "ritmo", label: "Dia mais focado, com calma pra pensar", keywords: ["administrativo", "social", "mídia", "midia", "financeiro", "marketing"] },

  // Eixo: metas
  { id: "metas_sim", axis: "metas", label: "Curto ter meta clara pra bater", keywords: ["vendedor", "vendas", "consultor"] },
  { id: "metas_processo", axis: "metas", label: "Prefiro entregar bem no dia a dia", keywords: ["administrativo", "estoque", "caixa", "serviços gerais", "avaliador", "avaliadora", "social"] },
];

export const AXIS_PROMPTS: Record<DiscoveryAxis, string> = {
  atividade: "Pra começar — o que você mais curte fazer no dia a dia?",
  publico: "E com quem você prefere passar o seu tempo no trabalho?",
  ritmo: "Como você prefere que seja o ritmo do seu dia?",
  metas: "E quanto a meta — o que combina mais com você?",
};
