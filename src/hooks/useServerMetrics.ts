import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ServerMetrics {
  ok: boolean;
  collected_at: string;
  host: string;
  cpu: any;
  mem: any;
  memswap: any;
  fs: any[] | null;
  load: any;
  uptime: any;
  network: any[] | null;
  sensors: any[] | null;
  system: any;
}

/**
 * Consulta métricas do servidor monitorado (Glances) via edge function
 * `server-metrics`. Atualiza a cada 2 segundos enquanto a aba está aberta.
 */
export function useServerMetrics(enabled: boolean = true) {
  return useQuery<ServerMetrics>({
    queryKey: ["server_metrics"],
    enabled,
    refetchInterval: 2000,
    refetchIntervalInBackground: false,
    retry: 1,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("server-metrics");
      if (error) {
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
          // ignora
        }
        throw new Error(detail || (error as any).message || "Erro ao consultar servidor.");
      }
      return data as ServerMetrics;
    },
  });
}
