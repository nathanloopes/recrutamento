import { useState, useMemo } from "react";
import { useCollaborators } from "@/hooks/useCollaborators";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHelp } from "@/components/ui/page-help";
import { CollaboratorInfoCard } from "@/components/ui/info-card";

import {
  Search,
  LayoutGrid,
  List,
  Users,
  UserCheck,
  UserX,
  Upload,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CollaboradorImportDialog } from "@/components/admin/CollaboradorImportDialog";

export default function Collaborators() {
  const { data: collaborators, isLoading } = useCollaborators();
  const { hasRole, unitIds: myUnitIds } = useAuth();
  const isSuperAdmin = hasRole("admin");
  const [search, setSearch] = useState("");
  const [unitFilter, setUnitFilter] = useState("all");
  const [deptFilter, setDeptFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "sede" | "loja">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [importOpen, setImportOpen] = useState(false);

  const { data: allUnits } = useQuery({
    queryKey: ["all_units_for_filter", isSuperAdmin, myUnitIds],
    queryFn: async () => {
      let q = supabase
        .from("units")
        .select("id, name, city")
        .eq("is_active", true)
        .order("name");
      if (!isSuperAdmin && myUnitIds.length > 0) {
        q = q.in("id", myUnitIds);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  const departments = useMemo(() => {
    if (!collaborators) return [];
    const set = new Set<string>();
    collaborators.forEach((c) => { if (c.departmentName) set.add(c.departmentName); });
    return Array.from(set).sort();
  }, [collaborators]);

  const filtered = useMemo(() => {
    if (!collaborators) return [];
    return collaborators.filter((c) => {
      if (search) {
        const s = search.toLowerCase();
        const match = c.fullName.toLowerCase().includes(s)
          || c.unitName.toLowerCase().includes(s)
          || (c.city && c.city.toLowerCase().includes(s))
          || (c.jobTitle && c.jobTitle.toLowerCase().includes(s));
        if (!match) return false;
      }
      if (unitFilter !== "all" && c.unitId !== unitFilter) return false;
      if (deptFilter !== "all" && c.departmentName !== deptFilter) return false;
      if (typeFilter === "sede" && !c.isFranqueadora) return false;
      if (typeFilter === "loja" && c.isFranqueadora) return false;
      if (statusFilter === "active" && !c.isActive) return false;
      if (statusFilter === "inactive" && c.isActive) return false;
      return true;
    });
  }, [collaborators, search, unitFilter, deptFilter, typeFilter, statusFilter]);

  const activeCount = filtered.filter((c) => c.isActive).length;
  const inactiveCount = filtered.length - activeCount;

  const initials = (name: string) =>
    name.split(" ").slice(0, 2).map((n) => n[0]).join("").toUpperCase();

  const formatDate = (d: string | null) =>
    d ? format(new Date(d), "dd/MM/yyyy", { locale: ptBR }) : "—";

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-52 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-foreground">Colaboradores</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setImportOpen(true)}
          >
            <Upload className="h-4 w-4 mr-1" />
            Importar CSV
          </Button>
          <Button
            variant={viewMode === "cards" ? "default" : "outline"}
            size="icon"
            onClick={() => setViewMode("cards")}
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === "table" ? "default" : "outline"}
            size="icon"
            onClick={() => setViewMode("table")}
          >
            <List className="h-4 w-4" />
          </Button>
          <PageHelp />
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="flex items-center gap-4 p-5">
            <div className="rounded-xl bg-primary/10 p-3">
              <Users className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{filtered.length}</p>
              <p className="text-xs text-muted-foreground">Total</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-emerald-500/20 bg-emerald-500/5">
          <CardContent className="flex items-center gap-4 p-5">
            <div className="rounded-xl bg-emerald-500/10 p-3">
              <UserCheck className="h-6 w-6 text-emerald-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{activeCount}</p>
              <p className="text-xs text-muted-foreground">Ativos</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-destructive/20 bg-destructive/5">
          <CardContent className="flex items-center gap-4 p-5">
            <div className="rounded-xl bg-destructive/10 p-3">
              <UserX className="h-6 w-6 text-destructive" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{inactiveCount}</p>
              <p className="text-xs text-muted-foreground">Inativos</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, unidade ou cidade..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={unitFilter} onValueChange={setUnitFilter}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Unidade" /></SelectTrigger>
          <SelectContent disableSearch>
            <SelectItem value="all">Todas unidades</SelectItem>
            {(allUnits || []).map((u) => (
              <SelectItem key={u.id} value={u.id}>{u.name}{u.city ? ` - ${u.city}` : ""}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={deptFilter} onValueChange={setDeptFilter}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Departamento" /></SelectTrigger>
          <SelectContent disableSearch>
            <SelectItem value="all">Todos departamentos</SelectItem>
            {departments.map((d) => (
              <SelectItem key={d} value={d}>{d}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as any)}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Tipo" /></SelectTrigger>
          <SelectContent disableSearch>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="sede">Sede</SelectItem>
            <SelectItem value="loja">Loja</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent disableSearch>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="active">Ativos</SelectItem>
            <SelectItem value="inactive">Inativos</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <Users className="h-12 w-12 mx-auto mb-3 opacity-40" />
          <p className="font-medium">Nenhum colaborador encontrado</p>
          <p className="text-sm">Ajuste os filtros para ver resultados</p>
        </div>
      )}

      {/* Cards view */}
      {viewMode === "cards" && filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((c) => (
            <CollaboratorInfoCard
              key={c.id}
              name={c.fullName}
              role={c.jobTitle}
              isActive={c.isActive}
              avatarUrl={c.avatarUrl}
              tags={[
                c.isFranqueadora ? "Sede" : "Loja",
                ...(c.departmentName ? [c.departmentName] : []),
                c.unitName,
              ]}
              hiredAt={formatDate(c.hiredAt)}
              email={c.email || undefined}
              phone={c.phone}
            />
          ))}
        </div>
      )}

      {/* Table view */}
      {viewMode === "table" && filtered.length > 0 && (
        <div className="rounded-lg border overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Cargo</TableHead>
                <TableHead>Departamento</TableHead>
                <TableHead>Unidade</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Cidade</TableHead>
                <TableHead>Contratação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Avatar className="h-7 w-7">
                        <AvatarImage src={c.avatarUrl || undefined} />
                        <AvatarFallback className="text-[10px]">{initials(c.fullName)}</AvatarFallback>
                      </Avatar>
                      <span className="font-medium text-sm">{c.fullName}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{c.jobTitle}</TableCell>
                  <TableCell className="text-sm">{c.departmentName || "—"}</TableCell>
                  <TableCell className="text-sm">{c.unitName}</TableCell>
                  <TableCell>
                    <Badge variant={c.isFranqueadora ? "default" : "secondary"} className="text-[10px]">
                      {c.isFranqueadora ? "Sede" : "Loja"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={c.isActive
                        ? "bg-emerald-500/15 text-emerald-700 border-emerald-500/30"
                        : "bg-destructive/15 text-destructive border-destructive/30"
                      }
                    >
                      {c.isActive ? "Ativo" : "Inativo"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{c.city || "—"}{c.state ? `/${c.state}` : ""}</TableCell>
                  <TableCell className="text-sm">{formatDate(c.hiredAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CollaboradorImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
