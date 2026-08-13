import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Gauge, Building2, Users, Activity, Loader2, Trophy, AlertTriangle, CheckCircle2,
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { useUnitUsage, useActiveUsers, type UnitUsage } from "@/hooks/useUnitUsage";

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/**
 * Utilização / adesão da plataforma pelos franqueados/gestores.
 * Itens 2, 3, 5 e 6: % de utilização, evolução no tempo, ranking de uso e
 * destaque de baixa aderência. Distinta dos indicadores de recrutamento.
 */

function StatCard({ icon: Icon, label, value, suffix }: { icon: React.ElementType; label: string; value: number | string; suffix?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground mb-1">
          <Icon className="h-4 w-4" />
          <span className="text-xs">{label}</span>
        </div>
        <p className="text-2xl font-bold text-foreground">
          {value}{suffix}
        </p>
      </CardContent>
    </Card>
  );
}

function lastActivityLabel(u: UnitUsage): string {
  if (u.daysSinceLast === null) return "sem atividade";
  if (u.daysSinceLast === 0) return "hoje";
  if (u.daysSinceLast === 1) return "há 1 dia";
  return `há ${u.daysSinceLast} dias`;
}

export function PlatformUsageSection() {
  const { data, isLoading } = useUnitUsage(30, 8);
  const units = useMemo<UnitUsage[]>(() => data?.units ?? [], [data]);
  const net = data?.network;

  const [usersOpen, setUsersOpen] = useState(false);
  const { data: activeUsers, isLoading: usersLoading } = useActiveUsers(net?.windowDays ?? 30, usersOpen);

  const ranking = useMemo(
    () => [...units].sort((a, b) => b.actions - a.actions || (a.daysSinceLast ?? 9e9) - (b.daysSinceLast ?? 9e9)),
    [units],
  );

  // Baixa aderência: unidades da base sem atividade no período (ou nunca).
  const lowAdherence = useMemo(
    () =>
      [...units]
        .filter((u) => u.actions === 0)
        .sort((a, b) => (b.daysSinceLast ?? 9e9) - (a.daysSinceLast ?? 9e9)),
    [units],
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Gauge className="h-5 w-5 text-primary" />
          Utilização da Plataforma
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Adesão dos franqueados/gestores ao sistema (últimos {net?.windowDays ?? 30} dias), a partir das ações registradas. Base = unidades com responsável atribuído.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !net || net.baseUnits === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-8">
          Nenhuma unidade com franqueado/gestor atribuído para medir utilização.
        </p>
      ) : (
        <>
          {/* KPIs de utilização */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Gauge className="h-4 w-4" />
                  <span className="text-xs">% de utilização</span>
                </div>
                <p className="text-2xl font-bold text-foreground mb-2">{net.usagePct}%</p>
                <Progress value={net.usagePct} className="h-1.5" />
              </CardContent>
            </Card>
            <StatCard icon={Building2} label="Unidades ativas" value={`${net.activeUnits}/${net.baseUnits}`} />
            <button type="button" onClick={() => setUsersOpen(true)} className="text-left">
              <Card className="h-full cursor-pointer transition-shadow hover:ring-2 hover:ring-primary/40">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <Users className="h-4 w-4" />
                    <span className="text-xs">Usuários ativos</span>
                  </div>
                  <p className="text-2xl font-bold text-foreground">{net.activeUsers}/{net.assignedUsers}</p>
                  <p className="text-[11px] text-primary mt-1">Ver detalhes →</p>
                </CardContent>
              </Card>
            </button>
            <StatCard icon={Activity} label={`Ações (${net.windowDays}d)`} value={net.actions} />
          </div>

          {/* Evolução da utilização ao longo do tempo */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Evolução da utilização (8 semanas)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={data.weekly}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="week" className="text-xs" />
                  <YAxis allowDecimals={false} className="text-xs" />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="actions" name="Ações" stroke="hsl(var(--primary))" strokeWidth={2} />
                  <Line type="monotone" dataKey="activeUnits" name="Unidades ativas" stroke="hsl(142 76% 36%)" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Ranking de utilização */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-emerald-600" /> Ranking de utilização
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {ranking.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem dados.</p>
                ) : (
                  ranking.map((u, i) => (
                    <div key={u.unitId} className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="text-muted-foreground w-5 shrink-0">{i + 1}º</span>
                        <span className="truncate">{u.unitName}</span>
                      </span>
                      <span className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-muted-foreground">{lastActivityLabel(u)}</span>
                        <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 border-emerald-300">
                          {u.actions} ações
                        </Badge>
                      </span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {/* Baixa aderência */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600" /> Baixa aderência
                </CardTitle>
              </CardHeader>
              <CardContent>
                {lowAdherence.length === 0 ? (
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Todas as unidades ativas no período.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {lowAdherence.map((u) => (
                      <div key={u.unitId} className="flex items-center justify-between gap-3 rounded-md border border-border p-2.5">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{u.unitName}</p>
                          <p className="text-xs text-muted-foreground">
                            {[u.city, u.state].filter(Boolean).join(" – ") || "—"}
                          </p>
                        </div>
                        <Badge variant="secondary" className="bg-amber-100 text-amber-800 border-amber-300 shrink-0">
                          {lastActivityLabel(u)}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <Dialog open={usersOpen} onOpenChange={setUsersOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Usuários ativos ({net?.windowDays ?? 30} dias)</DialogTitle>
          </DialogHeader>
          {usersLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !activeUsers || activeUsers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Nenhum usuário ativo no período.</p>
          ) : (
            <div className="space-y-2">
              {activeUsers.map((u) => (
                <div key={u.userId} className="rounded-md border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium truncate">{u.name}</p>
                    <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 border-emerald-300 shrink-0">
                      {u.actions} ações
                    </Badge>
                  </div>
                  {u.units.length > 0 && (
                    <p className="text-xs text-muted-foreground truncate">{u.units.join(" · ")}</p>
                  )}
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-[11px] text-muted-foreground">
                    <span>Último login: {fmtDateTime(u.lastLogin)}</span>
                    <span>Último acesso: {fmtDateTime(u.lastSeen)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
