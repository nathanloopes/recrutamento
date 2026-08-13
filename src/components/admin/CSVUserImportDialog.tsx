import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Upload, FileText, CheckCircle, XCircle, Loader2, Copy, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { isValidCPF, cleanCPF } from "@/lib/cpf";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

const VALID_ROLES: AppRole[] = ["admin", "rh_franqueadora", "gestor_recrutamento", "franqueado", "auditor_admin"];

const ROLE_MAP: Record<string, AppRole> = {
  admin: "admin",
  administrador: "admin",
  rh_franqueadora: "rh_franqueadora",
  "admin franquia": "rh_franqueadora",
  gestor_recrutamento: "gestor_recrutamento",
  "gestor recrutamento": "gestor_recrutamento",
  franqueado: "franqueado",
  auditor_admin: "auditor_admin",
  auditor: "auditor_admin",
  candidato: "candidato",
};

interface ParsedRow {
  line: number;
  nome: string;
  email: string;
  cpf: string;
  role: string;
  unidade: string;
  resolvedRole: AppRole | null;
  resolvedUnitId: string | null;
  errors: string[];
  status: "pending" | "success" | "error" | "skipped";
  resultMessage?: string;
  tempPassword?: string;
}

interface CSVUserImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  units: { id: string; name: string; city: string | null; state: string | null }[];
}

