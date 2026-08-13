import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface LiveKitTokenPayload {
  token: string;
  url: string;
  room: string;
  identity: string;
  role?: "recruiter" | "candidate";
  isHost?: boolean;
}

/**
 * Solicita um token LiveKit para entrar na sala da entrevista.
 * O backend (edge function `livekit-token`) valida se o usuário autenticado
 * é o candidato da entrevista OU um administrador da unidade responsável.
 */
export function useLiveKitToken(interviewId: string | undefined) {
  return useQuery<LiveKitTokenPayload>({
    queryKey: ["livekit_token", interviewId],
    enabled: !!interviewId,
    staleTime: 0,
    retry: 1,
    queryFn: async () => {
      if (!interviewId) {
        throw new Error("interviewId é obrigatório.");
      }
      const { data, error } = await supabase.functions.invoke("livekit-token", {
        // Enviamos as duas chaves para compatibilidade com versões antigas
        // da edge function que esperavam snake_case.
        body: { interviewId, interview_id: interviewId },
      });
      if (error) {
        // Tenta extrair a mensagem real retornada pela edge function (que vem
        // em error.context — um Response — quando o status é não-2xx).
        let detail: string | null = null;
        const ctx: any = (error as any).context;
        try {
          if (ctx && typeof ctx.json === "function") {
            const body = await ctx.clone().json();
            detail = body?.error || body?.message || null;
          } else if (ctx && typeof ctx.text === "function") {
            const text = await ctx.clone().text();
            if (text) {
              try {
                const parsed = JSON.parse(text);
                detail = parsed?.error || parsed?.message || text;
              } catch {
                detail = text;
              }
            }
          }
        } catch {
          // ignora — usa a mensagem genérica
        }
        throw new Error(detail || (error as any).message || "Erro ao conectar à sala de vídeo.");
      }
      if (!data?.token || !data?.url) {
        throw new Error("Resposta inválida do servidor de vídeo.");
      }
      return data as LiveKitTokenPayload;
    },
  });
}
