// Dados fictícios (pt-BR) para o modo demonstração / portfólio.
// Nomes, CPFs e informações são inventados. Nenhum dado real.

export const DEMO_CANDIDATE_ID = "11111111-1111-4111-8111-111111111111";
export const DEMO_ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const now = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (d: number) => new Date(now - d * DAY).toISOString();

// ─── Unidades / franquias ────────────────────────────────────────────────
const units = [
  { id: "unit-matriz", name: "Matriz (Franqueadora)", city: "São Paulo", state: "SP", is_franqueadora: true, is_active: true, created_at: daysAgo(400) },
  { id: "unit-pinheiros", name: "Loja Pinheiros", city: "São Paulo", state: "SP", is_franqueadora: false, is_active: true, created_at: daysAgo(300) },
  { id: "unit-copacabana", name: "Loja Copacabana", city: "Rio de Janeiro", state: "RJ", is_franqueadora: false, is_active: true, created_at: daysAgo(250) },
  { id: "unit-savassi", name: "Loja Savassi", city: "Belo Horizonte", state: "MG", is_franqueadora: false, is_active: true, created_at: daysAgo(200) },
];

// ─── Cargos / vagas ──────────────────────────────────────────────────────
const jobs = [
  { id: "job-atendente", code: "ATD", title: "Atendente de Loja", category: "Operacional", description: "Atendimento ao cliente, organização de produtos e apoio ao caixa.", is_active: true, requires_ai_interview: true, requires_human_interview: true, allows_career_plan: true, department_id: null, benefits: ["Vale-transporte", "Vale-refeição", "Plano de saúde"], responsibilities: ["Atender clientes", "Organizar prateleiras", "Repor estoque"], requirements: ["Ensino médio completo", "Boa comunicação"], discovery_traits: ["comunicacao", "proatividade"] },
  { id: "job-vendedor", code: "VND", title: "Vendedor(a)", category: "Comercial", description: "Venda consultiva, metas mensais e relacionamento com o cliente.", is_active: true, requires_ai_interview: true, requires_human_interview: true, allows_career_plan: true, department_id: null, benefits: ["Comissão", "Vale-transporte", "Vale-refeição"], responsibilities: ["Bater metas", "Atendimento consultivo"], requirements: ["Experiência com vendas", "Perfil comunicativo"], discovery_traits: ["persuasao", "resiliencia"] },
  { id: "job-estoquista", code: "EST", title: "Estoquista", category: "Operacional", description: "Recebimento, conferência e organização de mercadorias no estoque.", is_active: true, requires_ai_interview: true, requires_human_interview: false, allows_career_plan: false, department_id: null, benefits: ["Vale-transporte", "Vale-refeição"], responsibilities: ["Conferir mercadorias", "Organizar estoque (FIFO)"], requirements: ["Ensino fundamental completo", "Organização"], discovery_traits: ["organizacao", "atencao"] },
  { id: "job-caixa", code: "CX", title: "Operador(a) de Caixa", category: "Operacional", description: "Operação de caixa, conferência de valores e atendimento no PDV.", is_active: true, requires_ai_interview: true, requires_human_interview: true, allows_career_plan: true, department_id: null, benefits: ["Vale-transporte", "Vale-refeição", "Plano de saúde"], responsibilities: ["Operar caixa", "Fechar valores"], requirements: ["Ensino médio completo", "Atenção a detalhes"], discovery_traits: ["atencao", "honestidade"] },
  { id: "job-supervisor", code: "SUP", title: "Supervisor(a) de Loja", category: "Liderança", description: "Coordenação da equipe de loja, metas e indicadores operacionais.", is_active: true, requires_ai_interview: true, requires_human_interview: true, allows_career_plan: true, department_id: null, benefits: ["Comissão", "Plano de saúde", "Bônus por metas"], responsibilities: ["Liderar equipe", "Acompanhar KPIs"], requirements: ["Experiência em liderança", "Ensino superior cursando"], discovery_traits: ["lideranca", "planejamento"] },
  { id: "job-gerente", code: "GER", title: "Gerente de Unidade", category: "Liderança", description: "Gestão completa da unidade: pessoas, resultados e experiência do cliente.", is_active: true, requires_ai_interview: true, requires_human_interview: true, allows_career_plan: true, department_id: null, benefits: ["PLR", "Plano de saúde", "Bônus por metas"], responsibilities: ["Gerir P&L da unidade", "Desenvolver o time"], requirements: ["Ensino superior completo", "Experiência em gestão"], discovery_traits: ["lideranca", "visao_negocio"] },
];

