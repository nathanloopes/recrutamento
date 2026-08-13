export function formatModality(value?: string | null): string {
  switch (value) {
    case "presencial": return "Presencial";
    case "online": return "Online";
    case "ai_interview": return "Entrevista IA";
    case "ambos": return "Presencial + Online";
    default: return value ? value.charAt(0).toUpperCase() + value.slice(1) : "—";
  }
}
