import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface NearbyJob {
  unit_job_id: string;
  distance_km: number;
}

export function useNearbyJobs(radiusKm: number = 20) {
  const { profile, user } = useAuth();
  const [geoCoords, setGeoCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [needsProfileCep, setNeedsProfileCep] = useState(false);

  const profileLat = (profile as any)?.latitude as number | undefined;
  const profileLng = (profile as any)?.longitude as number | undefined;
  const hasProfileCoords = profileLat != null && profileLng != null;
  const profileCep = (profile as any)?.cep as string | undefined;
  const profileCity = (profile as any)?.city as string | undefined;
  const profileState = (profile as any)?.state as string | undefined;

  const lat = hasProfileCoords ? profileLat : geoCoords?.lat;
  const lng = hasProfileCoords ? profileLng : geoCoords?.lng;
  const hasCoords = lat != null && lng != null;

  // Geocode by CEP — used as fallback when GPS unavailable/denied
  const geocodeByCep = useCallback(async () => {
    if (hasCoords) return;
    if (!profileCep || !user?.id) {
      setNeedsProfileCep(true);
      setGeoError("Cadastre seu CEP no perfil para ver vagas próximas.");
      return;
    }
    setGeoLoading(true);
    setGeoError(null);
    try {
      const { data, error } = await supabase.functions.invoke("geocode-cep", {
        body: {
          cep: profileCep,
          table: "profiles",
          record_id: user.id,
          city: profileCity,
          state: profileState,
        },
      });
      const lat = data?.lat ?? data?.latitude;
      const lng = data?.lng ?? data?.longitude;
      if (!error && lat && lng) {
        setGeoCoords({ lat, lng });
        setGeoError(null);
        setNeedsProfileCep(false);
      } else {
        setGeoError("Não foi possível obter localização pelo CEP. Verifique seu CEP no perfil.");
      }
    } catch {
      setGeoError("Erro ao buscar localização pelo CEP.");
    } finally {
      setGeoLoading(false);
    }
  }, [hasCoords, profileCep, user?.id, profileCity, profileState]);

  // Request geolocation: tries GPS first, falls back to CEP on failure
  const [gpsDenied, setGpsDenied] = useState(false);
  const [attempted, setAttempted] = useState(false);

  const requestGeolocation = useCallback(() => {
    if (hasCoords) return;
    setAttempted(true);

    // If GPS was already denied or not supported, go straight to CEP
    if (gpsDenied || typeof navigator === "undefined" || !navigator.geolocation) {
      if (profileCep) {
        toast.message("Usando seu CEP cadastrado para encontrar vagas próximas.");
      }
      geocodeByCep();
      return;
    }

    setGeoLoading(true);
    setGeoError(null);
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setGeoCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setGeoLoading(false);
          setGeoError(null);
          setNeedsProfileCep(false);
        },
        () => {
          // GPS denied/failed → mark as denied and fallback to CEP
          setGpsDenied(true);
          setGeoLoading(false);
          if (profileCep) {
            geocodeByCep();
          } else {
            setNeedsProfileCep(true);
            setGeoError("Cadastre seu CEP no perfil para ver vagas próximas.");
          }
        },
        { timeout: 8000, maximumAge: 300000, enableHighAccuracy: false }
      );
    } catch {
      setGpsDenied(true);
      setGeoLoading(false);
      geocodeByCep();
    }
  }, [hasCoords, gpsDenied, geocodeByCep, profileCep]);


  // No auto-trigger on mount — geolocation is requested explicitly via requestGeolocation()
  // so the browser's permission prompt only appears after the user clicks "Ver próximas".

  // Query nearby jobs via RPC
  const nearbyQuery = useQuery({
    queryKey: ["nearby_unit_jobs", lat, lng, radiusKm],
    enabled: hasCoords,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("nearby_unit_jobs", {
        p_lat: lat!,
        p_lng: lng!,
        p_radius_km: radiusKm,
      });
      if (error) throw error;
      return (data || []) as NearbyJob[];
    },
  });

  // Fallback: activates when RPC returned empty OR when we can't get coords at all
  const rpcEmpty = hasCoords && !nearbyQuery.isLoading && (nearbyQuery.data?.length ?? 0) === 0;
  const geoFailed = !hasCoords && !geoLoading && attempted;
  const needsFallback = rpcEmpty || geoFailed;

  const fallbackQuery = useQuery({
    queryKey: ["fallback_unit_jobs", profileCity, profileState, radiusKm],
    enabled: needsFallback,
    queryFn: async () => {
      // Fetch open unit_jobs with unit info - match by state at minimum
      const query = supabase
        .from("unit_jobs")
        .select("id, job_id, salary, jobs(benefits), units!inner(id, name, city, state, is_franqueadora, is_active, latitude, longitude, cep)")
        .eq("status", "aberta" as any);

      const { data, error } = await query;
      if (error) throw error;

      // Filter: only active non-franqueadora units
      const filtered = (data || []).filter((uj: any) => {
        const u = uj.units;
        return u?.is_active && !u?.is_franqueadora;
      });

      // Try to trigger batch geocoding for units without coords (fire & forget)
      const unitsWithoutCoords = filtered
        .filter((uj: any) => !uj.units?.latitude && (uj.units?.cep || (uj.units?.city && uj.units?.state)))
        .map((uj: any) => uj.units?.id)
        .filter((id: string, i: number, arr: string[]) => arr.indexOf(id) === i);

      if (unitsWithoutCoords.length > 0) {
        // Geocode up to 5 units in parallel (fire & forget)
        unitsWithoutCoords.slice(0, 5).forEach((unitId: string) => {
          const unit = filtered.find((uj: any) => uj.units?.id === unitId)?.units;
          if (unit) {
            supabase.functions.invoke("geocode-cep", {
              body: {
                cep: unit.cep || "",
                table: "units",
                record_id: unitId,
                city: unit.city,
                state: unit.state,
              },
            }).catch(() => {});
          }
        });
      }

      // Return all filtered results — same-state units first, then others
      return filtered
        .sort((a: any, b: any) => {
          const aState = profileState && a.units?.state?.toLowerCase() === profileState.toLowerCase() ? 0 : 1;
          const bState = profileState && b.units?.state?.toLowerCase() === profileState.toLowerCase() ? 0 : 1;
          return aState - bState;
        })
        .map((uj: any) => ({
          ...uj,
          jobs: { id: uj.job_id, title: "", benefits: uj.jobs?.benefits ?? [] }, // title enriched below; preserve benefits
          _distance_km: undefined as number | undefined,
          _fallback: true,
        }));
    },
    staleTime: 30000,
  });

  // If fallback is active, enrich job titles
  const fallbackJobIds = fallbackQuery.data?.map((uj: any) => uj.job_id) || [];
  const uniqueFallbackJobIds = [...new Set(fallbackJobIds)];

  const jobTitlesQuery = useQuery({
    queryKey: ["job_titles_for_fallback", uniqueFallbackJobIds],
    enabled: uniqueFallbackJobIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("jobs")
        .select("id, title")
        .in("id", uniqueFallbackJobIds);
      return new Map((data || []).map((j: any) => [j.id, j.title]));
    },
  });

  // Fetch full job details for nearby results (RPC path)
  const jobIds = nearbyQuery.data?.map((n) => n.unit_job_id) || [];

  const jobsQuery = useQuery({
    queryKey: ["nearby_jobs_details", jobIds],
    enabled: jobIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("unit_jobs")
        .select("*, jobs(id, title, benefits), units(id, name, city, state, is_franqueadora)")
        .in("id", jobIds);
      if (error) throw error;
      return data || [];
    },
  });

  // Merge distance into job data
  const distanceMap = new Map(
    nearbyQuery.data?.map((n) => [n.unit_job_id, n.distance_km]) || []
  );

  let jobs: any[];

  if (jobIds.length > 0) {
    // RPC path - units have coords
    jobs = (jobsQuery.data || [])
      .map((uj: any) => ({
        ...uj,
        _distance_km: distanceMap.get(uj.id) ?? 999,
      }))
      .sort((a: any, b: any) => a._distance_km - b._distance_km);
  } else if (fallbackQuery.data && fallbackQuery.data.length > 0) {
    // Fallback path - no coords or no units in range, show all available
    const titleMap = jobTitlesQuery.data;
    jobs = fallbackQuery.data.map((uj: any) => ({
      ...uj,
      jobs: { id: uj.job_id, title: titleMap?.get(uj.job_id) || "", benefits: uj.jobs?.benefits ?? [] },
    }));
  } else {
    jobs = [];
  }

  const isLoading = nearbyQuery.isLoading || jobsQuery.isLoading || geoLoading ||
    (needsFallback && fallbackQuery.isLoading);

  return {
    jobs,
    isLoading,
    hasCoords,
    geoError,
    geoLoading,
    needsProfileCep,
    requestGeolocation,
    locationSource: hasProfileCoords ? "cep" : geoCoords ? "device" : null,
    isFallback: needsFallback && (fallbackQuery.data?.length ?? 0) > 0,
    userLat: lat,
    userLng: lng,
  };
}

// Hook to trigger geocoding when candidate saves CEP
export function useGeocodeCep() {
  const geocode = async (params: {
    cep: string;
    table: "profiles" | "units";
    record_id: string;
    city?: string;
    state?: string;
  }) => {
    try {
      const { data, error } = await supabase.functions.invoke("geocode-cep", {
        body: params,
      });
      if (error) console.error("Geocode error:", error);
      return data;
    } catch (e) {
      console.error("Geocode error:", e);
      return null;
    }
  };

  return { geocode };
}
