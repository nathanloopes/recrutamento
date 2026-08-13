export interface CepResult {
  found: boolean;
  city?: string;
  state?: string;
  street?: string;
  neighborhood?: string;
  latitude?: number;
  longitude?: number;
  source?: string;
  error_type?: "invalid_cep" | "provider_unavailable";
}

interface LookupCepOptions {
  allowApproximateCoordinates?: boolean;
}

async function tryBrasilAPI(cep: string): Promise<CepResult> {
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cep/v2/${cep}`);
    if (res.status === 404) return { found: false, error_type: "invalid_cep" };
    if (!res.ok) return { found: false, error_type: "provider_unavailable" };
    const data = await res.json();
    const lat = data.location?.coordinates?.latitude
      ? parseFloat(data.location.coordinates.latitude)
      : undefined;
    const lng = data.location?.coordinates?.longitude
      ? parseFloat(data.location.coordinates.longitude)
      : undefined;
    return {
      found: true,
      city: data.city || undefined,
      state: data.state || undefined,
      street: data.street || undefined,
      neighborhood: data.neighborhood || undefined,
      latitude: lat && !isNaN(lat) ? lat : undefined,
      longitude: lng && !isNaN(lng) ? lng : undefined,
      source: "brasilapi",
    };
  } catch {
    return { found: false, error_type: "provider_unavailable" };
  }
}

async function tryViaCEP(cep: string): Promise<CepResult> {
  try {
    const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    if (!res.ok) return { found: false, error_type: "provider_unavailable" };
    const data = await res.json();
    if (data.erro) return { found: false, error_type: "invalid_cep" };
    return {
      found: true,
      city: data.localidade || undefined,
      state: data.uf || undefined,
      street: data.logradouro || undefined,
      neighborhood: data.bairro || undefined,
      source: "viacep",
    };
  } catch {
    return { found: false, error_type: "provider_unavailable" };
  }
}

async function geocodeViaNominatim(
  city: string,
  state: string
): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const query = `${city}, ${state}, Brasil`;
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

async function geocodePreciseCepViaNominatim(
  cep: string,
  city?: string,
  state?: string,
  street?: string,
  neighborhood?: string,
): Promise<{ latitude: number; longitude: number } | null> {
  const formattedCep = `${cep.slice(0, 5)}-${cep.slice(5)}`;
  const queries = [
    [street, neighborhood, city, state, "Brasil"].filter(Boolean).join(", "),
    `${formattedCep}, Brasil`,
  ].filter(Boolean);

  for (const query of queries) {
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=3&countrycodes=br&addressdetails=1`;
      const res = await fetch(url, {
        headers: { "User-Agent": "RecrutaBot/1.0" },
      });
      if (!res.ok) continue;
      const data = await res.json();
      const normalize = (value: string) =>
        value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const expectedCity = city ? normalize(city) : "";
      const expectedState = state ? normalize(state) : "";
      const match = data.find((item: any) => {
        const display = normalize(`${item.display_name || ""}`);
        const itemAddress = item.address || {};
        const itemState = normalize(`${itemAddress.state || itemAddress.state_code || ""}`);
        const itemStateCode = normalize(`${itemAddress["ISO3166-2-lvl4"] || ""}`);
        const itemCity = normalize(`${itemAddress.city || itemAddress.town || itemAddress.municipality || itemAddress.village || ""}`);
        const stateOk = !expectedState
          || itemState.includes(expectedState)
          || itemStateCode.endsWith(`-${expectedState}`)
          || display.includes(` ${expectedState},`)
          || display.includes(`, ${expectedState}`);
        const cityOk = !expectedCity || itemCity.includes(expectedCity);
        return stateOk && cityOk;
      });
      if (match) {
        return {
          latitude: parseFloat(match.lat),
          longitude: parseFloat(match.lon),
        };
      }
    } catch {
      // Try the next query.
    }
  }

  return null;
}

/**
 * Robust CEP lookup with fallback chain:
 * 1. BrasilAPI (address + coords)
 * 2. ViaCEP (address only)
 * 3. Nominatim (coords from city/state)
 */
export async function lookupCep(cep: string, options: LookupCepOptions = {}): Promise<CepResult> {
  const allowApproximateCoordinates = options.allowApproximateCoordinates ?? true;
  const cleaned = cep.replace(/\D/g, "");
  if (cleaned.length !== 8) {
    return { found: false, error_type: "invalid_cep" };
  }

  // 1. Try BrasilAPI
  const brasil = await tryBrasilAPI(cleaned);
  if (brasil.found) {
    if (!brasil.latitude && brasil.city && brasil.state) {
      const preciseGeo = await geocodePreciseCepViaNominatim(
        cleaned,
        brasil.city,
        brasil.state,
        brasil.street,
        brasil.neighborhood,
      );
      if (preciseGeo) {
        brasil.latitude = preciseGeo.latitude;
        brasil.longitude = preciseGeo.longitude;
      }
    }

    // If no precise coords, try city/state only when approximate coordinates are allowed.
    if (!brasil.latitude && brasil.city && brasil.state) {
      if (allowApproximateCoordinates) {
        const geo = await geocodeViaNominatim(brasil.city, brasil.state);
        if (geo) {
          brasil.latitude = geo.latitude;
          brasil.longitude = geo.longitude;
        }
      }
    }
    return brasil;
  }

  // If BrasilAPI returned invalid_cep, still try ViaCEP to confirm
  // 2. Try ViaCEP
  const via = await tryViaCEP(cleaned);
  if (via.found) {
    if (via.city && via.state) {
      const preciseGeo = await geocodePreciseCepViaNominatim(
        cleaned,
        via.city,
        via.state,
        via.street,
        via.neighborhood,
      );
      if (preciseGeo) {
        via.latitude = preciseGeo.latitude;
        via.longitude = preciseGeo.longitude;
      }
    }

    // Try to get coords via city/state only when approximate coordinates are allowed.
    if (via.city && via.state) {
      if (allowApproximateCoordinates && !via.latitude) {
        const geo = await geocodeViaNominatim(via.city, via.state);
        if (geo) {
          via.latitude = geo.latitude;
          via.longitude = geo.longitude;
        }
      }
    }
    return via;
  }

  // Both failed — determine error type
  // If either said invalid_cep, it's invalid; otherwise it's provider_unavailable
  if (brasil.error_type === "invalid_cep" || via.error_type === "invalid_cep") {
    return { found: false, error_type: "invalid_cep" };
  }
  return { found: false, error_type: "provider_unavailable" };
}
