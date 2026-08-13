/**
 * Resilient parser for scheduling-related CrossConfig settings.
 * Handles: true/false, "true"/"false", { enabled: true/false }, null/undefined.
 */
export function parseBoolSetting(value: unknown, fallback: boolean): boolean {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const clean = value.replace(/"/g, "").trim().toLowerCase();
    if (clean === "true") return true;
    if (clean === "false") return false;
    return fallback;
  }
  if (typeof value === "object" && value !== null) {
    if ("enabled" in (value as any)) {
      return parseBoolSetting((value as any).enabled, fallback);
    }
  }
  return fallback;
}
