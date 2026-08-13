// Edge Function: livekit-moderate
// Permite ao anfitrião (admin/franchisee/staff) mutar ou remover participantes
// da sala da entrevista. Toda ação é reverificada server-side.
//
// Secrets: LIVEKIT_URL (ou variantes), LIVEKIT_API_KEY, LIVEKIT_API_SECRET

// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { RoomServiceClient, TrackSource } from "https://esm.sh/livekit-server-sdk@2.7.2";

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

function toHttpUrl(wsUrl: string) {
  const trimmed = wsUrl.replace(/\/+$/, "");
  if (trimmed.startsWith("wss://")) return "https://" + trimmed.slice(6);
  if (trimmed.startsWith("ws://")) return "http://" + trimmed.slice(5);
  return trimmed;
}

function extractLivekitError(e: any): { statusCode?: number; message: string } {
  const msg = e?.message || String(e);
  const m = /status\s+(\d{3})/i.exec(msg);
  return { statusCode: m ? Number(m[1]) : undefined, message: msg };
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
      return json({ error: "LiveKit não está configurado." }, 500);
    }

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "Não autenticado." }, 401);
    }

    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await supabaseAuth.auth.getUser();
    if (userErr || !user) return json({ error: "Sessão inválida." }, 401);

    const body = await req.json().catch(() => ({}));
    const interviewId = (body?.interviewId || body?.interview_id) as
      | string
      | undefined;
    const action = body?.action as
      | "mute_track"
      | "unmute_track"
      | "remove_participant"
      | undefined;
    const targetIdentity = body?.targetIdentity as string | undefined;
    const trackSid = body?.trackSid as string | undefined;
    const source = body?.source as "microphone" | "camera" | undefined;

    if (!interviewId || !action || !targetIdentity) {
      return json(
        { error: "interviewId, action e targetIdentity são obrigatórios." },
        400,
      );
    }
    if (
      action === "mute_track" || action === "unmute_track"
    ) {
      if (!trackSid) {
        return json({ error: "trackSid é obrigatório para mute/unmute." }, 400);
      }
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: interview, error: ivErr } = await supabaseAdmin
      .from("interviews")
      .select("id, candidate_id, unit_id, room_started_by")
      .eq("id", interviewId)
      .single();
    if (ivErr || !interview) {
      return json({ error: "Entrevista não encontrada." }, 404);
    }

    // Só recrutador da unidade (ou admin global) pode moderar
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
    if (!isRecruiter) return json({ error: "Acesso negado." }, 403);

    // Somente o anfitrião (primeiro recrutador que iniciou a sala) pode moderar
    // outros participantes. Recrutadores convidados só podem sair da sala.
    if (!interview.room_started_by || interview.room_started_by !== user.id) {
      return json({ error: "Apenas o anfitrião pode moderar a sala." }, 403);
    }

    const room = `interview-${interview.id}`;
    const svc = new RoomServiceClient(
      toHttpUrl(LIVEKIT_URL),
      LIVEKIT_API_KEY,
      LIVEKIT_API_SECRET,
    );

    const ctx = { interviewId, targetIdentity, action, trackSid, source };

    try {
      if (action === "remove_participant") {
        await svc.removeParticipant(room, targetIdentity);
        return json({ ok: true });
      }

      if (action === "mute_track" || action === "unmute_track") {
        const muted = action === "mute_track";
        try {
          await svc.mutePublishedTrack(room, targetIdentity, trackSid!, muted);
          return json({ ok: true, method: "mute_published_track" });
        } catch (e: any) {
          const info = extractLivekitError(e);
          console.error("livekit mute failed, trying fallback", { ...ctx, ...info });

          // Fallback: revogar/restaurar permissão de publicação da fonte
          // Funciona quando o servidor LiveKit não expõe MuteRoom (503/404).
          if (info.statusCode === 503 || info.statusCode === 404) {
            try {
              const allowedSources: TrackSource[] = muted
                ? []
                : [TrackSource.MICROPHONE, TrackSource.CAMERA, TrackSource.SCREEN_SHARE];

              if (muted && source) {
                // Remove apenas a fonte alvo, mantendo as demais
                const all = [
                  TrackSource.MICROPHONE,
                  TrackSource.CAMERA,
                  TrackSource.SCREEN_SHARE,
                ];
                const blockedSource =
                  source === "microphone"
                    ? TrackSource.MICROPHONE
                    : TrackSource.CAMERA;
                const keep = all.filter((s) => s !== blockedSource);
                await svc.updateParticipant(room, targetIdentity, undefined, {
                  canSubscribe: true,
                  canPublish: true,
                  canPublishData: true,
                  canPublishSources: keep,
                });
              } else {
                await svc.updateParticipant(room, targetIdentity, undefined, {
                  canSubscribe: true,
                  canPublish: !muted ? true : true,
                  canPublishData: true,
                  canPublishSources: allowedSources,
                });
              }
              return json({ ok: true, method: "update_participant_fallback" });
            } catch (fallbackErr: any) {
              const fi = extractLivekitError(fallbackErr);
              console.error("livekit fallback failed", { ...ctx, ...fi });
              return json(
                {
                  error: "livekit_unavailable",
                  statusCode: fi.statusCode || info.statusCode,
                  livekit_error: fi.message || info.message,
                },
                502,
              );
            }
          }

          return json(
            {
              error: "livekit_error",
              statusCode: info.statusCode,
              livekit_error: info.message,
            },
            502,
          );
        }
      }

      return json({ error: "Ação inválida." }, 400);
    } catch (e: any) {
      const info = extractLivekitError(e);
      console.error("livekit-moderate action error", { ...ctx, ...info });
      return json(
        {
          error: "livekit_error",
          statusCode: info.statusCode,
          livekit_error: info.message,
        },
        502,
      );
    }
  } catch (e: any) {
    console.error("livekit-moderate error", e);
    return json({ error: e?.message || "Erro interno." }, 500);
  }
});
