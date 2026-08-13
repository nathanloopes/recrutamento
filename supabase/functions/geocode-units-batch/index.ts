import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withAuth } from "../_shared/with-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface GeoResult {
  latitude: number;
  longitude: number;
}

async function geocodeViaBrasilAPI(cep: string): Promise<GeoResult | null> {
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cep/v2/${cep}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.location?.coordinates?.latitude && data.location?.coordinates?.longitude) {
      return {
        latitude: parseFloat(data.location.coordinates.latitude),
        longitude: parseFloat(data.location.coordinates.longitude),
      };
    }
    if (data.city && data.state) {
      return geocodeViaNominatim(`${data.city}, ${data.state}, Brasil`);
    }
    return null;
  } catch {
    return null;
  }
}

async function geocodeViaNominatim(query: string): Promise<GeoResult | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&countrycodes=br`;
    const res = await fetch(url, {
      headers: { "User-Agent": "RecrutaBot/1.0" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.length > 0) {
      return {
        latitude: parseFloat(data[0].lat),
        longitude: parseFloat(data[0].lon),
      };
    }
    return null;
  } catch {
    return null;
  }
}

// Rate limit helper: wait between requests to respect Nominatim's 1req/s policy
function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

Deno.serve(withAuth(async (req, ctx) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Only admins can run batch geocoding
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: ctx.userId,
      _role: "admin",
    });
    const { data: isRh } = await supabase.rpc("has_role", {
      _user_id: ctx.userId,
      _role: "rh_franqueadora",
    });

    if (!isAdmin && !isRh) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get units without coordinates that have CEP or city+state
    const { data: units, error: fetchErr } = await supabase
      .from("units")
      .select("id, cep, city, state")
      .is("latitude", null)
      .eq("is_active", true)
      .limit(100);

    if (fetchErr) throw fetchErr;

    const results: { id: string; success: boolean; source?: string }[] = [];

    for (const unit of units || []) {
      let result: GeoResult | null = null;
      let source = "";

      // Try CEP first
      if (unit.cep) {
        const cleanCep = unit.cep.replace(/\D/g, "");
        if (cleanCep.length === 8) {
          result = await geocodeViaBrasilAPI(cleanCep);
          source = "cep";
        }
      }

      // Fallback to city+state via Nominatim
      if (!result && unit.city && unit.state) {
        await delay(1100); // Nominatim rate limit
        result = await geocodeViaNominatim(`${unit.city}, ${unit.state}, Brasil`);
        source = "nominatim";
      }

      if (result) {
        const { error: upErr } = await supabase
          .from("units")
          .update({ latitude: result.latitude, longitude: result.longitude })
          .eq("id", unit.id);

        results.push({ id: unit.id, success: !upErr, source });
      } else {
        results.push({ id: unit.id, success: false });
      }
    }

    const successCount = results.filter((r) => r.success).length;

    return new Response(
      JSON.stringify({
        total: results.length,
        geocoded: successCount,
        failed: results.length - successCount,
        details: results,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("geocode-units-batch error:", err);
    return new Response(JSON.stringify({ error: "An error occurred" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}));
