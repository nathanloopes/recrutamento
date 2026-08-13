import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Lock, Info } from "lucide-react";

interface InheritedSelectorProps {
  title: string;
  inherited: string[];
  selected: string[];
  canEdit: boolean;
  onChange: (next: string[]) => void;
  icon?: "list" | "badge";
}

/**
 * Renders the institutional list (read-only catalog) with checkboxes.
 * Franchise admin can only mark/unmark items — never add or remove from the master list.
 */
export function UnitJobInheritedSelector({
  title,
  inherited,
  selected,
  canEdit,
  onChange,
  icon = "list",
}: InheritedSelectorProps) {
  if (!inherited.length) return null;

  const selectedSet = new Set(selected);

  const toggle = (item: string) => {
    if (!canEdit) return;
    const next = selectedSet.has(item)
      ? selected.filter((s) => s !== item)
      : [...selected, item];
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <Label className="text-base font-semibold flex items-center gap-2">
        {!canEdit && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
        {title}
      </Label>
      {canEdit ? (
        <div className="space-y-1.5 rounded-md border p-3 bg-muted/20">
          {inherited.map((item) => {
            const isSelected = selectedSet.has(item);
            return (
              <label
                key={item}
                className="flex items-start gap-2 cursor-pointer hover:bg-muted/40 rounded px-1.5 py-1 text-sm"
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => toggle(item)}
                  className="mt-0.5"
                />
                <span className={isSelected ? "" : "text-muted-foreground line-through decoration-muted-foreground/40"}>
                  {item}
                </span>
              </label>
            );
          })}
        </div>
      ) : icon === "badge" ? (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {selected.map((b) => (
            <Badge key={b} variant="outline" className="text-xs">{b}</Badge>
          ))}
          {selected.length === 0 && (
            <span className="text-xs text-muted-foreground italic">Nenhum item selecionado pela unidade.</span>
          )}
        </div>
      ) : (
        <ul className="mt-1 list-disc pl-5 space-y-1 text-sm">
          {selected.map((r) => <li key={r}>{r}</li>)}
          {selected.length === 0 && (
            <li className="list-none text-xs text-muted-foreground italic -ml-5">Nenhum item selecionado pela unidade.</li>
          )}
        </ul>
      )}
    </div>
  );
}

interface BannerProps {
  reason: "switch_off" | "not_in_whitelist" | "admin" | "franqueado" | "no_role" | "loading";
}

export function UnitJobInheritedBanner({ reason }: BannerProps) {
  if (reason === "admin") {
    return (
      <div className="rounded-md border border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/20 p-3 text-xs flex items-start gap-2">
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-600" />
        <span>Você é Sede — pode marcar/desmarcar livremente os itens institucionais para esta vaga.</span>
      </div>
    );
  }
  if (reason === "franqueado") {
    return (
      <div className="rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs flex items-start gap-2">
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600" />
        <span>
          Personalização habilitada para sua unidade. Você pode marcar/desmarcar quais itens institucionais valem para esta vaga.
          <strong className="block mt-1">Não é possível adicionar ou excluir itens da lista da Sede.</strong>
        </span>
      </div>
    );
  }
  if (reason === "switch_off") {
    return (
      <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground flex items-start gap-2">
        <Lock className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>Personalização global desativada. Peça ao administrador para ativar em <strong>Configurações → Unidades → Permitir personalização por unidade</strong>.</span>
      </div>
    );
  }
  if (reason === "not_in_whitelist") {
    return (
      <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground flex items-start gap-2">
        <Lock className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>Esta unidade não está autorizada a personalizar. Peça ao administrador para adicioná-la em <strong>Configurações → Unidades → Unidades autorizadas a personalizar</strong>.</span>
      </div>
    );
  }
  if (reason === "no_role") {
    return (
      <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground flex items-start gap-2">
        <Lock className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>Você não tem permissão para personalizar esta vaga. Apenas o franqueado da unidade ou a Sede podem editar.</span>
      </div>
    );
  }
  if (reason === "loading") {
    return (
      <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground flex items-start gap-2">
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 animate-pulse" />
        <span>Carregando permissões…</span>
      </div>
    );
  }
  return (
    <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground flex items-start gap-2">
      <Lock className="h-3.5 w-3.5 mt-0.5 shrink-0" />
      <span>Benefícios, Responsabilidades e Requisitos são herdados do Cargo definido pela Sede. Edite-os em /admin/cargos.</span>
    </div>
  );
}
