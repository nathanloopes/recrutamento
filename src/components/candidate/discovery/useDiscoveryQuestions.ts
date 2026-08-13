import { useMemo } from "react";
import { DISCOVERY_TRAITS as FALLBACK_TRAITS, AXIS_PROMPTS, type DiscoveryAxis, type DiscoveryTrait } from "./discoveryTraits";
import { useDiscoveryTraits } from "@/hooks/useDiscoveryTraits";

export interface DiscoveryJob {
  id: string;
  title: string;
  description?: string | null;
  discovery_invite?: string | null;
  discovery_traits?: any; // jsonb: string[] (ids de traits) OU array de objetos custom { id, label, axis, keywords? }
  discovery_highlights?: any; // jsonb: string[] (bullets) OU array de objetos { title, body }
}

export interface DiscoveryQuestion {
  axis: DiscoveryAxis;
  prompt: string;
  options: Array<{ traitId: string; label: string }>;
}

interface BuildResult {
  questions: DiscoveryQuestion[];
  /** Para cada job, conjunto de traitIds que indicam afinidade. */
  jobAffinities: Record<string, Set<string>>;
}

/** Resolve traits efetivos do cargo: usa configurados pela Sede ou cai em fallback por keyword. */
function resolveJobTraits(job: DiscoveryJob, allTraits: DiscoveryTrait[]): Set<string> {
  const result = new Set<string>();
  const configured = Array.isArray(job.discovery_traits) ? job.discovery_traits : [];

  if (configured.length > 0) {
    for (const t of configured) {
      if (typeof t === "string") result.add(t);
      else if (t && typeof t === "object" && typeof t.id === "string") result.add(t.id);
    }
    if (result.size > 0) return result;
  }

  // Fallback: matching por keyword no title+description
  const haystack = ` ${(job.title || "").toLowerCase()} ${(job.description || "").toLowerCase()} `;
  for (const trait of allTraits) {
    if (trait.keywords.some((k) => haystack.includes(k.toLowerCase()))) {
      result.add(trait.id);
    }
  }
  return result;
}

/** Monta perguntas a partir dos traits que aparecem nos cargos da área. */
export function useDiscoveryQuestions(jobs: DiscoveryJob[] | undefined): BuildResult {
  const { data: dbTraits } = useDiscoveryTraits(true);

  return useMemo(() => {
    const list = jobs || [];
    // Traits efetivos = banco se houver, senão fallback hard-coded.
    const allTraits: DiscoveryTrait[] = (dbTraits && dbTraits.length > 0)
      ? dbTraits.map((r) => ({ id: r.legacy_id || r.id, axis: r.axis as DiscoveryAxis, label: r.label, keywords: r.keywords || [] }))
      : FALLBACK_TRAITS;

    const jobAffinities: Record<string, Set<string>> = {};
    const usedTraitIds = new Set<string>();

    for (const job of list) {
      const t = resolveJobTraits(job, allTraits);
      jobAffinities[job.id] = t;
      t.forEach((id) => usedTraitIds.add(id));
    }

    const byAxis = new Map<DiscoveryAxis, DiscoveryTrait[]>();
    for (const trait of allTraits) {
      if (!usedTraitIds.has(trait.id)) continue;
      const arr = byAxis.get(trait.axis) || [];
      arr.push(trait);
      byAxis.set(trait.axis, arr);
    }

    const order: DiscoveryAxis[] = ["atividade", "publico", "ritmo", "metas"];
    const questions: DiscoveryQuestion[] = [];
    for (const axis of order) {
      const traits = byAxis.get(axis) || [];
      if (traits.length < 2) continue; // não vale perguntar se só tem 1 opção
      questions.push({
        axis,
        prompt: AXIS_PROMPTS[axis],
        options: traits.slice(0, 4).map((t) => ({ traitId: t.id, label: t.label })),
      });
    }

    return { questions, jobAffinities };
  }, [jobs, dbTraits]);
}

/** Calcula ranking de cargos baseado nos traits selecionados. */
export function rankJobsByAnswers(
  jobs: DiscoveryJob[],
  jobAffinities: Record<string, Set<string>>,
  selectedTraitIds: string[],
): DiscoveryJob[] {
  if (selectedTraitIds.length === 0) return jobs;
  const scored = jobs.map((job) => {
    const aff = jobAffinities[job.id] || new Set<string>();
    const hits = selectedTraitIds.filter((id) => aff.has(id)).length;
    return { job, score: hits };
  });
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.job.title.localeCompare(b.job.title);
  });
  return scored.map((s) => s.job);
}
