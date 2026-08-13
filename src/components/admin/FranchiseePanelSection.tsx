import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, Store } from "lucide-react";
import { format, parseISO } from "date-fns";
import {
  useFranchiseePanel,
  useAdminUsers,
  HEALTH_ORDER,
  type FranchiseeRow,
} from "@/hooks/useFranchiseePanel";
import { UnitAccompanimentSheet, STATUS_META, HEALTH_META } from "@/components/admin/UnitAccompanimentSheet";
import { UnitFrequencyDialog } from "@/components/admin/UnitFrequencyDialog";

const fmtDate = (iso: string | null) => {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "dd/MM/yyyy");
  } catch {
    return "—";
  }
};

export function FranchiseePanelSection() {
  const { rows, isLoading } = useFranchiseePanel();
  const { data: admins } = useAdminUsers();

  const [selected, setSelected] = useState<FranchiseeRow | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [freqRow, setFreqRow] = useState<FranchiseeRow | null>(null);
  const [freqOpen, setFreqOpen] = useState(false);

  // Ordena por saúde (crítico → atenção → saudável) para priorizar acompanhamento.
  const sortedRows = useMemo(
    () =>
      [...rows].sort(
        (a, b) => HEALTH_ORDER[a.health.level] - HEALTH_ORDER[b.health.level] || a.unitName.localeCompare(b.unitName),
      ),
    [rows],
  );

  const openUnit = (r: FranchiseeRow) => {
    setSelected(r);
    setSheetOpen(true);
  };

  const openFreq = (r: FranchiseeRow) => {
    setFreqRow(r);
    setFreqOpen(true);
  };

  // Mantém o drawer com os dados atualizados após um refetch em background.
  const liveSelected = useMemo(
    () => (selected ? rows.find((r) => r.unitId === selected.unitId) ?? selected : null),
    [rows, selected],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Store className="h-5 w-5 text-muted-foreground" />
          Painel do Franqueado
        </CardTitle>
        <CardDescription>
          Saúde e acompanhamento por unidade franqueada. Clique numa unidade para abrir o acompanhamento completo.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center p-4">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : sortedRows.length === 0 ? (
          <p className="text-muted-foreground text-sm text-center py-4">
            Nenhuma unidade franqueada ou em implantação encontrada.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Unidade</TableHead>
                  <TableHead>Franqueado</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Vagas abertas</TableHead>
                  <TableHead className="text-right">Vagas encerradas</TableHead>
                  <TableHead className="text-right">Tempo médio p/ preencher</TableHead>
                  <TableHead>Último acesso</TableHead>
                  <TableHead className="text-right">Frequência (30d)</TableHead>
                  <TableHead>Saúde</TableHead>
                  <TableHead>Responsável</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRows.map((r) => {
                  const st = STATUS_META[r.status];
                  const health = HEALTH_META[r.health.level];
                  const respName = r.responsavelId
                    ? admins?.find((a) => a.id === r.responsavelId)?.name || "—"
                    : "—";
                  return (
                    <TableRow
                      key={r.unitId}
                      className="cursor-pointer hover:bg-muted/50"
                      role="button"
                      tabIndex={0}
                      onClick={() => openUnit(r)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openUnit(r);
                        }
                      }}
                    >
                      <TableCell className="font-medium">
                        {r.unitName}
                        {(r.city || r.state) && (
                          <span className="block text-xs text-muted-foreground">
                            {[r.city, r.state].filter(Boolean).join(" - ")}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="name-display">
                        {r.franqueadoNames.length > 0 ? r.franqueadoNames.join(", ") : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={st.variant} className={st.cls}>{st.label}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.openJobs}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.closedJobs}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.avgDaysToFill > 0 ? `${r.avgDaysToFill} d` : "—"}
                      </TableCell>
                      <TableCell className="text-xs">{fmtDate(r.lastAccess)}</TableCell>
                      <TableCell className="text-right">
                        {r.actions > 0 ? (
                          <button
                            type="button"
                            className="inline-flex"
                            onClick={(e) => {
                              e.stopPropagation();
                              openFreq(r);
                            }}
                          >
                            <Badge
                              variant="outline"
                              className="text-[10px] cursor-pointer hover:bg-muted transition-colors"
                            >
                              {r.actions} ações
                            </Badge>
                          </button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge variant="outline" className={health.cls}>{health.label}</Badge>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-[240px]">
                            <ul className="space-y-0.5 text-xs">
                              {r.health.reasons.map((reason, i) => (
                                <li key={i}>• {reason}</li>
                              ))}
                            </ul>
                          </TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell className="name-display text-xs">{respName}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <UnitAccompanimentSheet
        row={liveSelected}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        admins={admins || []}
      />
      <UnitFrequencyDialog
        unitName={freqRow?.unitName || ""}
        franqueadoIds={freqRow?.franqueadoIds || []}
        open={freqOpen}
        onOpenChange={setFreqOpen}
      />
    </Card>
  );
}