// ─── Vagas por unidade (unit_jobs) — com jobs/units embutidos ─────────────
const jobById = Object.fromEntries(jobs.map((j) => [j.id, j]));
const unitById = Object.fromEntries(units.map((u) => [u.id, u]));

function makeUnitJob(id: string, jobId: string, unitId: string, status: string, createdDaysAgo: number) {
  return {
    id,
    job_id: jobId,
    unit_id: unitId,
    status,
    created_at: daysAgo(createdDaysAgo),
    jobs: jobById[jobId],
    units: unitById[unitId],
  };
}

const unit_jobs = [
  makeUnitJob("uj-1", "job-atendente", "unit-pinheiros", "aberta", 20),
  makeUnitJob("uj-2", "job-vendedor", "unit-pinheiros", "aberta", 18),
  makeUnitJob("uj-3", "job-caixa", "unit-copacabana", "aberta", 15),
  makeUnitJob("uj-4", "job-estoquista", "unit-savassi", "aberta", 12),
  makeUnitJob("uj-5", "job-supervisor", "unit-copacabana", "aberta", 10),
  makeUnitJob("uj-6", "job-gerente", "unit-savassi", "aberta", 8),
  makeUnitJob("uj-7", "job-atendente", "unit-copacabana", "fechada", 60),
];

// ─── Fases do pipeline ───────────────────────────────────────────────────
const pipeline_phases = [
  { id: "phase-triagem", name: "Triagem", order_index: 0 },
  { id: "phase-teste", name: "Teste Técnico", order_index: 1 },
  { id: "phase-ia", name: "Entrevista com IA", order_index: 2 },
  { id: "phase-rh", name: "Entrevista com RH", order_index: 3 },
  { id: "phase-aprovacao", name: "Aprovação", order_index: 4 },
  { id: "phase-contratacao", name: "Contratação", order_index: 5 },
];
const phaseById = Object.fromEntries(pipeline_phases.map((p) => [p.id, p]));

// ─── Candidatos ──────────────────────────────────────────────────────────
type Cand = {
  id: string; cpf: string; full_name: string; email: string; phone: string;
  birth_date: string; gender: string; city: string; state: string; cep: string;
};
const candidates_full: Cand[] = [
  { id: DEMO_CANDIDATE_ID, cpf: "12345678900", full_name: "Ana Beatriz Souza", email: "ana.souza@exemplo.com", phone: "(11) 98888-1010", birth_date: "1998-03-14", gender: "feminino", city: "São Paulo", state: "SP", cep: "05422-000" },
  { id: "cand-002", cpf: "23456789011", full_name: "Carlos Eduardo Lima", email: "carlos.lima@exemplo.com", phone: "(11) 97777-2020", birth_date: "1995-07-22", gender: "masculino", city: "São Paulo", state: "SP", cep: "05001-000" },
  { id: "cand-003", cpf: "34567890122", full_name: "Mariana Oliveira Costa", email: "mariana.costa@exemplo.com", phone: "(21) 96666-3030", birth_date: "2000-11-02", gender: "feminino", city: "Rio de Janeiro", state: "RJ", cep: "22040-002" },
  { id: "cand-004", cpf: "45678901233", full_name: "João Pedro Almeida", email: "joao.almeida@exemplo.com", phone: "(21) 95555-4040", birth_date: "1993-01-30", gender: "masculino", city: "Rio de Janeiro", state: "RJ", cep: "22071-900" },
  { id: "cand-005", cpf: "56789012344", full_name: "Fernanda Rodrigues Silva", email: "fernanda.silva@exemplo.com", phone: "(31) 94444-5050", birth_date: "1997-09-18", gender: "feminino", city: "Belo Horizonte", state: "MG", cep: "30140-071" },
  { id: "cand-006", cpf: "67890123455", full_name: "Rafael Santos Pereira", email: "rafael.pereira@exemplo.com", phone: "(31) 93333-6060", birth_date: "1990-05-09", gender: "masculino", city: "Belo Horizonte", state: "MG", cep: "30130-005" },
  { id: "cand-007", cpf: "78901234566", full_name: "Juliana Martins Rocha", email: "juliana.rocha@exemplo.com", phone: "(11) 92222-7070", birth_date: "2001-02-25", gender: "feminino", city: "São Paulo", state: "SP", cep: "04533-011" },
  { id: "cand-008", cpf: "89012345677", full_name: "Bruno Henrique Nascimento", email: "bruno.nascimento@exemplo.com", phone: "(21) 91111-8080", birth_date: "1996-12-11", gender: "masculino", city: "Rio de Janeiro", state: "RJ", cep: "20031-050" },
];

