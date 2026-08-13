# Recruta — Recrutamento Inteligente

Plataforma de recrutamento e seleção com triagem assistida por IA, entrevistas
por voz/vídeo, pipeline de vagas configurável e painel administrativo. Projeto
full-stack (React + Supabase) construído como aplicação web/PWA e empacotável
para mobile via Capacitor.

> Projeto de portfólio. Marca, domínios e credenciais foram substituídos por
> placeholders genéricos — configure os seus em `.env` (veja `.env.example`).

## Principais funcionalidades

- **Candidato**: cadastro/login, descoberta de vagas, entrevista por voz,
  onboarding, FAQ e perfil.
- **Triagem & entrevistas**: fluxo conversacional por voz com avaliação
  automática das respostas.
- **Admin**: gestão de vagas e pipelines, agendamentos, integrações,
  notificações, auditoria e configurações.
- **IA**: sugestões de talentos, avaliação de respostas e assistente (RecrutaBot).
- **PWA**: service worker, push web e empacotamento mobile (Capacitor).

## Stack

- React 18 + TypeScript + Vite
- Tailwind CSS + shadcn/ui
- Supabase (Auth, Postgres, Storage, Edge Functions)
- Capacitor (Android/iOS)
- Vitest (testes)

## Como rodar

```bash
cp .env.example .env   # preencha as variáveis do seu projeto Supabase
npm install
npm run dev
```

## Estrutura

```
src/
  components/   # UI, admin, candidate, triage, layout, livekit...
  pages/        # rotas (admin, candidate, auth, public, legal)
  contexts/     # auth e estado global
  hooks/ lib/   # hooks e utilitários (incl. cliente Supabase e MCP tools)
  integrations/ # cliente Supabase e tipos
supabase/
  functions/    # edge functions (IA, e-mail, integrações ERP, etc.)
  migrations/   # schema
```

## Notas

- As credenciais do Supabase são lidas de variáveis de ambiente; a *anon key* é
  pública por design.
- Os assets de logo/ícone são placeholders — substitua pelos seus em
  `src/assets/` e `public/icons/`.
