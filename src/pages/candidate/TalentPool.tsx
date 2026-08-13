import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Star, CheckCircle, XCircle, Clock, Sparkles, Briefcase, Search, ClipboardCheck, UserCheck, LogOut, Building2, MapPin, Gift, Eye, X, Settings2, History } from "lucide-react";
import { useAvailableJobs, useDistinctStates, useCitiesByState } from "@/hooks/useUnitSearch";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  useTalentPoolEntry,
  useUpdateTalentPoolEntry,
  useTalentInvites,
  useRespondInvite,
  useManualTalentSignup,
  useWithdrawTalentPool,
  useMyTalentPoolLogs,
  INVITE_EXPIRY_HOURS,
} from "@/hooks/useTalentPool";
import { useMyApplications } from "@/hooks/useApplications";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHelp } from "@/components/ui/page-help";

const statusLabels: Record<string, string> = {
  active: "Ativo",
  in_process: "Em processo",
  on_hold: "Em espera",
  hired: "Contratado",
  opt_out: "Desativado",
  archived: "Arquivado",
};

const inviteStatusIcon: Record<string, React.ReactNode> = {
  pending: <Clock className="h-4 w-4 text-warning" />,
  accepted: <CheckCircle className="h-4 w-4 text-primary" />,
  declined: <XCircle className="h-4 w-4 text-destructive" />,
  expired: <Clock className="h-4 w-4 text-muted-foreground" />,
};

// Prazo de aceite do convite (INVITE_EXPIRY_HOURS a partir de invited_at).
function inviteTimeLeft(invitedAt: string | null | undefined) {
  if (!invitedAt) return null;
  const start = new Date(invitedAt).getTime();
  if (Number.isNaN(start)) return null;
  const msLeft = start + INVITE_EXPIRY_HOURS * 60 * 60 * 1000 - Date.now();
  return { msLeft, expired: msLeft <= 0 };
}

function formatInviteTimeLeft(msLeft: number) {
  const hours = msLeft / (60 * 60 * 1000);
  if (hours >= 24) {
    const d = Math.ceil(hours / 24);
    return `Expira em ${d} dia${d > 1 ? "s" : ""}`;
  }
  if (hours >= 1) return `Expira em ${Math.ceil(hours)}h`;
  return `Expira em ${Math.max(1, Math.ceil(msLeft / (60 * 1000)))} min`;
}

// Application status for the candidate journey card
const appStatusConfig: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  pendente: { label: "Aguardando Chamada", icon: <Clock className="h-4 w-4" />, color: "text-yellow-600" },
  em_andamento: { label: "Processo Seletivo", icon: <ClipboardCheck className="h-4 w-4" />, color: "text-blue-600" },
  contratado: { label: "Contratado", icon: <UserCheck className="h-4 w-4" />, color: "text-green-600" },
  reprovado: { label: "Disponível para Oportunidades", icon: <Clock className="h-4 w-4" />, color: "text-yellow-600" },
  desistente: { label: "Desistente", icon: <XCircle className="h-4 w-4" />, color: "text-muted-foreground" },
};