const candidates = candidates_full.map((c) => ({
  id: c.id,
  cpf: c.cpf,
  full_name: c.full_name,
  email: c.email,
  phone: c.phone,
  birth_date: c.birth_date,
  gender: c.gender,
  ethnicity: null,
  professional_data: { experiencia_anos: 2, ultimo_cargo: "Atendente" },
  is_synthetic: true,
  is_internal_test: true,
  is_active: true,
  status: "ativo",
  created_at: daysAgo(30),
}));

const candidate_profiles = candidates_full.map((c) => ({
  candidate_id: c.id,
  full_name: c.full_name,
  email: c.email,
  phone: c.phone,
  cep: c.cep,
  photo_url: null,
  city: c.city,
  state: c.state,
  birth_date: c.birth_date,
  gender: c.gender,
  address_json: { logradouro: "Rua Exemplo", numero: "123", bairro: "Centro", cidade: c.city, estado: c.state },
}));

// espelho usado por algumas telas
const profiles = candidates.map((c) => {
  const cp = candidate_profiles.find((p) => p.candidate_id === c.id)!;
  return { ...c, ...cp, id: c.id };
});

// ─── Candidaturas (applications) — com relações embutidas ────────────────
function makeApplication(
  id: string, candidateId: string, unitJobId: string, status: string,
  phaseId: string, score: number | null, createdDaysAgo: number, updatedDaysAgo: number,
) {
  const uj = unit_jobs.find((u) => u.id === unitJobId)!;
  return {
    id,
    candidate_id: candidateId,
    unit_job_id: unitJobId,
    status,
    current_phase: phaseById[phaseId]?.order_index ?? 0,
    current_phase_id: phaseId,
    total_score: score,
    current_cycle: 1,
    is_synthetic: true,
    work_start_at: status === "contratado" ? daysAgo(updatedDaysAgo - 1) : null,
    withdrawal_reason: null,
    created_at: daysAgo(createdDaysAgo),
    updated_at: daysAgo(updatedDaysAgo),
    unit_jobs: uj,
    pipeline_phases: phaseById[phaseId],
    candidates: candidates.find((c) => c.id === candidateId) ?? null,
    application_cycles: [
      { application_id: id, restart_mode: null, closed_at: null, cycle_number: 1 },
    ],
  };
}

const applications = [
  // Candidato logado (Ana): candidatura ativa em entrevista
  makeApplication("app-001", DEMO_CANDIDATE_ID, "uj-1", "em_andamento", "phase-ia", 78, 12, 2),
  // Demais candidatos distribuídos pelo funil
  makeApplication("app-002", "cand-002", "uj-2", "em_andamento", "phase-rh", 82, 14, 1),
  makeApplication("app-003", "cand-003", "uj-3", "em_avaliacao", "phase-teste", 65, 10, 3),
  makeApplication("app-004", "cand-004", "uj-3", "contratado", "phase-contratacao", 91, 40, 12),
  makeApplication("app-005", "cand-005", "uj-4", "aprovado", "phase-aprovacao", 88, 20, 5),
  makeApplication("app-006", "cand-006", "uj-5", "reprovado", "phase-ia", 44, 25, 18),
  makeApplication("app-007", "cand-007", "uj-1", "pendente", "phase-triagem", null, 3, 3),
  makeApplication("app-008", "cand-008", "uj-6", "em_andamento", "phase-rh", 79, 9, 1),
  makeApplication("app-009", "cand-003", "uj-5", "standby", "phase-triagem", 51, 30, 22),
  makeApplication("app-010", "cand-002", "uj-4", "contratado", "phase-contratacao", 86, 55, 20),
];

