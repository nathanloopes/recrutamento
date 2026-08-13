import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp, Search } from "lucide-react";

import { cn } from "@/lib/utils";

const Select = SelectPrimitive.Root;

const SelectGroup = SelectPrimitive.Group;

const SelectValue = SelectPrimitive.Value;

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn("flex cursor-default items-center justify-center py-1", className)}
    {...props}
  >
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
));
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName;

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn("flex cursor-default items-center justify-center py-1", className)}
    {...props}
  >
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
));
SelectScrollDownButton.displayName = SelectPrimitive.ScrollDownButton.displayName;

// ---------------------------------------------------------------------------
// Search support
// ---------------------------------------------------------------------------
// Normaliza string: minúscula + remove acentos, para busca tolerante.
function normalize(s: string): string {
  return s
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// Extrai texto de qualquer ReactNode (incluindo filhos profundos).
function getNodeText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(getNodeText).join(" ");
  if (React.isValidElement(node)) {
    const props = node.props as { children?: React.ReactNode };
    return getNodeText(props.children);
  }
  return "";
}

function getDisplayName(type: unknown): string | undefined {
  return (type as { displayName?: string } | undefined)?.displayName;
}

// Conta SelectItems (recursivo) para decidir auto-ativação do campo de busca.
function countSelectItems(children: React.ReactNode): number {
  let n = 0;
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (getDisplayName(child.type) === SelectPrimitive.Item.displayName) {
      n += 1;
      return;
    }
    const props = child.props as { children?: React.ReactNode };
    if (props.children) n += countSelectItems(props.children);
  });
  return n;
}

// Filtra recursivamente: mantém apenas SelectItems cujo texto bate com query.
// Itens desabilitados (ex.: placeholders "_loading", "_empty") são preservados.
// Labels, separadores e grupos são mantidos; grupos sem itens visíveis somem.
function filterChildren(children: React.ReactNode, q: string): React.ReactNode {
  if (!q) return children;
  const arr = React.Children.toArray(children);
  const result: React.ReactNode[] = [];

  for (const child of arr) {
    if (!React.isValidElement(child)) {
      result.push(child);
      continue;
    }
    const dn = getDisplayName(child.type);

    if (dn === SelectPrimitive.Item.displayName) {
      const props = child.props as { disabled?: boolean; children?: React.ReactNode };
      if (props.disabled) {
        result.push(child);
        continue;
      }
      const text = normalize(getNodeText(props.children));
      if (text.includes(q)) result.push(child);
      continue;
    }

    if (dn === SelectPrimitive.Group.displayName) {
      const props = child.props as { children?: React.ReactNode };
      const filtered = filterChildren(props.children, q);
      const hasItem = React.Children.toArray(filtered).some(
        (c) => React.isValidElement(c) && getDisplayName(c.type) === SelectPrimitive.Item.displayName,
      );
      if (hasItem) {
        result.push(React.cloneElement(child, undefined, filtered));
      }
      continue;
    }

    // Labels, separadores e wrappers neutros: passa adiante; tenta filtrar filhos.
    const props = child.props as { children?: React.ReactNode };
    if (props.children) {
      result.push(
        React.cloneElement(
          child,
          undefined,
          filterChildren(props.children, q),
        ),
      );
    } else {
      result.push(child);
    }
  }

  return result;
}

interface SelectContentExtraProps {
  /** Força exibição do campo de busca. Default: auto quando >8 itens. */
  searchable?: boolean;
  /** Placeholder do campo de busca. */
  searchPlaceholder?: string;
  /** Desliga o campo de busca mesmo em listas longas. */
  disableSearch?: boolean;
}

