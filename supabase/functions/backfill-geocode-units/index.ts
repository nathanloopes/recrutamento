// One-shot backfill: geocode all active units missing latitude/longitude.
// Uses BrasilAPI (CEP) with Nominatim fallback for city+state.
// No auth — protected by BACKFILL_SECRET header.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-backfill-secret",
};

interface GeoResult { latitude: number; longitude: number; source: string }

// BrasilAPI usually returns empty coords; we use it to enrich address only.
async function fetchBrasilAPIAddress(cep: string): Promise<{ city?: string; state?: string; street?: string; neighborhood?: string } | null> {
  try {
    const r = await fetch(`https://brasilapi.com.br/api/cep/v2/${cep}`);
    if (!r.ok) return null;
    const d = await r.json();
    return { city: d.city, state: d.state, street: d.street, neighborhood: d.neighborhood };
  } catch { return null; }
}

// Photon (Komoot) — free, no strict rate limit, supports concurrent queries.
async function viaPhoton(q: string): Promise<GeoResult | null> {
  try {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=1`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const d = await r.json();
    const f = d?.features?.[0];
    if (f?.geometry?.coordinates) {
      const [lon, lat] = f.geometry.coordinates;
      return { latitude: lat, longitude: lon, source: "photon" };
    }
    return null;
  } catch { return null; }
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const secret = req.headers.get("x-backfill-secret");
  const expected = Deno.env.get("BACKFILL_SECRET") ?? "recruta-geo-2026";
  if (secret !== expected) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") ?? "200", 10);

  const { data: units, error } = await supabase
    .from("units")
    .select("id, cep, city, state")
    .is("latitude", null)
    .eq("is_active", true)
    .limit(limit);

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let ok = 0, fail = 0;
  const failed: { id: string; cep: string | null; city: string | null }[] = [];

  // Parallel batches: BrasilAPI for address enrichment, Photon for coords
  const BATCH = 15;
  const list = units ?? [];
  for (let i = 0; i < list.length; i += BATCH) {
    const slice = list.slice(i, i + BATCH);
    const results = await Promise.all(slice.map(async (u) => {
      let res: GeoResult | null = null;
      const clean = (u.cep ?? "").replace(/\D/g, "");
      let addr: { city?: string; state?: string; street?: string; neighborhood?: string } | null = null;
      if (clean.length === 8) addr = await fetchBrasilAPIAddress(clean);

      const city = addr?.city || u.city || "";
      const state = addr?.state || u.state || "";
      const street = addr?.street || "";
      const neighborhood = addr?.neighborhood || "";

      // Try most specific to least specific
      const queries = [
        street && city ? `${street}, ${neighborhood}, ${city}, ${state}, Brasil` : null,
        neighborhood && city ? `${neighborhood}, ${city}, ${state}, Brasil` : null,
        city && state ? `${city}, ${state}, Brasil` : null,
      ].filter(Boolean) as string[];

      for (const q of queries) {
        res = await viaPhoton(q);
        if (res) break;
      }
      return { u, res };
    }));

    await Promise.all(results.map(async ({ u, res }) => {
      if (res) {
        const { error: upErr } = await supabase.from("units").update({ latitude: res.latitude, longitude: res.longitude }).eq("id", u.id);
        if (upErr) { fail++; failed.push({ id: u.id, cep: u.cep, city: u.city }); }
        else ok++;
      } else {
        fail++;
        failed.push({ id: u.id, cep: u.cep, city: u.city });
      }
    }));
  }

  return new Response(JSON.stringify({ processed: units?.length ?? 0, geocoded: ok, failed: fail, failed_details: failed.slice(0, 20) }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
});
