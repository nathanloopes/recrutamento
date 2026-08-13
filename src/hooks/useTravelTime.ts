import { useQuery } from "@tanstack/react-query";

export interface TravelInfo {
  km: number;
  minutes: number;
}

/**
 * Calls public OSRM router to get driving distance + duration between two coords.
 * Tolerant to failure — returns null instead of throwing.
 */
export function useTravelTime(
  from: { lat?: number | null; lng?: number | null } | null | undefined,
  to: { lat?: number | null; lng?: number | null } | null | undefined,
) {
  const fLat = from?.lat;
  const fLng = from?.lng;
  const tLat = to?.lat;
  const tLng = to?.lng;
  const enabled =
    fLat != null && fLng != null && tLat != null && tLng != null;

  return useQuery<TravelInfo | null>({
    queryKey: ["travel_time", fLat, fLng, tLat, tLng],
    enabled,
    staleTime: 1000 * 60 * 60, // 1h
    gcTime: 1000 * 60 * 60,
    retry: 0,
    queryFn: async () => {
      try {
        const url = `https://router.project-osrm.org/route/v1/driving/${fLng},${fLat};${tLng},${tLat}?overview=false`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        const route = data?.routes?.[0];
        if (!route) return null;
        return {
          km: route.distance / 1000,
          minutes: route.duration / 60,
        };
      } catch {
        return null;
      }
    },
  });
}