// Contexto interno: permite que SelectItem limpe a busca e tire o foco do input
// ao ser selecionado, sem precisar alterar todos os usos do projeto.
interface SelectContentInternalCtx {
  clearSearch: () => void;
  blurSearchInput: () => void;
  isSearchInputFocused: () => boolean;
}
const SelectContentCtx = React.createContext<SelectContentInternalCtx | null>(null);

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content> & SelectContentExtraProps
>(
  (
    {
      className,
      children,
      position = "popper",
      searchable,
      searchPlaceholder = "Pesquisar...",
      disableSearch,
      ...props
    },
    ref,
  ) => {
    const [query, setQuery] = React.useState("");
    const inputRef = React.useRef<HTMLInputElement>(null);
    const initialFocusRafRef = React.useRef<number[]>([]);
    const preserveFocusAfterQueryRef = React.useRef(false);

    const itemCount = React.useMemo(() => countSelectItems(children), [children]);
    const shouldSearch = !disableSearch && (searchable ?? itemCount > 8);

    const normalizedQuery = normalize(query);
    const filtered = React.useMemo(
      () => (shouldSearch ? filterChildren(children, normalizedQuery) : children),
      [children, normalizedQuery, shouldSearch],
    );

    // Foca o input apenas na abertura do popover. Depois disso, o foco fica sob
    // controle do usuário/input, sem disputar com o highlight interno do Radix.
    React.useEffect(() => {
      if (!shouldSearch) return;
      const raf1 = requestAnimationFrame(() => {
        const raf2 = requestAnimationFrame(() => {
          inputRef.current?.focus({ preventScroll: true });
        });
        initialFocusRafRef.current.push(raf2);
      });
      initialFocusRafRef.current.push(raf1);
      return () => {
        initialFocusRafRef.current.forEach(cancelAnimationFrame);
        initialFocusRafRef.current = [];
      };
    }, [shouldSearch]);

    // Após o filtro redesenhar a lista, devolve o foco ao input que disparou
    // a busca. Não roda em seleção/fechamento para manter o blur nesses casos.
    React.useEffect(() => {
      if (!shouldSearch || !preserveFocusAfterQueryRef.current) return;
      const raf = requestAnimationFrame(() => {
        inputRef.current?.focus({ preventScroll: true });
      });
      return () => cancelAnimationFrame(raf);
    }, [query, shouldSearch, filtered]);

    const isSearchInputFocused = React.useCallback(
      () => !!inputRef.current && document.activeElement === inputRef.current,
      [],
    );

    const ctxValue = React.useMemo<SelectContentInternalCtx>(
      () => ({
        clearSearch: () => {
          preserveFocusAfterQueryRef.current = false;
          setQuery("");
        },
        blurSearchInput: () => inputRef.current?.blur(),
        isSearchInputFocused,
      }),
      [isSearchInputFocused],
    );

    // Bloqueia typeahead/filtro por teclado quando o input de busca NÃO está focado.
    // Quando o input está focado, deixamos as teclas chegarem normalmente ao input.
    const shouldBlockKey = (event: React.KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return false;
      if (event.nativeEvent.isComposing) return false;
      if (event.key.length !== 1) return false; // setas, Enter, Esc, Tab...
      if (isSearchInputFocused()) return false; // digitando no input de busca
      return true;
    };

    return (
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          ref={ref}
          className={cn(
            "relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
            position === "popper" &&
              "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
            className,
          )}
          position={position}
          {...props}
          onCloseAutoFocus={(e) => {
            // Ao fechar (após selecionar/Escape), zera busca e foco para começar
            // limpo na próxima abertura.
            preserveFocusAfterQueryRef.current = false;
            setQuery("");
            inputRef.current?.blur();
            props.onCloseAutoFocus?.(e);
          }}
          onKeyDownCapture={(e) => {
            props.onKeyDownCapture?.(e);
            if (e.defaultPrevented) return;
            if (shouldBlockKey(e)) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          onKeyDown={(e) => {
            props.onKeyDown?.(e);
            if (e.defaultPrevented) return;
            if (shouldBlockKey(e)) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
        >
          {shouldSearch && (
            <div
              className="sticky top-0 z-10 flex items-center gap-2 border-b bg-popover px-2 py-1.5"
              // Impede que Radix capture o evento e mova o foco para itens.
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  preserveFocusAfterQueryRef.current = true;
                  setQuery(e.target.value);
                }}
                onKeyDown={(e) => {
                  // Esc fecha o menu (comportamento padrão Radix).
                  if (e.key === "Escape") return;
                  // Setas e Enter: deixe o Radix mover o highlight / selecionar.
                  if (
                    e.key === "ArrowDown" ||
                    e.key === "ArrowUp" ||
                    e.key === "Enter" ||
                    e.key === "Home" ||
                    e.key === "End" ||
                    e.key === "PageUp" ||
                    e.key === "PageDown" ||
                    e.key === "Tab"
                  ) {
                    return;
                  }
                  // Demais teclas: impede typeahead/seleção do Radix.
                  e.stopPropagation();
                }}
                onKeyDownCapture={(e) => {
                  // Bloqueia captura do Radix para teclas de texto, preservando navegação.
                  if (
                    e.key.length === 1 &&
                    !e.ctrlKey && !e.metaKey && !e.altKey
                  ) {
                    e.stopPropagation();
                  }
                }}
                placeholder={searchPlaceholder}
                className="flex h-7 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          )}
          <SelectScrollUpButton />
          <SelectPrimitive.Viewport
            className={cn(
              "p-1",
              position === "popper" &&
                "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]",
            )}
          >
            <SelectContentCtx.Provider value={ctxValue}>{filtered}</SelectContentCtx.Provider>
            {shouldSearch && React.Children.count(React.Children.toArray(filtered).filter(Boolean)) === 0 && (
              <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                Nenhum resultado.
              </div>
            )}
          </SelectPrimitive.Viewport>
          <SelectScrollDownButton />
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    );
  },
);
SelectContent.displayName = SelectPrimitive.Content.displayName;


const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label ref={ref} className={cn("py-1.5 pl-8 pr-2 text-sm font-semibold", className)} {...props} />
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, onSelect, onMouseDown, ...props }, ref) => {
  const ctx = React.useContext(SelectContentCtx);
  return (
    <SelectPrimitive.Item
      ref={ref}
      className={cn(
        "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 focus:bg-accent focus:text-accent-foreground",
        className,
      )}
      onSelect={(event) => {
        // Limpa a busca e tira o foco do input antes que o Radix feche o popover,
        // garantindo que nenhuma tecla subsequente filtre a lista.
        ctx?.clearSearch();
        ctx?.blurSearchInput();
        onSelect?.(event);
      }}
      onMouseDown={(event) => {
        if (ctx?.isSearchInputFocused()) {
          event.preventDefault();
        }
        onMouseDown?.(event);
      }}
      {...props}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="h-4 w-4" />
        </SelectPrimitive.ItemIndicator>
      </span>

      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
});
SelectItem.displayName = SelectPrimitive.Item.displayName;

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator ref={ref} className={cn("-mx-1 my-1 h-px bg-muted", className)} {...props} />
));
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
};
