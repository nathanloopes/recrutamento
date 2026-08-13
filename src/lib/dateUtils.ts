// Date helpers to handle date-only fields without timezone shifts.
//
// Postgres `date` columns and `<input type="date">` use the "YYYY-MM-DD" form.
// `new Date("YYYY-MM-DD")` is parsed as UTC midnight, which becomes the previous
// day when formatted in negative-offset timezones (e.g. BRT -3). Likewise,
// `Date.prototype.toISOString().slice(0,10)` converts a local Date to UTC and
// can shift the day in positive-offset timezones.
//
// Rules of thumb:
//   - To DISPLAY a date-only value: use `formatDateBR(value)` — it never
//     constructs a Date, so it is timezone-safe.
//   - To convert a "YYYY-MM-DD" into a Date for calendars/inputs: use
//     `ymdToLocalDate(ymd)` — anchored at local noon to avoid TZ edge cases.
//   - To convert a Date back into "YYYY-MM-DD" for persistence: use
//     `dateToLocalYMD(date)` — uses local Y/M/D components, never UTC.
//
// For real timestamps (`timestamptz`, ISO with time), keep using
// `toLocaleString("pt-BR")` / `format(new Date(iso), ...)` as usual.

export function dateInputToISO(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return `${v}T12:00:00.000Z`;
}

export function isoToDateInput(v: string | null | undefined): string {
  if (!v) return "";
  return v.slice(0, 10);
}

/**
 * Format a date-only value (or ISO string) as "DD/MM/YYYY" without ever
 * passing through `new Date()`. Safe for any timezone.
 */
export function formatDateBR(v: string | null | undefined): string {
  if (!v) return "";
  const ymd = v.slice(0, 10);
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * Parse "YYYY-MM-DD" into a local Date anchored at noon (12:00 local time).
 * Anchoring at noon avoids any DST/UTC boundary moving the day around.
 * Returns null if the input is empty or malformed.
 */
export function ymdToLocalDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const ymd = v.slice(0, 10);
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return new Date(y, mo - 1, d, 12, 0, 0, 0);
}

/**
 * Convert a Date back into "YYYY-MM-DD" using LOCAL year/month/day components,
 * not UTC. This guarantees the persisted value matches what the user picked
 * regardless of timezone.
 */
export function dateToLocalYMD(d: Date | null | undefined): string {
  if (!d) return "";
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

/**
 * Format a date+time as a relative pt-BR label when close to today,
 * falling back to "DD/MM/YYYY HH:mm" for distant dates.
 *
 * Rules (local timezone):
 *   - Today        → "Hoje HH:mm"
 *   - Tomorrow     → "Amanhã HH:mm"
 *   - Yesterday    → "Ontem HH:mm"
 *   - 2..6 days ahead → "Sexta 14:00" (weekday capitalized)
 *   - Otherwise    → "DD/MM/YYYY HH:mm"
 *
 * Accepts a Date, ISO string, or "YYYY-MM-DD[ HH:mm[:ss]]" form.
 * Second arg lets you pass the time separately (e.g. scheduled_time column).
 */
export function formatRelativeDateTimeBR(
  value: Date | string | null | undefined,
  timeOverride?: string | null
): string {
  if (value === null || value === undefined || value === "") return "";
  let target: Date | null = null;

  if (value instanceof Date) {
    target = isNaN(value.getTime()) ? null : value;
  } else if (typeof value === "string") {
    const s = value.trim();
    if (!s) return "";
    const dateOnly = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnly) {
      const y = Number(dateOnly[1]);
      const mo = Number(dateOnly[2]) - 1;
      const d = Number(dateOnly[3]);
      let hh = 0;
      let mm = 0;
      if (timeOverride) {
        const tm = timeOverride.match(/^(\d{1,2}):(\d{2})/);
        if (tm) {
          hh = Number(tm[1]);
          mm = Number(tm[2]);
        }
      }
      target = new Date(y, mo, d, hh, mm, 0, 0);
    } else {
      const local = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
      if (local) {
        target = new Date(
          Number(local[1]),
          Number(local[2]) - 1,
          Number(local[3]),
          Number(local[4]),
          Number(local[5]),
          Number(local[6] || "0"),
          0
        );
      } else {
        const d = new Date(s);
        target = isNaN(d.getTime()) ? null : d;
      }
    }
  }

  if (!target) return "";

  const hh = String(target.getHours()).padStart(2, "0");
  const mm = String(target.getMinutes()).padStart(2, "0");
  const time = `${hh}:${mm}`;

  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const now = new Date();
  const diffDays = Math.round((startOfDay(target) - startOfDay(now)) / 86400000);

  if (diffDays === 0) return `Hoje ${time}`;
  if (diffDays === 1) return `Amanhã ${time}`;
  if (diffDays === -1) return `Ontem ${time}`;
  if (diffDays >= 2 && diffDays <= 6) {
    const weekdays = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
    return `${weekdays[target.getDay()]} ${time}`;
  }

  const y = target.getFullYear();
  const mo = String(target.getMonth() + 1).padStart(2, "0");
  const d = String(target.getDate()).padStart(2, "0");
  return `${d}/${mo}/${y} ${time}`;
}

/**
 * Format a full timestamp (timestamptz / ISO) as "DD/MM/YYYY HH:mm" in LOCAL time.
 * Use for real timestamps like `applications.work_start_at`. Returns "" if empty/invalid.
 */
export function formatDateTimeBR(v: string | Date | null | undefined): string {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return "";
  const day = String(d.getDate()).padStart(2, "0");
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const y = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day}/${mo}/${y} ${hh}:${mm}`;
}

/**
 * Convert an ISO timestamp into the value expected by `<input type="datetime-local">`
 * ("YYYY-MM-DDTHH:mm"), using LOCAL components. Empty string for null/invalid.
 */
export function isoToDateTimeLocalInput(v: string | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${mo}-${da}T${hh}:${mm}`;
}

/**
 * Convert a `<input type="datetime-local">` value ("YYYY-MM-DDTHH:mm", interpreted
 * as LOCAL time) into a full ISO timestamp for persistence. Null for empty/invalid.
 */
export function dateTimeLocalInputToISO(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const d = new Date(
    Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0, 0
  );
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

const CHAT_WEEKDAYS = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
];
const CHAT_MONTHS_SHORT = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

/**
 * Rótulo de dia estilo WhatsApp para separadores nas conversas do chat.
 * Hoje / Ontem / nome do dia da semana (2–6 dias atrás) / data por extenso.
 * Usado pelas telas de conversa do admin e do candidato para agrupar mensagens por dia.
 */
export function formatChatDayLabel(d: Date): string {
  const startOfDay = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const now = new Date();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);

  if (diffDays === 0) return "Hoje";
  if (diffDays === 1) return "Ontem";
  if (diffDays >= 2 && diffDays <= 6) return CHAT_WEEKDAYS[d.getDay()];

  return `${d.getDate()} de ${CHAT_MONTHS_SHORT[d.getMonth()]} de ${d.getFullYear()}`;
}
