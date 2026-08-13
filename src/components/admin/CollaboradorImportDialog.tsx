import { useState, useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { isValidCPF, cleanCPF, formatCPF } from "@/lib/cpf";
import { Upload, FileSpreadsheet, Copy, Eye, EyeOff, Loader2 } from "lucide-react";
import * as XLSX from "xlsx";

interface CollaboradorRow {
  full_name: string;
  cpf: string;
  email: string;
  empresa: string;
  cargo: string;
  area: string;
  setor: string;
  departamento: string;
  salario: string;
  admissao: string;
  status: "pending" | "success" | "error" | "duplicate";
  message: string;
  temp_password: string;
}

const HEADER_MAP: Record<string, keyof Omit<CollaboradorRow, "status" | "message" | "temp_password">> = {
  colaborador: "full_name",
  nome: "full_name",
  "nome completo": "full_name",
  cpf: "cpf",
  email: "email",
  "e-mail": "email",
  empresa: "empresa",
  cargo: "cargo",
  "área": "area",
  area: "area",
  setor: "setor",
  departamento: "departamento",
  "salário": "salario",
  salario: "salario",
  "admissão": "admissao",
  admissao: "admissao",
};

function mapHeaders(headers: string[]): Record<number, keyof Omit<CollaboradorRow, "status" | "message" | "temp_password">> {
  const mapping: Record<number, keyof Omit<CollaboradorRow, "status" | "message" | "temp_password">> = {};
  headers.forEach((h, i) => {
    const normalized = h.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const withAccent = h.trim().toLowerCase();
    const field = HEADER_MAP[normalized] || HEADER_MAP[withAccent];
    if (field) mapping[i] = field;
  });
  return mapping;
}

function parseCSV(text: string): string[][] {
  const sep = text.indexOf(";") !== -1 ? ";" : ",";
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((line) => line.split(sep).map((c) => c.trim().replace(/^"|"$/g, "")));
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CollaboradorImportDialog({ open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<CollaboradorRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);
  const [fileName, setFileName] = useState("");

  const resetState = useCallback(() => {
    setRows([]);
    setImporting(false);
    setImported(false);
    setShowPasswords(false);
    setFileName("");
  }, []);

  const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    try {
      let rawRows: string[][] = [];

      if (file.name.endsWith(".csv") || file.name.endsWith(".txt")) {
        const text = await file.text();
        rawRows = parseCSV(text);
      } else {
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        rawRows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" });
      }

      if (rawRows.length < 2) {
        toast({
          title: "Arquivo vazio",
          description: "O arquivo precisa ter pelo menos 1 linha de dados além do cabeçalho.",
          variant: "destructive",
        });
        return;
      }

      const headerRow = rawRows[0].map(String);
      const colMap = mapHeaders(headerRow);

      if (!Object.values(colMap).includes("full_name")) {
        toast({
          title: "Coluna obrigatória ausente",
          description: "Não foi possível identificar a coluna de nome (Colaborador/Nome).",
          variant: "destructive",
        });
        return;
      }

      const dataRows = rawRows.slice(1).filter((r) => r.some((c) => String(c).trim()));

      if (dataRows.length > 100) {
        toast({
          title: "Limite excedido",
          description: "Máximo de 100 registros por importação.",
          variant: "destructive",
        });
        return;
      }

      const parsed: CollaboradorRow[] = dataRows.map((row) => {
        const entry: CollaboradorRow = {
          full_name: "",
          cpf: "",
          email: "",
          empresa: "",
          cargo: "",
          area: "",
          setor: "",
          departamento: "",
          salario: "",
          admissao: "",
          status: "pending",
          message: "",
          temp_password: "",
        };

        Object.entries(colMap).forEach(([idx, field]) => {
          entry[field] = String(row[Number(idx)] || "").trim() as never;
        });

        return entry;
      });

      parsed.forEach((r) => {
        if (!r.full_name) {
          r.status = "error";
          r.message = "Nome obrigatório";
        } else if (r.cpf && !isValidCPF(r.cpf)) {
          r.status = "error";
          r.message = "CPF inválido";
        } else if (r.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) {
          r.status = "error";
          r.message = "Email inválido";
        } else if (!r.email && !r.cpf) {
          r.status = "error";
          r.message = "Email ou CPF obrigatório";
        }
      });

      setRows(parsed);
      setImported(false);
    } catch (err: any) {
      toast({ title: "Erro ao ler arquivo", description: err.message, variant: "destructive" });
    }

    e.target.value = "";
  }, []);

  const validRows = useMemo(() => rows.filter((r) => r.status === "pending"), [rows]);

  const handleImport = useCallback(async () => {
    if (validRows.length === 0) return;
    setImporting(true);

    try {
      const payload = validRows.map((r) => ({
        full_name: r.full_name,
        cpf: cleanCPF(r.cpf),
        email: r.email,
        cargo: r.cargo,
        area: r.area,
        setor: r.setor,
        departamento: r.departamento,
        salario: r.salario,
        admissao: r.admissao,
        empresa: r.empresa,
      }));

      const { data, error } = await supabase.functions.invoke("import-collaborators", {
        body: { collaborators: payload },
      });

      if (error) throw error;

      const results: Array<{ email: string; cpf: string; status: string; message: string; temp_password?: string }> = data?.results || [];

      setRows((prev) => {
        const updated = [...prev];
        let ri = 0;
        updated.forEach((row, idx) => {
          if (row.status !== "pending") return;
          const result = results[ri];
          ri++;
          if (!result) return;
          updated[idx] = {
            ...row,
            status: result.status as CollaboradorRow["status"],
            message: result.message,
            temp_password: result.temp_password || "",
          };
        });
        return updated;
      });

      setImported(true);
      const successCount = results.filter((r) => r.status === "success").length;
      await queryClient.invalidateQueries({ queryKey: ["collaborators"] });
      await queryClient.invalidateQueries({ queryKey: ["collaborators", "v2"] });
      toast({
        title: "Importação concluída",
        description: `${successCount} de ${results.length} colaboradores importados com sucesso.`,
      });
    } catch (err: any) {
      toast({ title: "Erro na importação", description: err.message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  }, [queryClient, validRows]);

  const copyPassword = (pw: string) => {
    navigator.clipboard.writeText(pw);
    toast({ title: "Senha copiada!" });
  };

  const statusBadge = (row: CollaboradorRow) => {
    switch (row.status) {
      case "pending":
        return <Badge variant="outline">Pendente</Badge>;
      case "success":
        return <Badge className="border-emerald-500/30 bg-emerald-500/15 text-emerald-700">Sucesso</Badge>;
      case "duplicate":
        return <Badge className="border-amber-500/30 bg-amber-500/15 text-amber-700">{row.message || "Duplicado"}</Badge>;
      case "error":
        return <Badge variant="destructive">{row.message || "Erro"}</Badge>;
      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetState(); onOpenChange(v); }}>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            Importação de Colaboradores
          </DialogTitle>
          <DialogDescription>
            Envie um arquivo CSV ou XLSX com os dados dos colaboradores. A primeira linha deve conter os nomes das colunas.
          </DialogDescription>
        </DialogHeader>

        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-8">
            <div className="w-full rounded-xl border-2 border-dashed border-muted-foreground/30 p-8 text-center">
              <Upload className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
              <p className="mb-4 text-sm text-muted-foreground">Arraste ou selecione um arquivo .csv ou .xlsx</p>
              <label>
                <Input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  className="hidden"
                  onChange={handleFile}
                />
                <Button variant="outline" asChild>
                  <span>Selecionar arquivo</span>
                </Button>
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              Colunas aceitas: Colaborador, CPF, Email, Empresa, Cargo, Área, Setor, Departamento, Salário, Admissão
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                {fileName} — {rows.length} registro(s), {validRows.length} válido(s)
              </p>
              <div className="flex items-center gap-2">
                {imported && (
                  <Button variant="ghost" size="sm" onClick={() => setShowPasswords((p) => !p)}>
                    {showPasswords ? <EyeOff className="mr-1 h-4 w-4" /> : <Eye className="mr-1 h-4 w-4" />}
                    {showPasswords ? "Ocultar senhas" : "Mostrar senhas"}
                  </Button>
                )}
                {!imported && (
                  <Button onClick={handleImport} disabled={importing || validRows.length === 0} size="sm">
                    {importing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />}
                    Importar {validRows.length} colaborador(es)
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={resetState}>
                  {imported ? "Nova importação" : "Limpar"}
                </Button>
              </div>
            </div>

            <div className="max-h-[50vh] overflow-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>CPF</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Cargo</TableHead>
                    <TableHead>Status</TableHead>
                    {imported && <TableHead>Senha Temp.</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r, i) => (
                    <TableRow key={i} className={r.status === "error" ? "bg-destructive/5" : r.status === "success" ? "bg-emerald-500/5" : ""}>
                      <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="text-sm font-medium">{r.full_name || "—"}</TableCell>
                      <TableCell className="text-sm">{r.cpf ? formatCPF(r.cpf) : "—"}</TableCell>
                      <TableCell className="text-sm">{r.email || "—"}</TableCell>
                      <TableCell className="text-sm">{r.cargo || "—"}</TableCell>
                      <TableCell>{statusBadge(r)}</TableCell>
                      {imported && (
                        <TableCell>
                          {r.temp_password ? (
                            <div className="flex items-center gap-1">
                              <span className="text-xs font-mono">{showPasswords ? r.temp_password : "••••••••"}</span>
                              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyPassword(r.temp_password)}>
                                <Copy className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : "—"}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