export function CSVUserImportDialog({ open, onOpenChange, units }: CSVUserImportDialogProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);

  const resetState = () => {
    setRows([]);
    setImporting(false);
    setImportDone(false);
    setShowPasswords(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const parseCSV = (text: string) => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) {
      toast.error("CSV deve ter cabeçalho e pelo menos uma linha de dados.");
      return;
    }

    const sep = lines[0].includes(";") ? ";" : ",";
    const header = lines[0].split(sep).map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase());

    const nameIdx = header.findIndex((h) => h.includes("nome") || h === "name");
    const emailIdx = header.findIndex((h) => h.includes("email"));
    const cpfIdx = header.findIndex((h) => h.includes("cpf"));
    const roleIdx = header.findIndex((h) => h.includes("role") || h.includes("papel") || h.includes("cargo"));
    const unitIdx = header.findIndex((h) => h.includes("unidade") || h.includes("unit"));

    if (emailIdx === -1) {
      toast.error("Coluna 'Email' não encontrada no CSV.");
      return;
    }

    const parsed: ParsedRow[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));

      // Skip empty rows (all columns blank or just separators)
      const hasContent = cols.some((c) => c.length > 0);
      if (!hasContent) continue;

      const nome = nameIdx >= 0 ? cols[nameIdx] ?? "" : "";
      const email = (cols[emailIdx] ?? "").toLowerCase().trim();

      // Skip rows with no email (likely trailing empty lines)
      if (!email) continue;

      const cpf = cpfIdx >= 0 ? cleanCPF(cols[cpfIdx] ?? "") : "";
      const roleRaw = roleIdx >= 0 ? (cols[roleIdx] ?? "").toLowerCase().trim() : "";
      const unidade = unitIdx >= 0 ? (cols[unitIdx] ?? "").trim() : "";

      const errors: string[] = [];

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.push("Email inválido");
      }

      if (cpf && !isValidCPF(cpf)) {
        errors.push("CPF inválido");
      }

      const resolvedRole = ROLE_MAP[roleRaw] ?? (VALID_ROLES.includes(roleRaw as AppRole) ? (roleRaw as AppRole) : null);
      if (!resolvedRole) {
        errors.push(`Role "${roleRaw || "(vazio)"}" inválida`);
      }

      let resolvedUnitId: string | null = null;
      if (unidade) {
        const match = units.find(
          (u) => u.name.toLowerCase() === unidade.toLowerCase() || u.id === unidade
        );
        if (match) {
          resolvedUnitId = match.id;
        } else {
          errors.push(`Unidade "${unidade}" não encontrada`);
        }
      }

      const needsUnit = resolvedRole && ["franqueado", "gestor_recrutamento"].includes(resolvedRole);
      if (needsUnit && !resolvedUnitId) {
        errors.push("Unidade obrigatória para esta role");
      }

      parsed.push({
        line: i + 1,
        nome,
        email,
        cpf,
        role: roleRaw,
        unidade,
        resolvedRole,
        resolvedUnitId,
        errors,
        status: errors.length > 0 ? "error" : "pending",
      });
    }

    setRows(parsed);
    setImportDone(false);
    console.log("[CSV import] parsed rows", parsed);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      console.log("[CSV import] raw file loaded", { name: file.name, size: file.size, preview: text.slice(0, 500) });
      parseCSV(text);
    };
    reader.readAsText(file, "UTF-8");
  };

  const handleImport = async () => {
    const validRows = rows.filter((r) => r.status === "pending");
    if (validRows.length === 0) {
      toast.error("Nenhuma linha válida para importar.");
      return;
    }

    setImporting(true);

    const payload = validRows.map((r) => ({
      nome: r.nome,
      email: r.email,
      cpf: r.cpf,
      role: r.resolvedRole!,
      unit_id: r.resolvedUnitId,
    }));

    try {
      const { data, error } = await supabase.functions.invoke("import-csv-users", {
        body: { users: payload },
      });

      if (error) {
        toast.error("Erro ao chamar importação: " + error.message);
        setImporting(false);
        return;
      }

      const results: { email: string; status: string; message: string; temp_password?: string }[] = data?.results ?? [];

      if (!data?.results) {
        toast.warning("Resposta inesperada da importação. Verifique os logs.");
      }
      const updatedRows = [...rows];
      for (const result of results) {
        const row = updatedRows.find((r) => r.email === result.email && r.status === "pending");
        if (row) {
          row.status = result.status === "error" ? "error" : "success";
          row.resultMessage = result.message;
          row.tempPassword = result.temp_password;
          if (result.status === "error") {
            row.errors.push(result.message);
          }
        }
      }

      setRows(updatedRows);
      setImportDone(true);

      const successCount2 = results.filter((r) => r.status !== "error").length;
      const errorCount2 = results.filter((r) => r.status === "error").length;
      const createdCount = results.filter((r) => r.status === "created").length;
      const errorMessages = results.filter((r) => r.status === "error").map((r) => `${r.email}: ${r.message}`);
      
      if (errorCount2 > 0) {
        toast.error(`Erros na importação:\n${errorMessages.join("\n")}`, { duration: 10000 });
      }
      if (successCount2 > 0) {
        toast.success(`Importação: ${createdCount} criados, ${successCount2 - createdCount} atualizados`);
      }
      if (errorCount2 > 0 && successCount2 === 0) {
        toast.error(`Importação falhou: ${errorMessages.join("; ")}`, { duration: 10000 });
      }

      // Invalidate admin users cache so new users appear immediately
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    } catch (e: any) {
      // Erro inesperado: não expor mensagem original (pode conter detalhes técnicos).
      toast.error("Erro inesperado durante a importação.");
    }

    setImporting(false);
  };

  const copyPassword = (password: string) => {
    navigator.clipboard.writeText(password);
    toast.success("Senha copiada!");
  };

  // Botão "copiar todas as senhas" foi removido por motivos de segurança.
  // Senhas temporárias devem ser entregues individualmente ao usuário responsável.

  const validCount = rows.filter((r) => r.status === "pending").length;
  const errorCount = rows.filter((r) => r.status === "error").length;
  const successCount = rows.filter((r) => r.status === "success").length;
  const hasPasswords = rows.some((r) => r.tempPassword);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetState(); onOpenChange(v); }}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Upload className="h-5 w-5" /> Importar Usuários via CSV</DialogTitle>
          <DialogDescription>
            Formato esperado: <code className="text-xs bg-muted px-1 rounded">Nome;Email;CPF;Role;Unidade</code> — Novos usuários serão criados automaticamente com senha temporária.
          </DialogDescription>
        </DialogHeader>

        {/* File input */}
        <div className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
          onClick={() => fileRef.current?.click()}>
          <FileText className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Clique para selecionar arquivo CSV</p>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
        </div>

        {/* Stats */}
        {rows.length > 0 && (
          <div className="flex gap-3 flex-wrap items-center">
            <Badge variant="outline">{rows.length} linhas</Badge>
            <Badge className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">{importDone ? successCount : validCount} válidas</Badge>
            {errorCount > 0 && <Badge variant="destructive">{errorCount} com erro</Badge>}
            {hasPasswords && (
              <div className="ml-auto flex gap-2">
                <Button variant="outline" size="sm" className="gap-1" onClick={() => setShowPasswords(!showPasswords)}>
                  {showPasswords ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  {showPasswords ? "Ocultar senhas" : "Ver senhas"}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Preview table */}
        {rows.length > 0 && (
          <div className="border rounded-lg overflow-auto max-h-[40vh]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Unidade</TableHead>
                  <TableHead>Status</TableHead>
                  {hasPasswords && <TableHead>Senha</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.slice(0, 50).map((r, i) => (
                  <TableRow key={i} className={r.status === "error" ? "bg-destructive/5" : r.status === "success" ? "bg-green-50 dark:bg-green-950/20" : ""}>
                    <TableCell className="text-xs text-muted-foreground">{r.line}</TableCell>
                    <TableCell className="text-sm">{r.nome || "—"}</TableCell>
                    <TableCell className="text-sm">{r.email || "—"}</TableCell>
                    <TableCell className="text-sm">{r.role || "—"}</TableCell>
                    <TableCell className="text-sm">{r.unidade || "—"}</TableCell>
                    <TableCell>
                      {r.status === "pending" && <Badge variant="outline" className="text-xs">Pendente</Badge>}
                      {r.status === "success" && (
                        <Badge className="bg-green-100 text-green-700 text-xs gap-1">
                          <CheckCircle className="h-3 w-3" /> {r.resultMessage || "OK"}
                        </Badge>
                      )}
                      {r.status === "error" && (
                        <div className="space-y-0.5">
                          {r.errors.map((e, j) => (
                            <Badge key={j} variant="destructive" className="text-xs gap-1 block w-fit"><XCircle className="h-3 w-3" /> {e}</Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    {hasPasswords && (
                      <TableCell>
                        {r.tempPassword ? (
                          <div className="flex items-center gap-1">
                            <code className="text-xs bg-muted px-1 rounded">
                              {showPasswords ? r.tempPassword : "••••••••"}
                            </code>
                            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => copyPassword(r.tempPassword!)}>
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => { resetState(); onOpenChange(false); }}>Fechar</Button>
          {rows.length > 0 && !importDone && (
            <Button onClick={handleImport} disabled={importing || validCount === 0} className="gap-1">
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {importing ? "Importando..." : `Importar ${validCount} usuários`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
