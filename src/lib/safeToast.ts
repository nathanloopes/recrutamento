/**
 * Wrapper global de toasts (sonner).
 *
 * - Garante PT-BR amigável: passa toda string por `humanizeError`,
 *   bloqueando vazamento de erro técnico, inglês ou nome de tabela.
 * - Mantém API similar a `toast.success / toast.error / toast.info / toast.warning`.
 * - Toasts existentes continuam funcionando (este wrapper é opcional).
 *
 * Uso:
 *   import { safeToast } from "@/lib/safeToast";
 *   safeToast.success("Configurações salvas");
 *   safeToast.error(error); // converte automaticamente
 */
import { toast as sonnerToast } from "sonner";
import { humanizeError } from "./userMessages";

type ToastOpts = {
  description?: string | unknown;
  duration?: number;
  id?: string | number;
  action?: { label: string; onClick: () => void };
};

const TECHNICAL_PATTERN =
  /\b(relation|column|schema|null value|foreign key|constraint|RLS|JWT|Bearer|undefined|TypeError|ReferenceError|PGRST\d+|42P\d+|23\d{3})\b/i;

function sanitize(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") {
    // Se contém padrão técnico, humaniza
    if (TECHNICAL_PATTERN.test(value)) {
      return humanizeError(value);
    }
    return value;
  }
  // Erro / objeto: humaniza
  return humanizeError(value);
}

function buildOptions(opts?: ToastOpts) {
  if (!opts) return undefined;
  const desc = opts.description != null ? sanitize(opts.description) : undefined;
  return { ...opts, description: desc };
}

export const safeToast = {
  success(message: unknown, opts?: ToastOpts) {
    return sonnerToast.success(sanitize(message), buildOptions(opts));
  },
  error(message: unknown, opts?: ToastOpts) {
    return sonnerToast.error(sanitize(message), buildOptions(opts));
  },
  info(message: unknown, opts?: ToastOpts) {
    return sonnerToast.info(sanitize(message), buildOptions(opts));
  },
  warning(message: unknown, opts?: ToastOpts) {
    return sonnerToast.warning(sanitize(message), buildOptions(opts));
  },
  message(message: unknown, opts?: ToastOpts) {
    return sonnerToast(sanitize(message), buildOptions(opts));
  },
  dismiss(id?: string | number) {
    return sonnerToast.dismiss(id);
  },
};
