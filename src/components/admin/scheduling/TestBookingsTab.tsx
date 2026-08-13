import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MaskedDateInput } from "@/components/ui/masked-date-input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, ArrowUp, ArrowDown, ArrowUpDown, BookOpen, Eye, CalendarClock } from "lucide-react";
import { ymdToLocalDate, dateToLocalYMD, formatRelativeDateTimeBR } from "@/lib/dateUtils";
import { formatModality } from "@/lib/modalityLabel";
import { useTestBookingsList } from "@/hooks/useTestBookings";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { GuidedTest } from "@/components/admin/GuidedTest";
import { OnlineTestAnswerKeyDialog } from "@/components/admin/scheduling/OnlineTestAnswerKeyDialog";
import { TestRescheduleDialog } from "@/components/admin/scheduling/TestRescheduleDialog";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

/**
 * Status unificado para a linha (deriva de test_assignments.status + test_bookings.status).
 */
function deriveRow(a: any) {
  const booking = a.test_bookings || null;
  const isOnline = a.modality_chosen === "online";
  const isPresencial = a.modality_chosen === "presencial";

  let modalityLabel = "—";
  if (isOnline) modalityLabel = "Online";
  else if (isPresencial) modalityLabel = "Presencial";
  else modalityLabel = "Aguardando escolha";

  let dateYMD: string | null = null;
  let timeHMS: string | null = null;
  let dateLabel = "—";
  if (booking?.scheduled_date) {
    dateYMD = booking.scheduled_date;
    timeHMS = booking.scheduled_time || null;
  } else if (a.completed_at) {
    dateYMD = a.completed_at.slice(0, 10);
    timeHMS = a.completed_at.slice(11, 19);
    dateLabel = "realizado";
  } else if (isPresencial && !booking) {
    dateLabel = "Aguardando agendamento";
  } else if (!a.modality_chosen) {
    dateLabel = "Aguardando escolha";
  } else {
    dateLabel = "Não realizado";
  }

  // Score só faz sentido para online avaliado/concluido
  const showScore = isOnline && (a.score !== null && a.score !== undefined);

  // Status unificado
  let statusKey = a.status as string;
  if (booking?.status === "no_show") statusKey = "no_show";
  else if (booking?.status === "cancelado") statusKey = "cancelado";

  const STATUS_MAP: Record<string, { label: string; variant: BadgeVariant }> = {
    pendente: { label: "Aguardando", variant: "secondary" },
    released: { label: "Aguardando", variant: "secondary" },
    aguardando_agendamento: { label: "Aguardando agendamento", variant: "secondary" },
    em_andamento: { label: "Em andamento", variant: "default" },
    started: { label: "Em andamento", variant: "default" },
    concluido: { label: "Concluído", variant: "default" },
    avaliado: { label: "Avaliado", variant: "default" },
    cancelado: { label: "Cancelado", variant: "outline" },
    no_show: { label: "Não compareceu", variant: "destructive" },
  };
  const statusBadgeData = STATUS_MAP[statusKey] || { label: statusKey || "—", variant: "outline" as BadgeVariant };

  return { modalityLabel, dateYMD, timeHMS, dateLabel, showScore, statusBadgeData };
}


interface Props {
  unitId?: string;
  unitIds?: string[];
}

