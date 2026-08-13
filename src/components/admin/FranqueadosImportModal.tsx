import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Loader2, Download, CheckCircle2, Clock, Search, Users, UserCheck, UserX, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Franqueado {
  id: string;
  full_name: string;
  email: string;
  cpf: string;
  phone: string;
  imported: boolean;
  erp_unit_name?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

async function extractEdgeFunctionError(error: any): Promise<string> {
  try {
    if (error?.context && error.context instanceof Response) {
      const body = await error.context.clone().json();
      console.error("[EdgeFunction] Error body:", JSON.stringify(body, null, 2));
      return body?.error || error.message;
    }
  } catch { /* ignore */ }
  return error?.message || "Erro desconhecido";
}

export function FranqueadosImportModal({ open, onOpenChange }: Props) {
  const [franqueados, setFranqueados] = useState<Franqueado[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | "imported" | "not_imported">("all");
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(10);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const sentinelRef = useRef<HTMLTableRowElement>(null);

  // Load franqueados when modal opens (with cleanup to avoid double-call in StrictMode)
  useEffect(() => {
    let cancelled = false;
    if (open) {
      loadFranqueados(cancelled);
    } else {
      setFranqueados([]);
      setSelected(new Set());
      setFilter("all");
      setSearch("");
    }
    return () => { cancelled = true; };
  }, [open]);

  const loadFranqueados = async (cancelled = false) => {
    setLoading(true);
    try {
      // Validate session before calling edge function
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        toast({ title: "Sessão expirada", description: "Faça login novamente para continuar.", variant: "destructive" });
        setLoading(false);
        return;
      }

      const allFranqueados: Franqueado[] = [];
      let hasMore = true;
      let offset = 0;

      while (hasMore) {
        if (cancelled) return;
        const { data, error } = await supabase.functions.invoke("list-erp-franqueados", {
          body: { offset, limit: 200 },
        });
        if (cancelled) return;
        if (error) {
          const msg = await extractEdgeFunctionError(error);
          throw new Error(msg);
        }
        allFranqueados.push(...(data.franqueados || []));
        hasMore = data.hasMore;
        offset = data.nextOffset;
      }

      if (!cancelled) {
        setFranqueados(allFranqueados);
        setLastSyncedAt(new Date());
      }
    } catch (err: any) {
      console.error("[FranqueadosModal] load error:", err);
      toast({ title: "Erro ao carregar", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const syncAndLoadFranqueados = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({ title: "Sessão expirada", description: "Faça login novamente para continuar.", variant: "destructive" });
        return;
      }

      const { error: unitsError } = await supabase.functions.invoke("sync-erp-units", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: {},
      });
      if (unitsError) throw new Error(await extractEdgeFunctionError(unitsError));

      const { error: linksError } = await supabase.functions.invoke("sync-erp-franchisee-units", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: {},
      });
      if (linksError) throw new Error(await extractEdgeFunctionError(linksError));

      await loadFranqueados();
      toast({ title: "Sincronização concluída", description: "Unidades e vínculos de franqueados foram atualizados." });
    } catch (err: any) {
      console.error("[FranqueadosModal] sync error:", err);
      toast({ title: "Erro na sincronização", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // Filtered + searched list
  const filtered = useMemo(() => {
    let list = franqueados;
    if (filter === "imported") list = list.filter((f) => f.imported);
    if (filter === "not_imported") list = list.filter((f) => !f.imported);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (f) =>
          f.full_name.toLowerCase().includes(q) ||
          f.email.toLowerCase().includes(q) ||
          f.cpf.includes(q) ||
          (f.erp_unit_name || "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [franqueados, filter, search]);

  // Reset visible count when filter/search changes
  useEffect(() => {
    setVisibleCount(10);
  }, [filter, search]);

  // Slice for infinite scroll
  const visibleItems = useMemo(
    () => filtered.slice(0, visibleCount),
    [filtered, visibleCount]
  );
  const hasMoreVisible = visibleCount < filtered.length;

  // IntersectionObserver to load more items
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMoreVisible) {
          setVisibleCount((prev) => prev + 10);
        }
      },
      { rootMargin: "100px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMoreVisible, visibleItems.length]);

  // Selection helpers
  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectableIds = filtered.filter((f) => !f.imported).map((f) => f.id);

  const selectAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of selectableIds) next.add(id);
      return next;
    });
  };

  const deselectAll = () => {
    setSelected(new Set());
  };

  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  // Import selected
  const handleImport = async () => {
    if (selected.size === 0) return;
    setImporting(true);
    try {
      // Validate session before calling edge function
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        toast({ title: "Sessão expirada", description: "Faça login novamente para continuar.", variant: "destructive" });
        setImporting(false);
        return;
      }

      const usersToImport = franqueados
        .filter((f) => selected.has(f.id))
        .map((f) => ({
          id: f.id,
          cpf: f.cpf,
          email: f.email,
          nome: f.full_name,
          phone: f.phone,
          erp_unit_name: f.erp_unit_name || null,
        }));

      const { data, error } = await supabase.functions.invoke("import-erp-franqueados", {
        body: { users: usersToImport },
      });

      if (error) {
        const msg = await extractEdgeFunctionError(error);
        throw new Error(msg);
      }

      toast({
        title: "Importação concluída",
        description: `${data.imported} importado(s), ${data.skipped} já existente(s)${data.errors ? `, ${data.errors} erro(s)` : ""}`,
      });

      // Refresh list to update statuses
      setSelected(new Set());
      await loadFranqueados();
    } catch (err: any) {
      console.error("[FranqueadosModal] import error:", err);
      toast({ title: "Erro na importação", description: err.message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const selectedCount = selected.size;
  const importedCount = franqueados.filter((f) => f.imported).length;
  const notImportedCount = franqueados.filter((f) => !f.imported).length;
  const totalCount = franqueados.length;

  const filterTabs = [
    { value: "all" as const, label: "Todos", count: totalCount, icon: Users },
    { value: "not_imported" as const, label: "Não importados", count: notImportedCount, icon: UserX },
    { value: "imported" as const, label: "Já importados", count: importedCount, icon: UserCheck },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Importar Franqueados do ERP
              </DialogTitle>
              <DialogDescription>
                Selecione os franqueados que deseja importar. Itens já importados estão marcados em verde.
              </DialogDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={syncAndLoadFranqueados}
              disabled={loading || importing}
              className="shrink-0 gap-1.5"
              title="Buscar lista atualizada diretamente do ERP"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Sincronizar agora
            </Button>
          </div>
          {lastSyncedAt && (
            <p className="text-[11px] text-muted-foreground mt-1">
              Última sincronização {formatDistanceToNow(lastSyncedAt, { locale: ptBR, addSuffix: true })}
            </p>
          )}
        </DialogHeader>

        {/* Filter tabs + Search */}
        <div className="space-y-3">
          {/* Filter tabs */}
          {!loading && totalCount > 0 && (
            <div className="flex gap-2">
              {filterTabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = filter === tab.value;
                return (
                  <button
                    key={tab.value}
                    onClick={() => setFilter(tab.value)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {tab.label}
                    <span className={`ml-1 text-xs px-1.5 py-0.5 rounded-full ${
                      isActive ? "bg-primary-foreground/20" : "bg-background"
                    }`}>
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, email ou CPF..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {/* Selection bar */}
        {!loading && notImportedCount > 0 && (
          <div className="flex items-center justify-between bg-muted/50 rounded-md px-3 py-2">
            <div className="flex items-center gap-3">
              <Checkbox
                checked={allSelected}
                onCheckedChange={() => (allSelected ? deselectAll() : selectAll())}
              />
              <span className="text-sm text-muted-foreground">
                {allSelected ? "Desmarcar todos" : "Selecionar todos não importados"}
              </span>
            </div>
            {selectedCount > 0 && (
              <Badge variant="default" className="gap-1">
                <Download className="h-3 w-3" />
                {selectedCount} selecionado(s)
              </Badge>
            )}
          </div>
        )}

        {/* Table */}
        <div className="flex-1 overflow-auto border rounded-md min-h-[200px] max-h-[50vh]">
          {loading ? (
            <div className="p-6 space-y-3">
              <div className="flex items-center gap-2 mb-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Carregando franqueados do ERP...</span>
              </div>
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : totalCount === 0 ? (
            <div className="flex flex-col items-center justify-center p-10 text-center">
              <Users className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground font-medium">Nenhum franqueado encontrado</p>
              <p className="text-sm text-muted-foreground/70 mt-1">Verifique a conexão com o ERP.</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-10 text-center">
              <Search className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground font-medium">Nenhum resultado</p>
              <p className="text-sm text-muted-foreground/70 mt-1">Tente alterar o filtro ou a busca.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="w-10"></TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead>Unidade</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>CPF</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead className="w-32 text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleItems.map((f) => {
                  const isSelected = selected.has(f.id);
                  return (
                    <TableRow
                      key={f.id}
                      className={
                        f.imported
                          ? "opacity-50 bg-green-50/30 dark:bg-green-950/10"
                          : isSelected
                            ? "bg-primary/5 dark:bg-primary/10"
                            : "hover:bg-muted/40 cursor-pointer"
                      }
                      onClick={() => { if (!f.imported) toggleOne(f.id); }}
                    >
                      <TableCell className="pl-4">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleOne(f.id)}
                          disabled={f.imported}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        {f.full_name || "—"}
                        {f.imported && (
                          <span className="block text-xs text-green-600 dark:text-green-400 mt-0.5">
                            Já importado no sistema
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {f.erp_unit_name ? (
                          <span className="text-foreground">{f.erp_unit_name}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{f.email || "—"}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{f.cpf || "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{f.phone || "—"}</TableCell>
                      <TableCell className="text-center">
                        {f.imported ? (
                          <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 gap-1 border-green-200 dark:border-green-800">
                            <CheckCircle2 className="h-3 w-3" />
                            Importado
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1 text-amber-600 border-amber-300 dark:text-amber-400 dark:border-amber-700">
                            <Clock className="h-3 w-3" />
                            Pendente
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {/* Sentinel for infinite scroll */}
                {hasMoreVisible && (
                  <TableRow ref={sentinelRef}>
                    <TableCell colSpan={7} className="text-center py-3">
                      <span className="text-xs text-muted-foreground flex items-center justify-center gap-1.5">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Carregando mais...
                      </span>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="flex-col sm:flex-row gap-2 sm:justify-between">
          <p className="text-xs text-muted-foreground self-center">
            {totalCount > 0 && `${importedCount} de ${totalCount} já importado(s)`}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>
              Fechar
            </Button>
            <Button onClick={handleImport} disabled={importing || selectedCount === 0}>
              {importing ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-1.5 h-4 w-4" />
              )}
              Importar Selecionados ({selectedCount})
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
