import { useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const PAGE_SIZE = 20;

export function useInfiniteJobs(search: string) {
  const isSearching = !!search.trim();

  return useInfiniteQuery({
    queryKey: ["infinite_jobs", search],
    initialPageParam: 0,
    queryFn: async ({ pageParam = 0 }) => {
      let q = supabase
        .from("unit_jobs")
        .select(
          "*, jobs!inner(id, title, description, is_active, requires_ai_interview, requires_human_interview, allows_career_plan, department_id, benefits, responsibilities, requirements), units!inner(id, name, city, state, is_franqueadora, is_active)"
        )
        .eq("status", "aberta" as any)
        .eq("units.is_active", true)
        .eq("jobs.is_active", true)
        .order("created_at", { ascending: false });

      if (!isSearching) {
        q = q.range(pageParam * PAGE_SIZE, (pageParam + 1) * PAGE_SIZE - 1);
      }

      const { data, error } = await q;
      if (error) throw error;

      let items = (data || []) as any[];

      // Client-side multi-word search (server already filtered active jobs/units)
      if (isSearching) {
        const words = search.trim().toLowerCase().split(/\s+/);
        items = items.filter((uj) => {
          const text = [
            uj.jobs?.title,
            uj.jobs?.description,
            uj.units?.city,
            uj.units?.state,
            uj.units?.name,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return words.every((w) => text.includes(w));
        });
      }

      return {
        items,
        nextPage:
          !isSearching && (data || []).length === PAGE_SIZE
            ? pageParam + 1
            : undefined,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextPage,
  });
}
