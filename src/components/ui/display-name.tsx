import * as React from "react";
import { cn } from "@/lib/utils";
import { formatName } from "@/lib/formatName";

type AsTag = "span" | "p" | "div" | "h1" | "h2" | "h3" | "h4" | "strong" | "label";

export interface DisplayNameProps
  extends React.HTMLAttributes<HTMLElement> {
  /** Nome cru vindo do banco. Não é alterado, apenas exibido em CAPS. */
  name?: string | null;
  /** Texto exibido quando `name` é vazio/nulo. */
  fallback?: string;
  /** Tag HTML a renderizar (default: span). */
  as?: AsTag;
}

/**
 * <DisplayName /> — Renderiza um nome em CAPS LOCK apenas visualmente.
 *
 * - Não modifica o valor salvo (banco/API).
 * - Usa text-transform via Tailwind (`uppercase`) para garantir consistência.
 * - Mantém acessibilidade: o texto real continua o mesmo no DOM.
 *
 * Uso:
 *   <DisplayName name={profile?.full_name} fallback="Sem nome" />
 *   <DisplayName as="h2" name={candidate.full_name} className="text-lg" />
 */
export const DisplayName = React.memo(function DisplayName({
  name,
  fallback = "—",
  as: Tag = "span",
  className,
  ...rest
}: DisplayNameProps) {
  return (
    <Tag className={cn("uppercase", className)} {...rest}>
      {formatName(name, fallback)}
    </Tag>
  );
});
