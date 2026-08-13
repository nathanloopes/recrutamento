import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Lock, Unlock, MapPin, Star, Clock, Phone, Mail } from "lucide-react";
import { useMyFirstUnit } from "@/hooks/useMyUnit";
import { useAvailableCandidates, useMyLocks, useLockCandidate, useReleaseLock } from "@/hooks/useAvailableCandidates";
import { useUnitJobs } from "@/hooks/useUnitJobs";
import { useToast } from "@/hooks/use-toast";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { DEFAULT_FRANCHISEE_RELEASE_REASON } from "@/lib/userMessages";

export default function FranchiseeCandidates() {
  const unit = useMyFirstUnit();
  const unitId = unit?.id;
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [radiusKm, setRadiusKm] = useState(20);
  const [releaseReason, setReleaseReason] = useState(DEFAULT_FRANCHISEE_RELEASE_REASON);
  const { toast } = useToast();

  const { data: unitJobs, isLoading: loadingJobs } = useUnitJobs({ unitId });
  const { data: candidates, isLoading: loadingCandidates } = useAvailableCandidates(unitId, selectedJobId || undefined, radiusKm);
  const { data: locks, isLoading: loadingLocks } = useMyLocks(unitId);
  const lockMutation = useLockCandidate();
  const releaseMutation = useReleaseLock();

  const handleLock = (candidateId: string) => {
    if (!unitId || !selectedJobId) return;
    lockMutation.mutate(
      { candidateId, unitId, jobId: selectedJobId },
      {
        onSuccess: () => toast({ title: "Candidato reservado com sucesso!" }),
        onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
      }
    );
  };

  const handleRelease = (lockId: string) => {
    releaseMutation.mutate(
      { lockId, reason: releaseReason || "Liberado pelo franqueado" },
      {
        onSuccess: () => {
          toast({ title: "Candidato liberado e devolvido ao pool." });
          setReleaseReason(DEFAULT_FRANCHISEE_RELEASE_REASON);
        },
        onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
      }
    );
  };

  if (!unitId) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        Nenhuma unidade vinculada ao seu perfil.
      </div>
    );
  }

  const jobOptions = (unitJobs || []).map((uj: any) => ({
    id: uj.job_id || uj.id,
    title: uj.jobs?.title || uj.title || "Cargo",
  }));

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold">Candidatos Disponíveis</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Veja candidatos aprovados no teste para o cargo e reserve para sua unidade.
        </p>
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-3">
        <Select value={selectedJobId} onValueChange={setSelectedJobId}>
          <SelectTrigger className="w-full sm:w-[260px]">
            <SelectValue placeholder="Selecione o cargo..." />
          </SelectTrigger>
          <SelectContent>
            {loadingJobs ? (
              <SelectItem value="_loading" disabled>Carregando...</SelectItem>
            ) : jobOptions.length === 0 ? (
              <SelectItem value="_empty" disabled>Nenhum cargo encontrado</SelectItem>
            ) : (
              jobOptions.map((j: any) => (
                <SelectItem key={j.id} value={j.id}>{j.title}</SelectItem>
              ))
            )}
          </SelectContent>
        </Select>

        <Select value={String(radiusKm)} onValueChange={(v) => setRadiusKm(Number(v))}>
          <SelectTrigger className="w-full sm:w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="10">10 km</SelectItem>
            <SelectItem value="20">20 km</SelectItem>
            <SelectItem value="50">50 km</SelectItem>
            <SelectItem value="100">100 km</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Tabs defaultValue="disponiveis" className="w-full">
        <TabsList>
          <TabsTrigger value="disponiveis">
            Disponíveis {candidates?.length ? `(${candidates.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="reservados">
            Reservados {locks?.length ? `(${locks.length})` : ""}
          </TabsTrigger>
        </TabsList>

        {/* Tab: Candidatos disponíveis */}
        <TabsContent value="disponiveis" className="space-y-3 mt-4">
          {!selectedJobId ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Selecione um cargo para ver candidatos disponíveis.
            </p>
          ) : loadingCandidates ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}><CardContent className="p-4"><Skeleton className="h-20 w-full" /></CardContent></Card>
            ))
          ) : !candidates?.length ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Nenhum candidato disponível neste raio para o cargo selecionado.
            </p>
          ) : (
            candidates.map((c) => (
              <Card key={c.candidate_id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Avatar className="h-12 w-12">
                      <AvatarImage src={c.avatar_url || undefined} />
                      <AvatarFallback>{c.full_name?.slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate name-display">{c.full_name}</p>
                      <div className="flex flex-wrap gap-2 mt-1">
                        <Badge variant="secondary" className="text-xs">
                          <Star className="h-3 w-3 mr-1" />
                          Nota: {c.test_score}%
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          <MapPin className="h-3 w-3 mr-1" />
                          {c.distance_km?.toFixed(1)} km
                        </Badge>
                        {c.city && (
                          <Badge variant="outline" className="text-xs">
                            {c.city}/{c.state}
                          </Badge>
                        )}
                      </div>
                      <div className="flex gap-3 mt-2 text-xs text-muted-foreground">
                        {c.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3" /> {c.phone}
                          </span>
                        )}
                        {c.email && (
                          <span className="flex items-center gap-1">
                            <Mail className="h-3 w-3" /> {c.email}
                          </span>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => handleLock(c.candidate_id)}
                      disabled={lockMutation.isPending}
                    >
                      <Lock className="h-4 w-4 mr-1" />
                      Reservar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* Tab: Candidatos reservados (locks ativos) */}
        <TabsContent value="reservados" className="space-y-3 mt-4">
          {loadingLocks ? (
            Array.from({ length: 2 }).map((_, i) => (
              <Card key={i}><CardContent className="p-4"><Skeleton className="h-20 w-full" /></CardContent></Card>
            ))
          ) : !locks?.length ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Nenhum candidato reservado no momento.
            </p>
          ) : (
            locks.map((lock: any) => {
              const profile = lock.profiles;
              const job = lock.jobs;
              const lockedAt = lock.locked_at ? new Date(lock.locked_at) : null;
              const expiresAt = lock.expires_at ? new Date(lock.expires_at) : null;

              return (
                <Card key={lock.id} className="border-l-4 border-l-primary">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <Avatar className="h-12 w-12">
                        <AvatarImage src={profile?.avatar_url || undefined} />
                        <AvatarFallback>{profile?.full_name?.slice(0, 2).toUpperCase() || "?"}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate name-display">{profile?.full_name || "Candidato"}</p>
                        <p className="text-xs text-muted-foreground">{job?.title || "Cargo"}</p>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {lockedAt && (
                            <Badge variant="outline" className="text-xs">
                              <Clock className="h-3 w-3 mr-1" />
                              Reservado {formatDistanceToNow(lockedAt, { addSuffix: true, locale: ptBR })}
                            </Badge>
                          )}
                          {expiresAt && (
                            <Badge variant="secondary" className="text-xs">
                              Expira {format(expiresAt, "dd/MM HH:mm")}
                            </Badge>
                          )}
                        </div>
                        <div className="flex gap-2 mt-2 text-xs text-muted-foreground">
                          {profile?.phone && (
                            <span className="flex items-center gap-1">
                              <Phone className="h-3 w-3" /> {profile.phone}
                            </span>
                          )}
                          {profile?.email && (
                            <span className="flex items-center gap-1">
                              <Mail className="h-3 w-3" /> {profile.email}
                            </span>
                          )}
                        </div>
                      </div>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" size="sm">
                            <Unlock className="h-4 w-4 mr-1" />
                            Liberar
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Liberar candidato?</AlertDialogTitle>
                            <AlertDialogDescription>
                              O candidato voltará ao pool e ficará disponível para outras unidades.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <Input
                            placeholder="Motivo da liberação (opcional)"
                            value={releaseReason}
                            onChange={(e) => setReleaseReason(e.target.value)}
                          />
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleRelease(lock.id)}
                              disabled={releaseMutation.isPending}
                            >
                              Confirmar Liberação
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
