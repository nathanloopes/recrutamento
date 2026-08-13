// Edge Function: livekit-token
// Gera um token de acesso LiveKit para a sala da entrevista.
// Acesso permitido para: candidato titular da entrevista OU usuário com role
// admin / franchisee / staff vinculado à unidade.
//
// Secrets necessárias (configurar no Supabase):
//   - LIVEKIT_URL         (ex: wss://livekit.example.com)
//   - LIVEKIT_API_KEY
//   - LIVEKIT_API_SECRET

// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { AccessToken, RoomServiceClient } from "https://esm.sh/livekit-server-sdk@2.7.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get(
      "SUPABASE_SERVICE_ROLE_KEY",
    )!;
    const LIVEKIT_URL =
      Deno.env.get("LIVEKIT_URL") ||
      Deno.env.get("LIVEKIT_URL_WSS") ||
      Deno.env.get("LIVEKIT_WS_URL");
    const LIVEKIT_API_KEY = Deno.env.get("LIVEKIT_API_KEY");
    const LIVEKIT_API_SECRET = Deno.env.get("LIVEKIT_API_SECRET");

    if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
      return json(
        { error: "LiveKit não está configurado neste ambiente." },
        500,
      );
    }

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "Não autenticado." }, 401);
    }

    // Cliente vinculado ao usuário (RLS)
    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userErr,
    } = await supabaseAuth.auth.getUser();
    if (userErr || !user) {
      return json({ error: "Sessão inválida." }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const interviewId = (body?.interviewId || body?.interview_id) as string | undefined;
    if (!interviewId) {
      return json({ error: "interviewId é obrigatório." }, 400);
    }

    // Cliente admin para leitura confiável das tabelas envolvidas
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: interview, error: ivErr } = await supabaseAdmin
      .from("interviews")
      .select(
        "id, candidate_id, unit_id, scheduled_date, scheduled_time, modality, status, meeting_provider, room_started_at, room_started_by",
      )
      .eq("id", interviewId)
      .single();
    if (ivErr || !interview) {
      return json({ error: "Entrevista não encontrada." }, 404);
    }

    // Permissão + identificação do papel
    const isCandidate = interview.candidate_id === user.id;
    let isRecruiter = false;
    if (!isCandidate) {
      const { data: roles } = await supabaseAdmin
        .from("user_roles")
        .select("role, unit_id")
        .eq("user_id", user.id);
      const adminRoles = ["admin", "rh_franqueadora", "franqueado", "gestor_recrutamento", "auditor_admin"];
      isRecruiter = (roles || []).some(
        (r: any) =>
          adminRoles.includes(r.role) &&
          (r.role === "admin" || r.role === "rh_franqueadora" || r.role === "auditor_admin" || r.unit_id === interview.unit_id),
      );
    }
    if (!isCandidate && !isRecruiter) {
      return json({ error: "Acesso negado." }, 403);
    }

    // Recrutador: só recebe token após iniciar a sala explicitamente.
    if (isRecruiter && !interview.room_started_at) {
      return json(
        { error: "room_not_started", message: "Inicie a sala antes de entrar." },
        409,
      );
    }

    // Candidato: além do flag em DB, exige presença real de um recrutador
    // vivo na sala LiveKit. Se o flag estiver órfão (recrutador fechou aba
    // sem chamar livekit-end-room), autocorrige zerando o flag.
    if (isCandidate) {
      if (!interview.room_started_at) {
        return json(
          { error: "room_not_started", message: "Aguardando o recrutador iniciar a sala." },
          409,
        );
      }

      // Janela de 25 min após o horário marcado: candidato não pode mais entrar.
      // Recrutador (anfitrião) NÃO é afetado por essa trava.
      const INTERVIEW_ENTRY_GRACE_MINUTES = 25;
      if (interview.scheduled_date) {
        const ymd = String(interview.scheduled_date).slice(0, 10);
        const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (m) {
          const tm = String(interview.scheduled_time || "00:00").match(/^(\d{1,2}):(\d{2})/);
          const hh = tm ? Number(tm[1]) : 0;
          const mm = tm ? Number(tm[2]) : 0;
          // Horário marcado é em America/Sao_Paulo (UTC-3). Convertemos para UTC
          // somando 3h para comparar com `now` (sempre UTC no Deno).
          const startUtcMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hh + 3, mm, 0, 0);
          if (Date.now() > startUtcMs + INTERVIEW_ENTRY_GRACE_MINUTES * 60_000) {
            return json(
              {
                error: "interview_entry_expired",
                message: `A janela de entrada (${INTERVIEW_ENTRY_GRACE_MINUTES} min após o horário marcado) expirou. Solicite reagendamento.`,
              },
              403,
            );
          }
        }
      }

      // Converte URL wss:// para https:// para a API REST do LiveKit
      const httpUrl = LIVEKIT_URL.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
      const roomName = `interview-${interview.id}`;
      const roomService = new RoomServiceClient(httpUrl, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

      let recruiterPresent = false;
      try {
        const participants = await roomService.listParticipants(roomName);
        recruiterPresent = (participants || []).some((p: any) => {
          if (interview.room_started_by && p.identity === interview.room_started_by) return true;
          try {
            const meta = p.metadata ? JSON.parse(p.metadata) : null;
            return meta?.role === "recruiter";
          } catch {
            return false;
          }
        });
      } catch (e: any) {
        // Sala ainda não existe no LiveKit (404) ou erro transitório → trata como ausente
        console.warn("listParticipants falhou:", e?.message || e);
        recruiterPresent = false;
      }

      if (!recruiterPresent) {
        // Autocorrige flag órfão para que o realtime do front devolva o
        // candidato à tela "Aguardando recrutador".
        await supabaseAdmin
          .from("interviews")
          .update({ room_started_at: null, room_started_by: null })
          .eq("id", interview.id);

        return json(
          { error: "room_not_started", message: "Aguardando o recrutador iniciar a sala." },
          409,
        );
      }
    }

    // Nome do participante
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("full_name, email")
      .eq("id", user.id)
      .single();

    const room = `interview-${interview.id}`;
    const identity = user.id;
    const name = profile?.full_name || profile?.email || "Participante";

    const role = isRecruiter ? "recruiter" : "candidate";
    // Anfitrião = recrutador que iniciou a sala (primeiro a clicar em "Iniciar").
    // Demais recrutadores entram como participantes comuns (sem roomAdmin),
    // não podem encerrar a sala nem moderar outros participantes.
    const isHost = isRecruiter && interview.room_started_by === user.id;

    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity,
      name,
      ttl: 60 * 60 * 4, // 4h
      metadata: JSON.stringify({ role, isHost }),
    });
    at.addGrant({
      roomJoin: true,
      room,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      canUpdateOwnMetadata: true,
      // Apenas o anfitrião é admin da sala (mutar/remover/encerrar)
      roomAdmin: isHost,
      roomCreate: false,
    });

    const token = await at.toJwt();

    return json({
      token,
      url: LIVEKIT_URL,
      room,
      identity,
      role,
      isHost,
    });
  } catch (e: any) {
    console.error("livekit-token error", e);
    return json({ error: e?.message || "Erro interno." }, 500);
  }
});