// ─── Entrevistas ─────────────────────────────────────────────────────────
const interviews = [
  { id: "int-001", application_id: "app-001", interview_type: "ia", status: "agendada", scheduled_at: daysAgo(-1), created_at: daysAgo(2) },
  { id: "int-002", application_id: "app-002", interview_type: "humana", status: "concluida", scheduled_at: daysAgo(1), created_at: daysAgo(5) },
  { id: "int-003", application_id: "app-008", interview_type: "humana", status: "agendada", scheduled_at: daysAgo(-2), created_at: daysAgo(1) },
];

const voice_interviews = [
  { id: "vi-001", interview_id: "int-001", transcript: "Transcrição fictícia da entrevista de demonstração.", duration: 480, score: 78, created_at: daysAgo(2) },
];

// ─── Testes ──────────────────────────────────────────────────────────────
const test_templates = [
  { id: "tt-001", title: "Teste de Atendimento", test_type: "comportamental", duration_minutes: 20, questions: [{ q: "Como você lidaria com um cliente insatisfeito?" }], is_active: true },
  { id: "tt-002", title: "Teste de Organização de Estoque", test_type: "tecnico", duration_minutes: 15, questions: [{ q: "Explique o método FIFO." }], is_active: true },
];

const test_assignments = [
  { id: "ta-001", candidate_id: DEMO_CANDIDATE_ID, application_id: "app-001", test_template_id: "tt-001", status: "concluido", score: 78, is_synthetic: true, created_at: daysAgo(6) },
  { id: "ta-002", candidate_id: "cand-003", application_id: "app-003", test_template_id: "tt-002", status: "pendente", score: null, is_synthetic: true, created_at: daysAgo(2) },
];

// ─── Banco de talentos ───────────────────────────────────────────────────
const talent_pool_entries = [
  { id: "tp-001", candidate_id: "cand-005", global_score: 88, test_score: 90, preferred_roles: ["Estoquista", "Atendente"], preferred_regions: ["MG"], status: "disponivel", created_at: daysAgo(5) },
  { id: "tp-002", candidate_id: "cand-002", global_score: 82, test_score: 80, preferred_roles: ["Vendedor"], preferred_regions: ["SP"], status: "disponivel", created_at: daysAgo(8) },
];

// ─── Usuários administrativos / papéis ───────────────────────────────────
const admin_users = [
  { id: DEMO_ADMIN_ID, email: "admin@exemplo.com", name: "Administrador Demo", role: "admin", scope_type: "global", scope_value: null, is_active: true, created_at: daysAgo(300) },
];

const user_roles = [
  { id: "ur-001", user_id: DEMO_ADMIN_ID, role: "admin", unit_id: null },
];

// ─── Configurações globais ───────────────────────────────────────────────
const global_settings = [
  { id: "gs-001", category: "scoring", key: "allow_reapply_after_days", value: "90" },
  { id: "gs-002", category: "features", key: "chatbox_enabled", value: "true" },
];

// ─── Mapa de tabelas para o cliente mock ─────────────────────────────────
export const demoTables: Record<string, any[]> = {
  units,
  jobs,
  unit_jobs,
  pipeline_phases,
  candidates,
  candidate_profiles,
  profiles,
  applications,
  interviews,
  voice_interviews,
  test_templates,
  test_assignments,
  talent_pool_entries,
  admin_users,
  user_roles,
  global_settings,
};

export const demoProfileFor = (userId: string) => {
  const cp = candidate_profiles.find((p) => p.candidate_id === userId);
  const c = candidates.find((x) => x.id === userId);
  if (!cp || !c) return null;
  return {
    id: c.id,
    full_name: cp.full_name,
    email: cp.email,
    cpf: c.cpf,
    phone: cp.phone,
    cep: cp.cep,
    avatar_url: cp.photo_url,
    city: cp.city,
    state: cp.state,
    birth_date: cp.birth_date,
    gender: cp.gender,
    address_json: cp.address_json,
  };
};
