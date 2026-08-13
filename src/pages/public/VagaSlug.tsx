import { useEffect, useState } from "react";
import { useParams, Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { markInviteContext } from "@/lib/postAuthRedirect";


/**
 * Resolve URL amigável /u/:unitSlug/:jobSlug/:shortCode → token,
 * e redireciona para /v/:token reaproveitando todo o fluxo existente.
 */
export default function VagaSlug() {
  const { unitSlug, jobSlug, shortCode } = useParams<{
    unitSlug: string; jobSlug: string; shortCode: string;
  }>();
  const [token, setToken] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!unitSlug || !jobSlug || !shortCode) { setNotFound(true); return; }
    // Captura contexto de divulgação
    markInviteContext();
    let cancelled = false;
    (async () => {
      const { data, error } = await (supabase.rpc as any)("resolve_token_by_slug", {
        _unit_slug: unitSlug.toLowerCase(),
        _job_slug: jobSlug.toLowerCase(),
        _short_code: shortCode.toLowerCase(),
      });
      if (cancelled) return;
      if (error || !data) { setNotFound(true); return; }
      setToken(data as string);
    })();
    return () => { cancelled = true; };
  }, [unitSlug, jobSlug, shortCode]);

  if (notFound) return <Navigate to="/oportunidades" replace />;
  if (token) return <Navigate to={`/v/${token}`} replace />;
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}
