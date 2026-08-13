export interface HelpTip {
  title: string;
  description: string;
}

export interface PageHelpData {
  pageTitle: string;
  tips: HelpTip[];
}

export const helpTips: Record<string, PageHelpData> = {
  // ===== Candidato =====
  "/home": {
    pageTitle: "Página Inicial",
    tips: [
      { title: "Resumo do processo", description: "Aqui você vê o resumo do seu processo seletivo e em que etapa está." },
      { title: "Painel de status", description: "Acompanhe cada etapa no painel de status — desde a inscrição até a contratação." },
      { title: "Onboarding", description: "Complete seu onboarding para avançar no processo. Cada passo concluído te aproxima da próxima etapa." },
    ],
  },
  "/oportunidades": {
    pageTitle: "Encontrar Vaga",
    tips: [
      { title: "Busca por cargo ou cidade", description: "Use a barra de busca para encontrar vagas pelo nome do cargo ou pela cidade." },
      { title: "Vagas perto de você", description: "A aba 'Perto' mostra vagas na sua região, usando o CEP do seu perfil." },
      { title: "Detalhes da vaga", description: "Clique em uma vaga para ver detalhes como salário, benefícios e requisitos antes de se candidatar." },
    ],
  },
  "/candidaturas": {
    pageTitle: "Candidaturas",
    tips: [
      { title: "Suas candidaturas", description: "Aqui ficam todas as vagas que você se candidatou, organizadas por data." },
      { title: "Status do processo", description: "O status mostra em que fase você está: em andamento, aprovado, Você foi aprovado nessa etapa (Aguardando documentação), reprovado, etc." },
      { title: "Continuar perguntas iniciais", description: "Se aparecer 'Continuar perguntas iniciais', clique para avançar no processo seletivo." },
    ],
  },
  "/perfil": {
    pageTitle: "Meu Perfil",
    tips: [
      { title: "Dados atualizados", description: "Mantenha seus dados sempre atualizados para que os recrutadores consigam te contatar." },
      { title: "CEP e cidade", description: "Seu CEP e cidade ajudam a encontrar vagas perto de você automaticamente." },
    ],
  },
  "/documentos": {
    pageTitle: "Meus Documentos",
    tips: [
      { title: "Hub de documentos", description: "Aqui ficam todos os checklists de documentos das suas candidaturas em um só lugar." },
      { title: "Progresso", description: "Acompanhe quantos documentos já foram enviados em cada candidatura pela barra de progresso." },
      { title: "Envie seus documentos", description: "Clique em 'Ver documentos' para enviar os arquivos de cada candidatura. Formatos aceitos: PDF, JPG e PNG." },
    ],
  },
  "/notificacoes": {
    pageTitle: "Notificações",
    tips: [
      { title: "Avisos importantes", description: "Aqui chegam avisos sobre suas candidaturas, como mudanças de status e novidades." },
      { title: "Convites para entrevista", description: "Fique atento a convites para entrevistas — eles aparecem aqui primeiro." },
    ],
  },
  "/faq": {
    pageTitle: "Dúvidas Frequentes",
    tips: [
      { title: "Respostas rápidas", description: "Encontre respostas para as dúvidas mais comuns sobre o processo seletivo." },
      { title: "Use a busca", description: "Use a barra de busca para achar o que precisa mais rápido." },
    ],
  },
  "/banco-talentos": {
    pageTitle: "Banco de Talentos",
    tips: [
      { title: "Oportunidades futuras", description: "Aqui você pode se cadastrar para receber convites de vagas futuras." },
      { title: "Convites", description: "Quando houver uma vaga compatível, você receberá um convite direto." },
    ],
  },
  "/banco-de-talentos": {
    pageTitle: "Banco de Talentos",
    tips: [
      { title: "Oportunidades futuras", description: "Aqui você pode se cadastrar para receber convites de vagas futuras." },
      { title: "Convites", description: "Quando houver uma vaga compatível, você receberá um convite direto." },
    ],
  },

  // ===== Admin =====
  "/admin": {
    pageTitle: "Painel Administrativo",
    tips: [
      { title: "Acesso rápido", description: "Acesse qualquer módulo clicando no ícone correspondente." },
      { title: "Módulos do sistema", description: "Cada módulo gerencia uma parte do sistema: vagas, candidatos, entrevistas, etc." },
    ],
  },
  "/admin/dashboard-links": {
    pageTitle: "Funil de candidaturas via link",
    tips: [
      { title: "O que é", description: "Mostra quantas candidaturas vindas de links /v/:token avançaram em cada etapa do processo." },
      { title: "Etapas", description: "Aplicou → Ativo → Teste feito → Entrevista → Aprovado → Contratado (cada uma é cumulativa)." },
      { title: "Permissões", description: "Admin e RH veem todas as unidades. Franqueado e gestor veem apenas as próprias." },
      { title: "Linhas em amber", description: "Destacam combinações com taxa de aprovação abaixo de 10% (mín. 5 candidaturas) — possível ponto de atenção." },
    ],
  },
  "/admin/analytics": {
    pageTitle: "Dashboard Analytics",
    tips: [
      { title: "Filtros avançados", description: "Use os filtros para analisar por unidade, cargo ou período específico." },
      { title: "Funil de candidatos", description: "O funil mostra quantos candidatos passam por cada etapa do processo." },
    ],
  },
  "/admin/cargos": {
    pageTitle: "Gestão de Cargos",
    tips: [
      { title: "Criar e editar cargos", description: "Crie e edite os cargos disponíveis no sistema para vincular a vagas." },
      { title: "Ativar e desativar", description: "Ative ou desative cargos conforme a necessidade da operação." },
    ],
  },
  "/admin/pipelines": {
    pageTitle: "Pipelines e Etapas",
    tips: [
      { title: "Etapas do processo", description: "Defina as etapas do processo seletivo: triagem, quiz, entrevista, etc." },
      { title: "Pipeline por cargo", description: "Cada cargo pode ter um pipeline diferente, com etapas personalizadas." },
    ],
  },
  "/admin/vagas": {
    pageTitle: "Vagas Corporativas",
    tips: [
      { title: "Vincular cargos a unidades", description: "Vincule cargos a unidades para abrir vagas e receber candidatos." },
      { title: "Salário e benefícios", description: "Defina salário, modelo de trabalho e benefícios de cada vaga." },
    ],
  },
  "/admin/unidades": {
    pageTitle: "Monitoramento Territorial",
    tips: [
      { title: "Desempenho por unidade", description: "Monitore o desempenho de cada unidade: vagas abertas, candidatos, contratações." },
      { title: "Candidatos por unidade", description: "Veja quantos candidatos cada unidade tem em cada fase do processo." },
    ],
  },
  "/admin/usuarios": {
    pageTitle: "Usuários e Permissões",
    tips: [
      { title: "Gerenciar permissões", description: "Adicione ou remova permissões dos usuários do sistema." },
      { title: "Múltiplos papéis", description: "Cada usuário pode ter mais de um papel (admin, gestor, franqueado, etc)." },
    ],
  },
  "/admin/auditoria": {
    pageTitle: "Auditoria e Logs",
    tips: [
      { title: "Histórico completo", description: "Veja tudo que foi feito no sistema, por quem e quando." },
    ],
  },
  "/admin/ia": {
    pageTitle: "Governança da IA",
    tips: [
      { title: "Avaliações da IA", description: "Veja as notas que a inteligência artificial deu aos candidatos em cada etapa." },
      { title: "Prompts e simulador", description: "Gerencie os prompts da IA e simule avaliações antes de aplicar." },
    ],
  },
  "/admin/banco-talentos": {
    pageTitle: "Banco de Talentos",
    tips: [
      { title: "Candidatos em espera", description: "Candidatos em espera ficam aqui para futuras oportunidades." },
      { title: "Matching automático", description: "Use o matching para encontrar talentos compatíveis com novas vagas." },
    ],
  },
  "/admin/plano-carreira": {
    pageTitle: "Planos de Carreira",
    tips: [
      { title: "Planos de crescimento", description: "Defina planos de crescimento para os cargos com níveis e faixas salariais." },
    ],
  },
  "/admin/agendamento": {
    pageTitle: "Agendamento",
    tips: [
      { title: "Gerenciar entrevistas", description: "Gerencie entrevistas agendadas, horários disponíveis e no-shows." },
      { title: "Horários por unidade", description: "Configure os horários de cada unidade para que candidatos possam agendar." },
    ],
  },
  "/admin/roteiros": {
    pageTitle: "Roteiros de Entrevista",
    tips: [
      { title: "Guias por cargo", description: "Crie roteiros de perguntas para entrevistas, organizados por cargo." },
      { title: "Critérios de avaliação", description: "Defina critérios de avaliação para padronizar as entrevistas." },
    ],
  },
  "/admin/documentos": {
    pageTitle: "Documentação",
    tips: [
      { title: "Checklists de documentos", description: "Solicite e valide documentos dos candidatos aprovados." },
      { title: "Auditoria de contratação", description: "Acompanhe métricas e auditoria do processo de contratação." },
    ],
  },
  "/admin/notificacoes": {
    pageTitle: "Notificações",
    tips: [
      { title: "Templates de mensagem", description: "Configure modelos de e-mail e WhatsApp para cada tipo de evento." },
      { title: "Logs de envio", description: "Acompanhe o histórico de envios e taxa de entrega." },
    ],
  },
  "/admin/configuracoes": {
    pageTitle: "Configurações Globais",
    tips: [
      { title: "Regras do sistema", description: "Ajuste regras de pontuação, automações e configurações gerais." },
      { title: "Impacto na rede", description: "Alterações aqui impactam todas as unidades da rede." },
    ],
  },
  "/admin/migracoes": {
    pageTitle: "Migrações ERP",
    tips: [
      { title: "Migração de dados", description: "Acompanhe a migração de dados dos candidatos contratados para o ERP." },
      { title: "Importar admins", description: "Importe administradores do ERP com o botão dedicado." },
    ],
  },
  "/admin/faq": {
    pageTitle: "FAQ Institucional",
    tips: [
      { title: "Perguntas frequentes", description: "Gerencie as perguntas frequentes que os candidatos veem na central de dúvidas." },
    ],
  },
  "/admin/integracoes": {
    pageTitle: "Central de Integrações",
    tips: [
      { title: "Serviços externos", description: "Configure e teste conexões com serviços externos como ERP, WhatsApp e e-mail." },
    ],
  },
};
