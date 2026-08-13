import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  LayoutDashboard,
  Briefcase,
  Building2,
  Users,
  Brain,
  Calendar,
  FileText,
  Bell,
  Settings,
  Shield,
  GitBranch,
  BarChart3,
  HelpCircle,
  Database,
  Plug,
  BookOpen,
  FolderKanban,
  TrendingUp,
  ClipboardList,
} from "lucide-react";

const adminPages = [
  { label: "Dashboard", path: "/admin", icon: LayoutDashboard, group: "Páginas" },
  { label: "Analytics", path: "/admin/dashboard", icon: BarChart3, group: "Páginas" },
  { label: "Gestão de Cargos", path: "/admin/cargos", icon: Briefcase, group: "Páginas" },
  { label: "Pipelines", path: "/admin/pipelines", icon: GitBranch, group: "Páginas" },
  { label: "Vagas Corporativas", path: "/admin/vagas", icon: FolderKanban, group: "Páginas" },
  { label: "Unidades", path: "/admin/unidades", icon: Building2, group: "Páginas" },
  { label: "Usuários e Permissões", path: "/admin/usuarios", icon: Users, group: "Páginas" },
  { label: "IA Avaliações", path: "/admin/ia-avaliacoes", icon: Brain, group: "Páginas" },
  { label: "Banco de Talentos", path: "/admin/banco-de-talentos", icon: Database, group: "Páginas" },
  { label: "Plano de Carreira", path: "/admin/plano-carreira", icon: TrendingUp, group: "Páginas" },
  { label: "Agendamento", path: "/admin/agendamento", icon: Calendar, group: "Páginas" },
  { label: "Roteiros de Entrevista", path: "/admin/roteiros", icon: BookOpen, group: "Páginas" },
  { label: "Documentação", path: "/admin/documentacao", icon: FileText, group: "Páginas" },
  { label: "Gestão de Testes", path: "/admin/testes", icon: ClipboardList, group: "Páginas" },
  { label: "Notificações", path: "/admin/notificacoes", icon: Bell, group: "Configuração" },
  { label: "FAQ", path: "/admin/faq", icon: HelpCircle, group: "Configuração" },
  { label: "Configurações Globais", path: "/admin/configuracoes", icon: Settings, group: "Configuração" },
  { label: "Logs de Auditoria", path: "/admin/logs", icon: Shield, group: "Configuração" },
  { label: "Migrações", path: "/admin/migracoes", icon: Database, group: "Configuração" },
  { label: "Integrações", path: "/admin/integracoes", icon: Plug, group: "Configuração" },
];

interface AdminCommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AdminCommandPalette({ open, onOpenChange }: AdminCommandPaletteProps) {
  const navigate = useNavigate();

  const handleSelect = useCallback(
    (path: string) => {
      onOpenChange(false);
      navigate(path);
    },
    [navigate, onOpenChange],
  );

  // Ctrl+K / Cmd+K shortcut
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [open, onOpenChange]);

  const pages = adminPages.filter((p) => p.group === "Páginas");
  const config = adminPages.filter((p) => p.group === "Configuração");

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Buscar página, cargo, configuração..." />
      <CommandList>
        <CommandEmpty>Nenhum resultado encontrado.</CommandEmpty>
        <CommandGroup heading="Páginas">
          {pages.map((page) => (
            <CommandItem key={page.path} onSelect={() => handleSelect(page.path)}>
              <page.icon className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>{page.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Configuração">
          {config.map((page) => (
            <CommandItem key={page.path} onSelect={() => handleSelect(page.path)}>
              <page.icon className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>{page.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
