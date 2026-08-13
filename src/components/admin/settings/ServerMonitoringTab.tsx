import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  Cpu,
  HardDrive,
  MemoryStick,
  Network,
  Pause,
  Play,
  RefreshCw,
  Server,
  Thermometer,
  Zap,
} from "lucide-react";
import { useServerMetrics } from "@/hooks/useServerMetrics";

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || isNaN(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[i]}`;
}

function formatUptime(seconds: number | string | null | undefined): string {
  if (typeof seconds === "string") return seconds;
  if (!seconds || isNaN(Number(seconds))) return "—";
  const s = Number(seconds);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function pctColor(pct: number): string {
  if (pct >= 90) return "text-destructive";
  if (pct >= 75) return "text-amber-500";
  return "text-emerald-600";
}

function pctBarClass(pct: number): string {
  if (pct >= 90) return "[&>div]:bg-destructive";
  if (pct >= 75) return "[&>div]:bg-amber-500";
  return "[&>div]:bg-emerald-500";
}

export function ServerMonitoringTab() {
  const [paused, setPaused] = useState(false);
  const { data, isLoading, error, refetch, isFetching } = useServerMetrics(!paused);

  if (isLoading && !data) {
    return (
      <Card>
        <CardContent className="py-10 flex items-center justify-center text-muted-foreground">
          <RefreshCw className="h-5 w-5 mr-2 animate-spin" /> Conectando ao servidor…
        </CardContent>
      </Card>
    );
  }

  if (error && !data) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Falha ao consultar servidor</AlertTitle>
        <AlertDescription className="space-y-2">
          <p className="text-sm">{(error as any)?.message || "Erro desconhecido."}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-3 w-3 mr-1" /> Tentar novamente
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const cpuTotal = Number(data?.cpu?.total ?? 0);
  const cpuUser = Number(data?.cpu?.user ?? 0);
  const cpuSystem = Number(data?.cpu?.system ?? 0);
  const cpuIowait = Number(data?.cpu?.iowait ?? 0);
  const cpuCount = Number(data?.system?.cpu_count ?? data?.load?.cpucore ?? 0);

  const memTotal = Number(data?.mem?.total ?? 0);
  const memUsed = Number(data?.mem?.used ?? 0);
  const memPct = Number(data?.mem?.percent ?? 0);
  const memAvail = Number(data?.mem?.available ?? memTotal - memUsed);

  const swapTotal = Number(data?.memswap?.total ?? 0);
  const swapUsed = Number(data?.memswap?.used ?? 0);
  const swapPct = Number(data?.memswap?.percent ?? 0);

  const load1 = Number(data?.load?.min1 ?? 0);
  const load5 = Number(data?.load?.min5 ?? 0);
  const load15 = Number(data?.load?.min15 ?? 0);

  const filesystems = (data?.fs || []).filter(
    (f: any) => f && (f.mnt_point || f.mountpoint) && Number(f.size ?? f.used) > 0,
  );

  const networks = (data?.network || []).filter(
    (n: any) => n && n.interface_name && n.interface_name !== "lo",
  );

  const sensors = (data?.sensors || []).filter(
    (s: any) => s && s.value != null && s.label,
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-3">
            <Server className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-base">Servidor monitorado</CardTitle>
              <CardDescription className="text-xs">
                {data?.host} · {data?.system?.hostname && `${data.system.hostname} · `}
                {data?.system?.os_name} {data?.system?.os_version}
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={paused ? "outline" : "default"} className="text-xs">
              {paused ? "Pausado" : isFetching ? "Atualizando…" : "Ao vivo"}
            </Badge>
            <Button variant="ghost" size="icon" onClick={() => setPaused((p) => !p)} title={paused ? "Retomar" : "Pausar"}>
              {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => refetch()} title="Atualizar agora">
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* CPU */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Cpu className="h-4 w-4 text-primary" /> CPU
            </CardTitle>
            <CardDescription className="text-xs">
              {cpuCount > 0 ? `${cpuCount} núcleos` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className={`text-3xl font-bold ${pctColor(cpuTotal)}`}>{cpuTotal.toFixed(1)}%</span>
              <span className="text-xs text-muted-foreground">total</span>
            </div>
            <Progress value={cpuTotal} className={pctBarClass(cpuTotal)} />
            <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground pt-2">
              <div>
                <div className="font-medium text-foreground">{cpuUser.toFixed(1)}%</div>
                <div>user</div>
              </div>
              <div>
                <div className="font-medium text-foreground">{cpuSystem.toFixed(1)}%</div>
                <div>system</div>
              </div>
              <div>
                <div className="font-medium text-foreground">{cpuIowait.toFixed(1)}%</div>
                <div>iowait</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Memória */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <MemoryStick className="h-4 w-4 text-primary" /> Memória
            </CardTitle>
            <CardDescription className="text-xs">
              {formatBytes(memUsed)} de {formatBytes(memTotal)}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className={`text-3xl font-bold ${pctColor(memPct)}`}>{memPct.toFixed(1)}%</span>
              <span className="text-xs text-muted-foreground">em uso</span>
            </div>
            <Progress value={memPct} className={pctBarClass(memPct)} />
            <div className="text-xs text-muted-foreground pt-2">
              Disponível: <span className="text-foreground font-medium">{formatBytes(memAvail)}</span>
            </div>
            {swapTotal > 0 && (
              <div className="pt-2 border-t">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Swap</span>
                  <span className="font-medium">{formatBytes(swapUsed)} / {formatBytes(swapTotal)}</span>
                </div>
                <Progress value={swapPct} className={`mt-1 ${pctBarClass(swapPct)}`} />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Load + Uptime */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" /> Carga & Uptime
            </CardTitle>
            <CardDescription className="text-xs">
              Uptime: {formatUptime(data?.uptime)}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-xl font-bold">{load1.toFixed(2)}</div>
                <div className="text-[10px] text-muted-foreground">1 min</div>
              </div>
              <div>
                <div className="text-xl font-bold">{load5.toFixed(2)}</div>
                <div className="text-[10px] text-muted-foreground">5 min</div>
              </div>
              <div>
                <div className="text-xl font-bold">{load15.toFixed(2)}</div>
                <div className="text-[10px] text-muted-foreground">15 min</div>
              </div>
            </div>
            {cpuCount > 0 && (
              <p className="text-xs text-muted-foreground pt-1">
                Saturação (load/cores): <span className="text-foreground font-medium">{(load1 / cpuCount * 100).toFixed(0)}%</span>
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Disco */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-primary" /> Disco
          </CardTitle>
          <CardDescription className="text-xs">
            {filesystems.length} ponto(s) de montagem
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {filesystems.length === 0 && (
            <p className="text-sm text-muted-foreground">Sem dados de disco.</p>
          )}
          {filesystems.map((f: any) => {
            const pct = Number(f.percent ?? 0);
            const mnt = f.mnt_point || f.mountpoint;
            return (
              <div key={mnt} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="font-medium truncate" title={`${mnt} (${f.device_name || f.fs_type || ""})`}>
                    {mnt}
                    <span className="text-muted-foreground ml-2">{f.device_name || f.fs_type}</span>
                  </span>
                  <span className={`font-medium ${pctColor(pct)}`}>
                    {pct.toFixed(0)}% — {formatBytes(f.used)} / {formatBytes(f.size)}
                  </span>
                </div>
                <Progress value={pct} className={pctBarClass(pct)} />
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Rede */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Network className="h-4 w-4 text-primary" /> Rede
            </CardTitle>
            <CardDescription className="text-xs">
              Taxa instantânea por interface
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {networks.length === 0 && (
              <p className="text-sm text-muted-foreground">Sem dados de rede.</p>
            )}
            {networks.map((n: any) => (
              <div key={n.interface_name} className="flex justify-between text-xs border-b last:border-b-0 pb-1">
                <span className="font-medium">{n.interface_name}</span>
                <span className="text-muted-foreground">
                  ↓ {formatBytes(n.bytes_recv_rate_per_sec ?? n.rx_per_sec ?? 0)}/s
                  {" · "}
                  ↑ {formatBytes(n.bytes_sent_rate_per_sec ?? n.tx_per_sec ?? 0)}/s
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* GPU / Sensores */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Thermometer className="h-4 w-4 text-primary" /> GPU & Sensores
            </CardTitle>
            <CardDescription className="text-xs">
              Temperaturas / ventiladores / GPU (quando disponíveis)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {sensors.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nenhum sensor disponível. (Este servidor não possui GPU dedicada.)
              </p>
            )}
            {sensors.map((s: any, idx: number) => (
              <div key={`${s.label}-${idx}`} className="flex justify-between text-xs">
                <span className="font-medium">{s.label}</span>
                <span className="text-muted-foreground">
                  {s.value}
                  {s.unit || (s.type === "temperature_core" ? "°C" : s.type === "fan_speed" ? " RPM" : "")}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <p className="text-[10px] text-muted-foreground text-right">
        Última coleta: {data?.collected_at ? new Date(data.collected_at).toLocaleTimeString("pt-BR") : "—"}
      </p>
    </div>
  );
}