export function TestBookingsTab({ unitId: outerUnitId, unitIds: scopedUnitIds }: Props) {
  const { hasRole, unitIds: myUnitIds } = useAuth();
  const isSuperAdmin = hasRole("admin");

  const [selectedUnit, setSelectedUnit] = useState<string>(outerUnitId || "");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [nameSearch, setNameSearch] = useState<string>("");
  const [cargoFilter, setCargoFilter] = useState<string>("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [sortActive, setSortActive] = useState<boolean>(true);
  const [sortKey, setSortKey] = useState<"datetime" | "status">("datetime");
  const [guidedBooking, setGuidedBooking] = useState<any | null>(null);
  const [guidedReadOnly, setGuidedReadOnly] = useState(false);
  const [answerKeyApp, setAnswerKeyApp] = useState<{ id: string; name?: string | null } | null>(null);
  const [rescheduleRow, setRescheduleRow] = useState<
    { bookingId: string; applicationId: string; candidateId: string; unitId: string; oldDate: string; oldTime: string } | null
  >(null);

  useEffect(() => {
    setSelectedUnit(outerUnitId || "");
  }, [outerUnitId]);

  const { data: units } = useQuery({
    queryKey: ["units_list_test_bookings", isSuperAdmin, myUnitIds],
    queryFn: async () => {
      let q = supabase.from("units").select("id, name").eq("is_active", true).order("name");
      if (!isSuperAdmin && myUnitIds.length > 0) q = q.in("id", myUnitIds);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });

  const filters: any = {};
  if (selectedUnit) filters.unitId = selectedUnit;
  else if (scopedUnitIds && scopedUnitIds.length > 0) filters.unitIds = scopedUnitIds;
  if (statusFilter && statusFilter !== "all") filters.status = statusFilter;
  if (dateFrom) filters.dateFrom = dateFrom;
  if (dateTo) filters.dateTo = dateTo;

  const {
    data: pages,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useTestBookingsList(Object.keys(filters).length > 0 ? filters : undefined, 30);

  const bookings = useMemo(
    () => (pages?.pages.flatMap((p: any) => p.rows) ?? []) as any[],
    [pages],
  );

  // Cargos disponíveis para filtro = apenas os que aparecem nos testes carregados.
  const availableCargos = useMemo(() => {
    const set = new Set<string>();
    for (const b of bookings) {
      const t = b.applications?.unit_jobs?.jobs?.title;
      if (t) set.add(t);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [bookings]);

  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!hasNextPage || !loadMoreRef.current) return;
    const el = loadMoreRef.current;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) fetchNextPage();
      },
      { rootMargin: "200px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const toggleSort = (key: "datetime" | "status" = "datetime") => {
    if (!sortActive || sortKey !== key) {
      setSortActive(true);
      setSortKey(key);
      setSortDir("asc");
    } else {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    }
  };

  const SortIcon = ({ column = "datetime" }: { column?: "datetime" | "status" }) => {
    if (!sortActive || sortKey !== column) {
      return <ArrowUpDown className="inline h-3 w-3 ml-1 opacity-50" />;
    }
    return sortDir === "asc" ? (
      <ArrowUp className="inline h-3 w-3 ml-1" />
    ) : (
      <ArrowDown className="inline h-3 w-3 ml-1" />
    );
  };

  const list = useMemo(() => {
    const q = nameSearch.trim().toLocaleLowerCase("pt-BR");
    let filtered = q
      ? bookings.filter((b: any) => (b.candidate_name || "").toLocaleLowerCase("pt-BR").includes(q))
      : bookings;
    if (cargoFilter) {
      filtered = filtered.filter((b: any) => (b.applications?.unit_jobs?.jobs?.title || "") === cargoFilter);
    }

    if (!sortActive) return filtered;
    const dir = sortDir === "asc" ? 1 : -1;
    const effDate = (a: any) =>
      a.test_bookings?.scheduled_date || (a.completed_at ? a.completed_at.slice(0, 10) : "");
    const effTime = (a: any) =>
      a.test_bookings?.scheduled_time || (a.completed_at ? a.completed_at.slice(11, 19) : "");

    if (sortKey === "status") {
      return [...filtered].sort((a: any, b: any) => {
        const la = deriveRow(a).statusBadgeData.label || "";
        const lb = deriveRow(b).statusBadgeData.label || "";
        const cmp = la.localeCompare(lb, "pt-BR");
        if (cmp !== 0) return cmp * dir;
        // desempate estável por data/hora asc
        return `${effDate(a)}T${effTime(a)}`.localeCompare(`${effDate(b)}T${effTime(b)}`);
      });
    }

    const today = new Date();
    const todayYMD = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    return [...filtered].sort((a: any, b: any) => {
      const av = `${effDate(a)}T${effTime(a)}`;
      const bv = `${effDate(b)}T${effTime(b)}`;
      const aPast = effDate(a) < todayYMD;
      const bPast = effDate(b) < todayYMD;
      if (aPast !== bPast) return (aPast ? 1 : -1) * dir;
      const cmp = aPast ? bv.localeCompare(av) : av.localeCompare(bv);
      return cmp * dir;
    });
  }, [bookings, nameSearch, cargoFilter, sortActive, sortDir, sortKey]);


  const hasAnyFilter = !!(statusFilter || dateFrom || dateTo || nameSearch || cargoFilter);

  // Candidatos que já usaram o reagendamento de teste (limite 1 por candidato),
  // para desabilitar o botão. Escopo: apenas os candidatos visíveis na lista.
  const candidateIdsInView = useMemo(
    () => Array.from(new Set(list.map((a: any) => a.candidate_id).filter(Boolean))),
    [list],
  );
  const { data: rescheduledSet } = useQuery({
    queryKey: ["test_reschedule_used", candidateIdsInView],
    enabled: candidateIdsInView.length > 0,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("calendar_logs")
        .select("context")
        .eq("event_type", "test_reschedule")
        .in("context->>candidate_id", candidateIdsInView);
      const set = new Set<string>();
      (data || []).forEach((r: any) => {
        const cid = r?.context?.candidate_id;
        if (cid) set.add(cid);
      });
      return set;
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Testes Agendados</CardTitle>
        <CardDescription>Todos os candidatos na fase teste pós-entrevista (online e presencial)</CardDescription>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 pt-2">
          <div>
            <Label className="text-xs">Unidade</Label>
            <Select value={selectedUnit || "all"} onValueChange={(v) => setSelectedUnit(v === "all" ? "" : v)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Todas as unidades" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as unidades</SelectItem>
                {units?.map((u: any) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Buscar candidato</Label>
            <Input
              value={nameSearch}
              onChange={(e) => setNameSearch(e.target.value)}
              placeholder="Nome do candidato"
              className="h-8 text-xs"
            />
          </div>
          <div>
            <Label className="text-xs">Cargo</Label>
            <Select value={cargoFilter || "all"} onValueChange={(v) => setCargoFilter(v === "all" ? "" : v)} disabled={availableCargos.length === 0}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Todos os cargos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os cargos</SelectItem>
                {availableCargos.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="aguardando">Aguardando</SelectItem>
                <SelectItem value="em_andamento">Em andamento</SelectItem>
                <SelectItem value="concluido">Concluído</SelectItem>
                <SelectItem value="avaliado">Avaliado</SelectItem>
                <SelectItem value="no_show">Não compareceu</SelectItem>
                <SelectItem value="cancelado">Cancelado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">De</Label>
            <MaskedDateInput
              value={ymdToLocalDate(dateFrom)}
              onChange={(d) => setDateFrom(dateToLocalYMD(d))}
              format="dd/MM/yyyy"
              placeholder="De"
              size="sm"
            />
          </div>
          <div>
            <Label className="text-xs">Até</Label>
            <MaskedDateInput
              value={ymdToLocalDate(dateTo)}
              onChange={(d) => setDateTo(dateToLocalYMD(d))}
              format="dd/MM/yyyy"
              placeholder="Até"
              size="sm"
            />
          </div>
          {hasAnyFilter && (
            <Button
              size="sm"
              variant="ghost"
              className="mt-auto h-8 text-xs"
              onClick={() => {
                setStatusFilter("");
                setDateFrom("");
                setDateTo("");
                setNameSearch("");
                setCargoFilter("");
              }}
            >
              Limpar
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center p-4">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : !list.length ? (
          <p className="text-muted-foreground text-sm text-center py-4">Nenhum teste agendado encontrado.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Candidato</TableHead>
                  <TableHead>Unidade</TableHead>
                  <TableHead>Cargo</TableHead>
                  <TableHead>Modalidade</TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("datetime")}>
                    Data/Hora
                    <SortIcon column="datetime" />
                  </TableHead>
                  <TableHead className="text-right">Taxa (%)</TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => toggleSort("status")}>
                    Status
                    <SortIcon column="status" />
                  </TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((a: any) => {
                  const { modalityLabel, dateYMD, timeHMS, dateLabel, showScore, statusBadgeData } = deriveRow(a);
                  const isPresencial = a.modality_chosen === "presencial";
                  const isOnline = a.modality_chosen === "online";
                  // "Já avaliado" no presencial = avaliação presencial registrada
                  // (test_feedback). NÃO usar status==="avaliado", que é setado pela
                  // conclusão do teste ONLINE (step_response) e escondia o "Aplicar teste".
                  const alreadyEvaluated = a.presencial_evaluated === true;
                  const onlineHasResponse = isOnline && (a.status === "avaliado" || a.status === "concluido" || a.completed_at);
                  return (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium name-display">{a.candidate_name || "—"}</TableCell>
                      <TableCell>{a.applications?.unit_jobs?.units?.name || "—"}</TableCell>
                      <TableCell>{a.applications?.unit_jobs?.jobs?.title || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{modalityLabel}</Badge>
                      </TableCell>
                      <TableCell>
                        {dateYMD ? formatRelativeDateTimeBR(dateYMD, timeHMS || undefined) : (
                          <span className="text-muted-foreground text-xs">{dateLabel}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {showScore ? `${Math.round(Number(a.score))}%` : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeData.variant}>{statusBadgeData.label}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {isPresencial && alreadyEvaluated ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 text-xs"
                            onClick={() => {
                              setGuidedBooking({
                                ...(a.test_bookings || {}),
                                application_id: a.application_id,
                                candidate_name: a.candidate_name,
                                applications: a.applications,
                                unit_id: a.test_bookings?.unit_id || a.applications?.unit_jobs?.unit_id,
                              });
                              setGuidedReadOnly(true);
                            }}
                          >
                            <Eye className="h-3.5 w-3.5 mr-1" /> Ver
                          </Button>
                        ) : isPresencial ? (
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 text-xs"
                              onClick={() => {
                                setGuidedBooking({
                                  ...(a.test_bookings || {}),
                                  application_id: a.application_id,
                                  candidate_name: a.candidate_name,
                                  applications: a.applications,
                                  unit_id: a.test_bookings?.unit_id || a.applications?.unit_jobs?.unit_id,
                                });
                                setGuidedReadOnly(false);
                              }}
                            >
                              <BookOpen className="h-3.5 w-3.5 mr-1" /> Aplicar teste
                            </Button>
                            {a.test_bookings?.id && a.test_bookings?.status === "agendado" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 text-xs"
                                disabled={rescheduledSet?.has(a.candidate_id)}
                                title={rescheduledSet?.has(a.candidate_id) ? "Reagendamento já utilizado" : "Reagendar teste"}
                                onClick={() =>
                                  setRescheduleRow({
                                    bookingId: a.test_bookings.id,
                                    applicationId: a.application_id,
                                    candidateId: a.candidate_id,
                                    unitId: a.test_bookings?.unit_id || a.applications?.unit_jobs?.unit_id,
                                    oldDate: a.test_bookings.scheduled_date,
                                    oldTime: a.test_bookings.scheduled_time,
                                  })
                                }
                              >
                                <CalendarClock className="h-3.5 w-3.5 mr-1" /> Reagendar
                              </Button>
                            )}
                          </div>
                        ) : onlineHasResponse ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 text-xs"
                            onClick={() =>
                              setAnswerKeyApp({ id: a.application_id, name: a.candidate_name })
                            }
                          >
                            <Eye className="h-3.5 w-3.5 mr-1" /> Ver gabarito
                          </Button>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        {hasNextPage && (
          <div ref={loadMoreRef} className="flex justify-center py-4">
            {isFetchingNextPage ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <Button variant="ghost" size="sm" onClick={() => fetchNextPage()}>
                Carregar mais
              </Button>
            )}
          </div>
        )}
      </CardContent>
      {guidedBooking && (
        <GuidedTest
          booking={guidedBooking}
          open={!!guidedBooking}
          onOpenChange={(o) => { if (!o) { setGuidedBooking(null); setGuidedReadOnly(false); } }}
          readOnly={guidedReadOnly}
        />
      )}
      {answerKeyApp && (
        <OnlineTestAnswerKeyDialog
          open={!!answerKeyApp}
          onOpenChange={(o) => { if (!o) setAnswerKeyApp(null); }}
          applicationId={answerKeyApp.id}
          candidateName={answerKeyApp.name}
        />
      )}
      {rescheduleRow && (
        <TestRescheduleDialog
          bookingId={rescheduleRow.bookingId}
          applicationId={rescheduleRow.applicationId}
          candidateId={rescheduleRow.candidateId}
          unitId={rescheduleRow.unitId}
          oldDate={rescheduleRow.oldDate}
          oldTime={rescheduleRow.oldTime}
          open={!!rescheduleRow}
          onOpenChange={(o) => { if (!o) setRescheduleRow(null); }}
          onRescheduled={() => setRescheduleRow(null)}
        />
      )}
    </Card>
  );
}
