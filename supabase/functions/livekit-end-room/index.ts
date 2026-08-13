// Edge Function: livekit-end-room
// Encerra a sala da entrevista (limpa room_started_at) quando o recrutador sai.
// Apenas admin / franchisee / staff vinculado à unidade pode encerrar.

// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

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
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Não autenticado." }, 401);

    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await supabaseAuth.auth.getUser();
    if (userErr || !user) return json({ error: "Sessão inválida." }, 401);

    const body = await req.json().catch(() => ({}));
    const interviewId = (body?.interviewId || body?.interview_id) as string | undefined;
    if (!interviewId) return json({ error: "interviewId é obrigatório." }, 400);

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: interview, error: ivErr } = await supabaseAdmin
      .from("interviews")
      .select("id, unit_id, candidate_id, room_started_at, room_started_by")
      .eq("id", interviewId)
      .single();
    if (ivErr || !interview) return json({ error: "Entrevista não encontrada." }, 404);

    if (interview.candidate_id === user.id) {
      return json({ error: "Apenas o anfitrião pode encerrar a sala." }, 403);
    }

    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role, unit_id")
      .eq("user_id", user.id);

    const adminRoles = ["admin", "rh_franqueadora", "franqueado", "gestor_recrutamento", "auditor_admin"];
    const isRecruiter = (roles || []).some(
      (r: any) =>
        adminRoles.includes(r.role) &&
        (r.role === "admin" || r.role === "rh_franqueadora" || r.role === "auditor_admin" || r.unit_id === interview.unit_id),
    );
    if (!isRecruiter) return json({ error: "Apenas o anfitrião pode encerrar a sala." }, 403);

    // Somente o anfitrião (primeiro recrutador que iniciou a sala) pode
    // encerrá-la. Outros recrutadores apenas saem da própria sessão.
    if (!interview.room_started_by || interview.room_started_by !== user.id) {
      return json({ error: "Apenas o anfitrião pode encerrar a sala." }, 403);
    }

    const { error: updErr } = await supabaseAdmin
      .from("interviews")
      .update({ room_started_at: null, room_started_by: null })
      .eq("id", interview.id);
    if (updErr) return json({ error: updErr.message }, 500);

    return json({ ok: true });
  } catch (e: any) {
    console.error("livekit-end-room error", e);
    return json({ error: e?.message || "Erro interno." }, 500);
  }
});
