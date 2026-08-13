import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface UnitAddress {
  street?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  cep?: string;
}

/**
 * Resolve full unit address by looking up its CEP.
 * Cached per CEP to avoid repeated provider calls.
 */
export function useUnitAddress(cep: string | null | undefined) {
  const cleaned = (cep || "").replace(/\D/g, "");
  return useQuery<UnitAddress | null>({
    queryKey: ["unit_address_by_cep", cleaned],
    enabled: cleaned.length === 8,
    staleTime: 1000 * 60 * 60 * 24, // 24h
    gcTime: 1000 * 60 * 60 * 24,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("lookup-cep", {
        body: { cep: cleaned },
      });
      if (error) return null;
      if (!data?.found) return null;
      return {
        street: data.street,
        neighborhood: data.neighborhood,
        city: data.city,
        state: data.state,
        cep: cleaned,
      };
    },
  });
}

export function formatCep(cep?: string | null) {
  const c = (cep || "").replace(/\D/g, "");
  if (c.length !== 8) return cep || "";
  return `${c.slice(0, 5)}-${c.slice(5)}`;
}

export function formatFullAddress(addr: UnitAddress | null | undefined, fallbackCity?: string, fallbackState?: string) {
  if (!addr) {
    if (fallbackCity && fallbackState) return `${fallbackCity}, ${fallbackState}`;
    return "";
  }
  const parts: string[] = [];
  if (addr.street) parts.push(addr.street);
  if (addr.neighborhood) parts.push(addr.neighborhood);
  const cityState = [addr.city || fallbackCity, addr.state || fallbackState].filter(Boolean).join("/");
  if (cityState) parts.push(cityState);
  if (addr.cep) parts.push(`CEP ${formatCep(addr.cep)}`);
  return parts.join(" · ");
}