function PreferencesEditor({
  preferredRoles,
  preferredRegions,
  onSave,
  isPending,
}: {
  preferredRoles: string[];
  preferredRegions: string[];
  onSave: (roles: string[], regions: string[]) => void;
  isPending: boolean;
}) {
  const [roles, setRoles] = useState<string[]>(preferredRoles);
  const [regions, setRegions] = useState<string[]>(preferredRegions);
  const [editing, setEditing] = useState(false);
  const [selectedState, setSelectedState] = useState<string | null>(null);

  const { data: availableJobs } = useAvailableJobs();
  const { data: states } = useDistinctStates();
  const { data: citiesByState } = useCitiesByState(selectedState);

  const jobOptions = (availableJobs || [])
    .map((j) => j.title)
    .filter((t) => !roles.includes(t));

  const cityOptions = (citiesByState || [])
    .filter((c) => !regions.includes(`${c} - ${selectedState}`));

  const hasChanges =
    JSON.stringify(roles) !== JSON.stringify(preferredRoles) ||
    JSON.stringify(regions) !== JSON.stringify(preferredRegions);

  if (!editing) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
                <Settings2 className="h-4 w-4" /> Preferências de vagas
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {roles.length > 0 || regions.length > 0
                  ? `${roles.length} cargo(s), ${regions.length} região(ões)`
                  : "Nenhuma preferência definida"}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Editar</Button>
          </div>
          {(roles.length > 0 || regions.length > 0) && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {roles.map((r) => (
                <Badge key={r} variant="default" className="text-xs">{r}</Badge>
              ))}
              {regions.map((r) => (
                <Badge key={r} variant="outline" className="text-xs">{r}</Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/30">
      <CardContent className="p-4 space-y-4">
        <p className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <Settings2 className="h-4 w-4" /> Editar preferências
        </p>

        {/* Roles */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Cargos de interesse</label>
          <Select
            value=""
            onValueChange={(val) => {
              if (val && !roles.includes(val)) setRoles([...roles, val]);
            }}
          >
            <SelectTrigger className="text-sm">
              <SelectValue placeholder="Selecione um cargo" />
            </SelectTrigger>
            <SelectContent>
              {jobOptions.map((title) => (
                <SelectItem key={title} value={title}>{title}</SelectItem>
              ))}
              {jobOptions.length === 0 && (
                <p className="text-xs text-muted-foreground p-2 text-center">Nenhum cargo disponível</p>
              )}
            </SelectContent>
          </Select>
          <div className="flex flex-wrap gap-1.5">
            {roles.map((r) => (
              <Badge key={r} variant="default" className="text-xs gap-1">
                {r}
                <button onClick={() => setRoles(roles.filter((x) => x !== r))} className="ml-0.5">
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        </div>

        {/* Regions — State then City */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Regiões de interesse</label>
          <div className="grid grid-cols-2 gap-2">
            <Select
              value={selectedState || ""}
              onValueChange={(val) => { setSelectedState(val || null); }}
            >
              <SelectTrigger className="text-sm">
                <SelectValue placeholder="Estado (UF)" />
              </SelectTrigger>
              <SelectContent>
                {(states || []).map((st) => (
                  <SelectItem key={st} value={st}>{st}</SelectItem>
                ))}
                {(!states || states.length === 0) && (
                  <p className="text-xs text-muted-foreground p-2 text-center">Nenhum estado</p>
                )}
              </SelectContent>
            </Select>
            <Select
              value=""
              disabled={!selectedState}
              onValueChange={(val) => {
                if (val && selectedState) {
                  const label = `${val} - ${selectedState}`;
                  if (!regions.includes(label)) setRegions([...regions, label]);
                }
              }}
            >
              <SelectTrigger className="text-sm">
                <SelectValue placeholder="Cidade" />
              </SelectTrigger>
              <SelectContent>
                {cityOptions.map((city) => (
                  <SelectItem key={city} value={city}>{city}</SelectItem>
                ))}
                {cityOptions.length === 0 && (
                  <p className="text-xs text-muted-foreground p-2 text-center">Nenhuma cidade</p>
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {regions.map((r) => (
              <Badge key={r} variant="outline" className="text-xs gap-1">
                {r}
                <button onClick={() => setRegions(regions.filter((x) => x !== r))} className="ml-0.5">
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            onClick={() => { onSave(roles, regions); setEditing(false); }}
            disabled={!hasChanges || isPending}
          >
            {isPending ? "Salvando..." : "Salvar preferências"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setRoles(preferredRoles); setRegions(preferredRegions); setEditing(false); }}>
            Cancelar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}


export default function CandidateTalentPool() {
  const { data: entry, isLoading } = useTalentPoolEntry();
  const updateEntry = useUpdateTalentPoolEntry();
  const { data: invites, isLoading: loadingInvites } = useTalentInvites();
  // Convites pendentes que passaram do prazo (72h) somem da lista; histórico
  // (aceito/recusado/expirado) continua visível.
  const visibleInvites = (invites || []).filter((inv: any) => {
    if (inv.status !== "pending") return true;
    const t = inviteTimeLeft(inv.invited_at);
    return !t || !t.expired;
  });
  const { data: myApps } = useMyApplications();
  const respondInvite = useRespondInvite();
  const manualSignup = useManualTalentSignup();
  const withdrawTalent = useWithdrawTalentPool();
  const { data: logs } = useMyTalentPoolLogs();
  const [selectedJobId, setSelectedJobId] = useState("");
  const [previewJob, setPreviewJob] = useState<any>(null);

  // Open jobs for manual signup
  const { data: openJobs } = useQuery({
    queryKey: ["open_unit_jobs_talent"],
    queryFn: async () => {
      const { data } = await supabase
        .from("unit_jobs")
        .select("id, salary, work_model, openings, jobs(title, description, benefits), units(name, city, state)")
        .eq("status", "aberta");
      return data || [];
    },
    enabled: !entry,
  });

  const handleSelectJob = (jobId: string) => {
    setSelectedJobId(jobId);
    const found = (openJobs || []).find((uj: any) => uj.id === jobId);
    if (found) setPreviewJob(found);
  };

  // Check if candidate is already hired
  const isHired = (myApps || []).some((a: any) => a.status === "contratado");

  if (isLoading) {
    return (
      <div className="px-4 pt-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const hasEntry = !!entry;
  const isActive = entry?.status === "active";

  const handleToggle = (checked: boolean) => {
    updateEntry.mutate({ status: checked ? "active" : "opt_out" });
  };

  // Derive candidate journey status from applications
  const journeyStatus = (() => {
    if (!myApps || myApps.length === 0) return { key: "em_busca", label: "Em Busca de Vaga", icon: <Search className="h-4 w-4" />, color: "text-primary" };
    const hired = myApps.find((a: any) => a.status === "contratado");
    if (hired) return appStatusConfig.contratado;
    const inProgress = myApps.find((a: any) => a.status === "em_andamento");
    if (inProgress) return appStatusConfig.em_andamento;
    const pending = myApps.find((a: any) => a.status === "pendente");
    if (pending) return appStatusConfig.pendente;
    return { key: "em_busca", label: "Em Busca de Vaga", icon: <Search className="h-4 w-4" />, color: "text-primary" };
  })();

  return (
    <div className="px-4 pt-6 space-y-6 pb-4">
      <div>
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-display font-bold text-foreground flex items-center gap-2">
            <Star className="h-5 w-5 text-primary" /> Meu Perfil de Talentos
          </h1>
          <PageHelp />
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          {hasEntry ? "Gerencie suas preferências e veja convites" : "Mantenha seu perfil atualizado para receber convites compatíveis."}
        </p>
      </div>

      {/* Journey Status Card */}
      <Card>
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground mb-1">Sua situação atual</p>
          <div className={`flex items-center gap-2 font-semibold ${journeyStatus.color}`}>
            {journeyStatus.icon}
            <span>{journeyStatus.label}</span>
          </div>
        </CardContent>
      </Card>

      {/* Signup Card — only if no entry exists */}
      {!hasEntry && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mx-auto">
              <Sparkles className="h-8 w-8 text-primary" />
            </div>
            <div className="text-center">
              <p className="text-base font-semibold text-foreground">Faça parte do Banco de Talentos</p>
              <p className="text-sm text-muted-foreground mt-1">
                Escolha a vaga de seu interesse e receba convites de oportunidades compatíveis.
              </p>
            </div>

            {isHired ? (
              <div className="text-center p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                <p className="text-sm font-medium text-green-700 dark:text-green-300">
                  Você já foi contratado(a). O cadastro no Banco de Talentos não está disponível.
                </p>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground flex items-center gap-1">
                    <Briefcase className="h-4 w-4" /> Vaga de interesse
                  </label>
                  <Select value={selectedJobId} onValueChange={handleSelectJob}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione a vaga desejada" />
                    </SelectTrigger>
                    <SelectContent>
                      {(openJobs || []).map((uj: any) => (
                        <SelectItem key={uj.id} value={uj.id}>
                          {uj.jobs?.title} — {uj.units?.name} ({uj.units?.city}/{uj.units?.state})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedJobId && previewJob && (
                  <Button
                    variant="outline"
                    onClick={() => setPreviewJob({ ...previewJob, _showDialog: true })}
                    className="w-full gap-2"
                  >
                    <Eye className="h-4 w-4" /> Ver detalhes da vaga
                  </Button>
                )}

                <Button
                  onClick={() => manualSignup.mutate({ unitJobId: selectedJobId })}
                  disabled={!selectedJobId || manualSignup.isPending}
                  className="w-full"
                >
                  {manualSignup.isPending ? "Cadastrando..." : "Cadastrar no Banco de Talentos"}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Vaga cadastrada — only when entry exists and has job info */}
      {hasEntry && (entry as any)?.jobs?.title && (
        <div>
          <h2 className="text-base font-semibold text-foreground mb-3">Vaga de interesse</h2>
          <Card className="border-primary/20">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 shrink-0">
                  <Briefcase className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">{(entry as any).jobs.title}</p>
                  {(entry as any)?.units && (
                    <p className="text-xs text-muted-foreground">
                      {(entry as any).units.name} — {(entry as any).units.city}/{(entry as any).units.state}
                    </p>
                  )}
                </div>
                <Badge variant="outline" className="shrink-0">Cadastrado</Badge>
              </div>
              <div className="flex justify-end mt-3 pt-3 border-t">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5">
                      <LogOut className="h-4 w-4" />
                      Desistir da vaga
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Desistir do Banco de Talentos?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Você será removido(a) do Banco de Talentos e deixará de receber convites para esta vaga. Você poderá se cadastrar novamente depois.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => withdrawTalent.mutate()}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Confirmar desistência
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Status Card — only when entry exists */}
      {hasEntry && (
      <Card>
        <CardContent className="flex items-center justify-between p-4">
          <div>
            <p className="text-sm font-medium text-foreground">Receber novas oportunidades</p>
            <p className="text-xs text-muted-foreground">
              Status: <Badge variant={isActive ? "default" : "secondary"}>{statusLabels[entry?.status || "active"]}</Badge>
            </p>
          </div>
          <Switch
            checked={isActive}
            onCheckedChange={handleToggle}
            disabled={updateEntry.isPending}
          />
        </CardContent>
      </Card>
      )}

      {/* On Hold Highlight */}
      {hasEntry && entry?.status === "on_hold" && (
        <Card className="border-yellow-400 dark:border-yellow-600 bg-yellow-50 dark:bg-yellow-900/20">
          <CardContent className="p-4 space-y-1">
            <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-300">Você está em lista de espera</p>
            {(entry as any).standby_reason && (
              <p className="text-xs text-yellow-700 dark:text-yellow-400">Motivo: {(entry as any).standby_reason}</p>
            )}
            <p className="text-xs text-muted-foreground">Aguarde novos convites de vagas compatíveis.</p>
          </CardContent>
        </Card>
      )}


      {/* Preferences Editor */}
      {hasEntry && (
        <PreferencesEditor
          preferredRoles={(entry as any)?.preferred_roles || []}
          preferredRegions={(entry as any)?.preferred_regions || []}
          onSave={(roles, regions) => updateEntry.mutate({ preferred_roles: roles, preferred_regions: regions })}
          isPending={updateEntry.isPending}
        />
      )}

      {/* Minhas Candidaturas */}
      {myApps && myApps.length > 0 && (
        <div>
          <h2 className="text-base font-semibold text-foreground mb-3">Minhas Candidaturas</h2>
          <div className="space-y-3">
            {myApps.map((app: any) => {
              const statusMap: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
                pendente: { label: "Pendente", variant: "outline" },
                em_andamento: { label: "Em Andamento", variant: "default" },
                contratado: { label: "Contratado", variant: "default" },
                reprovado: { label: "Disponível para Oportunidades", variant: "outline" },
                desistente: { label: "Desistente", variant: "secondary" },
                standby: { label: "Standby", variant: "outline" },
              };
              const st = statusMap[app.status] || { label: app.status, variant: "secondary" as const };
              return (
                <Card key={app.id}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-foreground truncate">
                          {app.unit_jobs?.jobs?.title || "Vaga"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {app.unit_jobs?.units?.name} — {app.unit_jobs?.units?.city}/{app.unit_jobs?.units?.state}
                        </p>
                        {app.pipeline_phases?.name && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Fase: {app.pipeline_phases.name}
                          </p>
                        )}
                      </div>
                      <Badge variant={st.variant}>{st.label}</Badge>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Invites */}
      {hasEntry && (
      <div>
        <h2 className="text-base font-semibold text-foreground mb-3">Convites recebidos</h2>
        {loadingInvites ? (
          <Skeleton className="h-24 w-full" />
        ) : visibleInvites.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center space-y-3">
            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-primary/10">
              <Sparkles className="h-8 w-8 text-primary" />
            </div>
            <p className="text-sm font-medium text-foreground">Nenhum convite ainda</p>
            <p className="text-xs text-muted-foreground max-w-[250px]">
              Mantenha seu perfil ativo e completo — recrutadores estão buscando talentos como você!
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {visibleInvites.map((inv: any) => (
              <Card key={inv.id} className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setPreviewJob({ ...inv.unit_jobs, _showDialog: true, _inviteId: inv.id, _inviteStatus: inv.status })}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {inv.unit_jobs?.jobs?.title || "Vaga"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {inv.unit_jobs?.units?.name} — {inv.unit_jobs?.units?.city}/{inv.unit_jobs?.units?.state}
                      </p>
                    </div>
                    {inviteStatusIcon[inv.status]}
                  </div>
                  {inv.status === "pending" && (() => {
                    const t = inviteTimeLeft(inv.invited_at);
                    return t ? (
                      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Clock className="h-3 w-3 shrink-0" /> {formatInviteTimeLeft(t.msLeft)}
                      </p>
                    ) : null;
                  })()}
                  {inv.status === "pending" && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); respondInvite.mutate({ id: inv.id, status: "accepted" }); }}
                        disabled={respondInvite.isPending}
                      >
                        Aceitar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => { e.stopPropagation(); respondInvite.mutate({ id: inv.id, status: "declined" }); }}
                        disabled={respondInvite.isPending}
                      >
                        Recusar
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
      )}

      {/* Histórico de Atividades */}
      {hasEntry && logs && logs.length > 0 && (
        <div>
          <h2 className="text-base font-semibold text-foreground mb-3 flex items-center gap-1.5">
            <History className="h-4 w-4" /> Histórico
          </h2>
          <div className="space-y-2">
            {logs.slice(0, 10).map((log: any) => {
              const eventLabels: Record<string, string> = {
                auto_enrolled: "Cadastrado automaticamente no Banco de Talentos",
                opt_in: "Ativou recebimento de oportunidades",
                opt_out: "Desativou recebimento de oportunidades",
                invited: "Convidado para processo seletivo",
                accepted: "Aceitou convite para processo seletivo",
                declined: "Recusou convite para processo seletivo",
                reactivated: "Perfil reativado no Banco de Talentos",
                withdrawn: "Saiu do Banco de Talentos",
                status_change: "Status atualizado",
              };
              return (
                <div key={log.id} className="flex items-start gap-2 text-sm">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-foreground">{eventLabels[log.event] || log.event}</p>
                    {log.context?.job_title && (
                      <p className="text-xs text-muted-foreground">Vaga: {log.context.job_title}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {new Date(log.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Job Preview Dialog */}
      <Dialog
        open={!!previewJob?._showDialog}
        onOpenChange={(open) => {
          if (!open) setPreviewJob((prev: any) => prev ? { ...prev, _showDialog: false } : null);
        }}
      >
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{previewJob?.jobs?.title}</DialogTitle>
          </DialogHeader>
          {previewJob && (
            <div className="space-y-4">
              <div className="space-y-1 text-sm text-muted-foreground">
                <div className="flex items-center gap-1.5"><Building2 className="h-4 w-4" />{previewJob.units?.name}</div>
                <div className="flex items-center gap-1.5"><MapPin className="h-4 w-4" />{previewJob.units?.city}, {previewJob.units?.state}</div>
                {previewJob.work_model && (
                  <div className="flex items-center gap-1.5"><Briefcase className="h-4 w-4" />{previewJob.work_model}</div>
                )}
                {previewJob.openings && (
                  <p className="text-xs">Vagas disponíveis: {previewJob.openings}</p>
                )}
              </div>

              {previewJob.jobs?.description && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Descrição</p>
                  <p className="text-sm text-foreground whitespace-pre-line">{previewJob.jobs.description}</p>
                </div>
              )}

              {previewJob.salary && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Salário</p>
                  <p className="text-lg font-semibold text-primary">R$ {Number(previewJob.salary).toLocaleString("pt-BR")}</p>
                </div>
              )}

              {Array.isArray(previewJob.jobs?.benefits) && previewJob.jobs?.benefits.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1"><Gift className="h-3.5 w-3.5" />Benefícios</p>
                  <div className="flex flex-wrap gap-1.5">
                    {previewJob.jobs?.benefits.map((b: string, i: number) => (
                      <Badge key={i} variant="outline" className="text-xs">{b}</Badge>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-2">
                {previewJob._inviteId ? (
                  previewJob._inviteStatus === "pending" ? (
                    <div className="flex gap-2">
                      <Button
                        className="flex-1"
                        onClick={() => {
                          setPreviewJob((prev: any) => prev ? { ...prev, _showDialog: false } : null);
                          respondInvite.mutate({ id: previewJob._inviteId, status: "accepted" });
                        }}
                        disabled={respondInvite.isPending}
                      >
                        Aceitar Convite
                      </Button>
                      <Button
                        className="flex-1"
                        variant="outline"
                        onClick={() => {
                          setPreviewJob((prev: any) => prev ? { ...prev, _showDialog: false } : null);
                          respondInvite.mutate({ id: previewJob._inviteId, status: "declined" });
                        }}
                        disabled={respondInvite.isPending}
                      >
                        Recusar
                      </Button>
                    </div>
                  ) : (
                    <p className="text-center text-sm text-muted-foreground">
                      Convite {previewJob._inviteStatus === "accepted" ? "aceito" : previewJob._inviteStatus === "declined" ? "recusado" : previewJob._inviteStatus}
                    </p>
                  )
                ) : (
                <Button
                  className="w-full"
                  onClick={() => {
                    setPreviewJob((prev: any) => prev ? { ...prev, _showDialog: false } : null);
                    manualSignup.mutate({ unitJobId: selectedJobId });
                  }}
                  disabled={manualSignup.isPending}
                >
                  {manualSignup.isPending ? "Cadastrando..." : "Cadastrar no Banco de Talentos"}
                </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
