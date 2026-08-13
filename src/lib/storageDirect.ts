// Cliente Supabase dedicado a Storage que fala DIRETO com o host oficial do
// Supabase, ignorando o proxy `/sb/` do nginx de produção. O proxy atual não
// roteia `/sb/storage/*` (retorna 404 do próprio nginx), então uploads e
// downloads de arquivos precisam ir diretamente ao domínio *.supabase.co.
// Fluxo REST/auth continua passando pelo proxy via o client principal.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from "@/integrations/supabase/client";

const DIRECT_URL = SUPABASE_URL;

// Sem backend real (ex.: deploy de portfólio/modo demo) reutilizamos o cliente
// principal (fictício) em vez de instanciar outro — evita o crash
// "supabaseKey is required" quando a chave está ausente.
function buildStorageClient(): typeof supabase {
  const hasRealBackend =
    !!DIRECT_URL &&
    !DIRECT_URL.includes("YOUR_PROJECT") &&
    !!SUPABASE_ANON_KEY &&
    SUPABASE_ANON_KEY !== "YOUR_SUPABASE_ANON_KEY";

  if (!hasRealBackend) return supabase;

  try {
    return createClient<Database>(DIRECT_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        headers: { "X-Client-Info": "recrutamento-app" },
      },
    });
  } catch {
    return supabase;
  }
}

export const storageDirect = buildStorageClient();

// Propaga o access token da sessão atual para o cliente direto, para que as
// políticas RLS em storage.objects reconheçam o usuário logado.
export async function getStorageClient() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (token) {
    await storageDirect.auth.setSession({
      access_token: token,
      refresh_token: data.session?.refresh_token ?? "",
    });
  }
  return storageDirect;
}
