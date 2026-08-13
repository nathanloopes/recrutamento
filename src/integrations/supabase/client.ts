// Cliente Supabase centralizado. As credenciais vêm de variáveis de ambiente
// (arquivo `.env` — veja `.env.example`). A anon key do Supabase é pública por
// design; ainda assim mantemos tudo fora do código-fonte para facilitar a
// rotação e a configuração por ambiente.
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const PLACEHOLDER_URL = "https://YOUR_PROJECT.supabase.co";
const PLACEHOLDER_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";

export const SUPABASE_URL: string =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || PLACEHOLDER_URL;

export const SUPABASE_PUBLISHABLE_KEY: string =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ??
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ??
  PLACEHOLDER_ANON_KEY;

// Alias semântico para uso em headers HTTP (`apikey`).
export const SUPABASE_ANON_KEY: string = SUPABASE_PUBLISHABLE_KEY;

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
    // CRÍTICO: desabilitado para que o SDK NÃO consuma automaticamente
    // tokens/códigos de recuperação na URL. A página /reset-password
    // controla manualmente verifyOtp({ token_hash, type: 'recovery' }).
    detectSessionInUrl: false,
    flowType: "pkce",
    // CRÍTICO (WebView): o supabase-js usa `navigator.locks` por padrão para
    // serializar o lock de auth. Em Android WebView esse lock pode nunca
    // resolver, travando o refresh de token. Como o app roda em contexto único
    // (uma WebView), um lock pass-through é seguro e elimina o deadlock.
    lock: (_name, _acquireTimeout, fn) => fn(),
  },
  global: {
    headers: {
      "X-Client-Info": "recrutamento-app",
    },
  },
});
