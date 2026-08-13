/**
 * Resolves the displayed lists for a unit_job, applying override (subset) when present.
 * If override is null/undefined → inherit full list from the institutional Cargo (jobs).
 * If override is an array → use exactly that subset.
 */
export interface UnitJobLike {
  benefits_override?: string[] | null;
  responsibilities_override?: string[] | null;
  requirements_override?: string[] | null;
  jobs?: {
    benefits?: string[] | null;
    responsibilities?: string[] | null;
    requirements?: string[] | null;
  } | null;
}

function pick(override: string[] | null | undefined, master: string[] | null | undefined): string[] {
  if (Array.isArray(override)) {
    const masterSet = new Set(Array.isArray(master) ? master : []);
    return override.filter((x) => masterSet.has(x));
  }
  return Array.isArray(master) ? master : [];
}

export function resolveUnitJobLists(uj: UnitJobLike) {
  return {
    benefits: pick(uj.benefits_override, uj.jobs?.benefits),
    responsibilities: pick(uj.responsibilities_override, uj.jobs?.responsibilities),
    requirements: pick(uj.requirements_override, uj.jobs?.requirements),
  };
}
