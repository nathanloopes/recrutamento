/**
 * Resolve o href correto para "Entrar na reunião online".
 *
 * Para entrevistas LiveKit (sala interna /entrevista-online/:id) ignoramos qualquer
 * origin gravado no banco — o link foi gerado a partir do `window.location.origin`
 * do admin no momento da aprovação (podendo ser localhost / IP da rede / outro
 * domínio publicado). Sempre usamos um path relativo ao host atual do candidato.
 *
 * Para provider "external" (Meet, Zoom, Teams etc.), devolvemos o link original.
 */
export interface MeetingLinkSource {
  id: string;
  meeting_link?: string | null;
  meeting_provider?: string | null;
}

export function isLivekitInterview(iv: MeetingLinkSource): boolean {
  if (iv.meeting_provider === "livekit") return true;
  return !!iv.meeting_link && iv.meeting_link.includes("/entrevista-online/");
}

export function resolveMeetingHref(iv: MeetingLinkSource): string | null {
  if (isLivekitInterview(iv)) {
    return `/entrevista-online/${iv.id}`;
  }
  return iv.meeting_link || null;
}

/**
 * Janela (em minutos) durante a qual a entrada do candidato fica liberada
 * após o horário marcado. Ultrapassado esse limite, o botão "Entrar" some
 * e o gate de servidor (livekit-token) também recusa o acesso.
 *
 * Recrutador (anfitrião) NÃO é afetado por essa janela.
 */
export const INTERVIEW_ENTRY_GRACE_MINUTES = 25;

export interface InterviewSchedule {
  scheduled_date?: string | null;
  scheduled_time?: string | null;
}

/**
 * Retorna `true` se já se passaram mais de INTERVIEW_ENTRY_GRACE_MINUTES desde
 * o horário marcado da entrevista. Usa timezone local do navegador.
 */
export function isInterviewEntryExpired(
  iv: InterviewSchedule | null | undefined,
  graceMinutes: number = INTERVIEW_ENTRY_GRACE_MINUTES,
): boolean {
  if (!iv?.scheduled_date) return false;
  const ymd = iv.scheduled_date.slice(0, 10);
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const tm = (iv.scheduled_time || "00:00").match(/^(\d{1,2}):(\d{2})/);
  const hh = tm ? Number(tm[1]) : 0;
  const mm = tm ? Number(tm[2]) : 0;
  const start = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hh, mm, 0, 0);
  return Date.now() > start.getTime() + graceMinutes * 60_000;
}
