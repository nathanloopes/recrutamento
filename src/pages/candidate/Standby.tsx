import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock, Sparkles, Briefcase, Building2, MapPin, Gift, Eye, CheckCircle, Star } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTalentPoolEntry, useTalentInvites, useRespondInvite, useMyTalentPoolLogs } from "@/hooks/useTalentPool";
import { useMyApplications } from "@/hooks/useApplications";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { PageHelp } from "@/components/ui/page-help";

export default function Standby() {
  const navigate = useNavigate();
  const { data: entry, isLoading } = useTalentPoolEntry();
  const { data: invites, isLoading: loadingInvites } = useTalentInvites();
  const { data: myApps } = useMyApplications();
  const respondInvite = useRespondInvite();
  const { data: logs } = useMyTalentPoolLogs();
  const [previewJob, setPreviewJob] = useState<any>(null);

  // Available opportunities the candidate can browse
  const { data: opportunities } = useQuery({
    queryKey: ["standby_opportunities"],
    queryFn: async () => {
      const { data } = await supabase
        .from("unit_jobs")
        .select("id, salary, work_model, openings, jobs(title, description, benefits), units(name, city, state)")
        .eq("status", "aberta")
        .order("created_at", { ascending: false })
        .limit(20);
      return data || [];
    },
  });

  if (isLoading) {
    return (
      <div className="px-4 pt-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  // Standby apps (rejected → now "Lista de Oportunidade")
  const standbyApps = (myApps || []).filter((a: any) => a.status === "reprovado" || a.status === "standby");
  const activeApps = (myApps || []).filter((a: any) => a.status === "em_andamento" || a.status === "pendente");
  const isOnHold = entry?.status === "on_hold";
  const pendingInvites = (invites || []).filter((i: any) => i.status === "pending");

  return (
    <div className="px-4 pt-6 space-y-6 pb-4">
      <div>
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-display font-bold text-foreground flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" /> Convites Recebidos
          </h1>
          <PageHelp />
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Vagas em que recrutadores te convidaram. Você decide se quer participar.
        </p>
      </div>

      {/* Status Card */}
      <Card className={isOnHold ? "border-yellow-400 dark:border-yellow-600 bg-yellow-50 dark:bg-yellow-900/20" : "border-primary/30 bg-primary/5"}>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center gap-2">
            {isOnHold ? (
              <Clock className="h-5 w-5 text-yellow-600" />
            ) : (
              <Sparkles className="h-5 w-5 text-primary" />
            )}
            <p className="text-sm font-semibold">
              {isOnHold ? "Em lista de espera" : "Disponível para oportunidades"}
            </p>
          </div>
          {isOnHold && (entry as any)?.standby_reason && (
            <p className="text-xs text-yellow-700 dark:text-yellow-400">Motivo: {(entry as any).standby_reason}</p>
          )}
          {entry && (
            <p className="text-xs text-muted-foreground">
              Score global: <span className="font-semibold text-primary">{entry.global_score ?? 0}</span>
            </p>
          )}
          {activeApps.length > 0 && (
            <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
              <CheckCircle className="h-3.5 w-3.5" />
              Você tem {activeApps.length} candidatura(s) ativa(s)
            </p>
          )}
        </CardContent>
      </Card>

      {/* Pending Invites */}
      {pendingInvites.length > 0 && (
        <div>
          <h2 className="text-base font-semibold text-foreground mb-3 flex items-center gap-1.5">
            <Star className="h-4 w-4 text-yellow-500" /> Convites pendentes ({pendingInvites.length})
          </h2>
          <div className="space-y-3">
            {pendingInvites.map((inv: any) => (
              <Card key={inv.id} className="border-primary/20">
                <CardContent className="p-4 space-y-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {inv.unit_jobs?.jobs?.title || "Vaga"}
                    </p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Building2 className="h-3 w-3" />
                      {inv.unit_jobs?.units?.name} — {inv.unit_jobs?.units?.city}/{inv.unit_jobs?.units?.state}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => respondInvite.mutate({ id: inv.id, status: "accepted" })}
                      disabled={respondInvite.isPending}
                    >
                      Aceitar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => respondInvite.mutate({ id: inv.id, status: "declined" })}
                      disabled={respondInvite.isPending}
                    >
                      Recusar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Standby Applications */}
      {standbyApps.length > 0 && (
        <div>
          <h2 className="text-base font-semibold text-foreground mb-3">Processos anteriores</h2>
          <div className="space-y-3">
            {standbyApps.map((app: any) => (
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
                    </div>
                    <Badge variant="outline">Disponível para oportunidades</Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Available Opportunities */}
      <div>
        <h2 className="text-base font-semibold text-foreground mb-3 flex items-center gap-1.5">
          <Briefcase className="h-4 w-4" /> Oportunidades disponíveis
        </h2>
        {!opportunities || opportunities.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center">
              <Sparkles className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">Nenhuma vaga aberta no momento. Aguarde novos convites.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {opportunities.map((uj: any) => (
              <Card key={uj.id} className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setPreviewJob({ ...uj, _showDialog: true })}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground">{uj.jobs?.title}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <MapPin className="h-3 w-3" />
                        {uj.units?.name} — {uj.units?.city}/{uj.units?.state}
                      </p>
                      {uj.salary && (
                        <p className="text-xs text-primary font-medium mt-1">R$ {Number(uj.salary).toLocaleString("pt-BR")}</p>
                      )}
                    </div>
                    <Button size="sm" variant="outline" className="gap-1 shrink-0">
                      <Eye className="h-3.5 w-3.5" /> Ver
                    </Button>
                  </div>
                  {Array.isArray(uj.jobs?.benefits) && uj.jobs?.benefits.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {uj.jobs?.benefits.slice(0, 3).map((b: string, i: number) => (
                        <Badge key={i} variant="outline" className="text-xs">{b}</Badge>
                      ))}
                      {uj.jobs?.benefits.length > 3 && (
                        <Badge variant="secondary" className="text-xs">+{uj.jobs?.benefits.length - 3}</Badge>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* History */}
      {logs && logs.length > 0 && (
        <div>
          <h2 className="text-base font-semibold text-foreground mb-3">Histórico</h2>
          <div className="space-y-2">
            {logs.slice(0, 8).map((log: any) => {
              const eventLabels: Record<string, string> = {
                auto_enrolled: "Cadastrado no Banco de Talentos",
                opt_in: "Ativou oportunidades",
                opt_out: "Desativou oportunidades",
                invited: "Convidado para processo",
                accepted: "Aceitou convite",
                declined: "Recusou convite",
                reactivated: "Perfil reativado",
                withdrawn: "Saiu do Banco",
                status_change: "Status atualizado",
              };
              return (
                <div key={log.id} className="flex items-start gap-2 text-sm">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-foreground">{eventLabels[log.event] || log.event}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(log.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* CTA to Talent Pool */}
      <Card className="border-primary/20">
        <CardContent className="p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Gerencie seu Banco de Talentos</p>
            <p className="text-xs text-muted-foreground">Preferências, score e convites</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => navigate("/banco-talentos")}>
            Acessar
          </Button>
        </CardContent>
      </Card>

      {/* Job Preview Dialog */}
      <Dialog
        open={!!previewJob?._showDialog}
        onOpenChange={(open) => {
          if (!open) setPreviewJob(null);
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
                {previewJob.openings && <p className="text-xs">Vagas disponíveis: {previewJob.openings}</p>}
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
              <Button className="w-full" onClick={() => { setPreviewJob(null); navigate("/oportunidades"); }}>
                Ver oportunidades
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
