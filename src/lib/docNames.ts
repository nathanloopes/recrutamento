// Centralized normalization for document name lists.
// `document_requests.documents_list` and `document_requests.custom_documents`
// (and similar config sources) may store either:
//   - string[]   (legacy/simple)        e.g. ["RG", "CPF"]
//   - DocMeta[]  (rich, from policies)  e.g. [{ name, format, required, ... }]
// Always normalize to string[] BEFORE rendering or persisting, otherwise
// React renders an object as JSX child and crashes (error #31).

export type DocLike =
  | string
  | { name?: unknown; [k: string]: unknown }
  | null
  | undefined;

export const toDocName = (d: DocLike): string => {
  if (typeof d === "string") return d;
  if (d && typeof d === "object" && "name" in d && d.name != null) {
    return String((d as any).name);
  }
  return "";
};

// ASO (Atestado de Saúde Ocupacional / exame admissional) possui fluxo PRÓPRIO:
// agendamento pelo franqueado e laudo anexado pela equipe de recrutamento
// (tabela `application_aso` + `CandidateAsoCard`). Portanto NÃO deve aparecer
// como documento anexável pelo candidato nem contar como pendência de
// documentação. Este matcher detecta variações comuns do nome na checklist.
const stripAccents = (s: string): string =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export const isAsoDocName = (d: DocLike): boolean => {
  const n = stripAccents(toDocName(d)).trim();
  if (!n) return false;
  return /\baso\b/.test(n) || n.includes("admissional") || n.includes("saude ocupacional");
};

export const toDocNames = (arr: unknown): string[] =>
  Array.isArray(arr) ? arr.map((d) => toDocName(d as DocLike)).filter(Boolean) : [];

export type DocMeta = { name: string; required: boolean; description?: string };

// Normalize any document entry into { name, required, description? }.
// Strings (legacy) are treated as REQUIRED by default — only entries that
// explicitly declare `required: false` become optional.
export const toDocMeta = (d: DocLike): DocMeta => {
  if (typeof d === "string") return { name: d, required: true };
  if (d && typeof d === "object" && "name" in d && d.name != null) {
    const r = (d as any).required;
    const desc = (d as any).description;
    return {
      name: String((d as any).name),
      required: r !== false,
      description: typeof desc === "string" && desc.trim() ? desc : undefined,
    };
  }
  return { name: "", required: true };
};

export const toDocMetas = (arr: unknown): DocMeta[] =>
  Array.isArray(arr)
    ? arr.map((d) => toDocMeta(d as DocLike)).filter((m) => m.name)
    : [];

// Merge metadata maps: required wins over optional when same name appears twice.
// Description: keep the first non-empty value found.
export const mergeDocMetas = (...lists: DocMeta[][]): DocMeta[] => {
  const map = new Map<string, DocMeta>();
  for (const list of lists) {
    for (const m of list) {
      const prev = map.get(m.name);
      if (!prev) map.set(m.name, m);
      else
        map.set(m.name, {
          name: m.name,
          required: prev.required || m.required,
          description: prev.description || m.description,
        });
    }
  }
  return Array.from(map.values());
};
