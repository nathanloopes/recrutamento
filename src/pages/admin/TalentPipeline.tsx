import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Users, UserCheck, Send, Clock, FileText, GitBranch, UserPlus, Mail, Phone, MapPin, Calendar } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getStorageClient } from "@/lib/storageDirect";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { PageHelp } from "@/components/ui/page-help";
import { formatDateBR } from "@/lib/dateUtils";

const appStatusLabels: Record<string, string> = {
  pendente: "Pendente",
  em_andamento: "Em Andamento",
  contratado: "Contratado",
  reprovado: "Lista de Oportunidade",
  desistente: "Desistente",
  standby: "Lista de Oportunidade",
  aprovado: "Aprovado",
};

const appStatusColors: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pendente: "outline",
  em_andamento: "default",
  contratado: "default",
  reprovado: "outline",
  desistente: "secondary",
  standby: "outline",
  aprovado: "default",
};

function ResumeIcon({ candidateId }: { candidateId: string }) {
  const { data: resumePath } = useQuery({
    queryKey: ["profile_resume", candidateId],
    queryFn: async () => {
      const { data: cp } = await supabase
        .from("candidate_profiles")
        .select("resume_url")
        .eq("candidate_id", candidateId)
        .maybeSingle();
      const cpResume = (cp as any)?.resume_url || null;
      if (cpResume) return cpResume as string;

      // Fallback para currículos legados versionados sem espelho no profile.
      const { data: rv } = await supabase
        .from("resume_versions")
        .select("file_url")
        .eq("candidate_id", candidateId)
        .order("uploaded_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return ((rv as any)?.file_url || null) as string | null;
    },
  });

  if (!resumePath) return <span className="text-xs text-muted-foreground">{"\u2014"}</span>;

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const storage = await getStorageClient();
    const { data } = await storage.storage
      .from("documents")
      .createSignedUrl(resumePath, 60);
    if (data?.signedUrl) {
      const w = window.open(data.signedUrl, "_blank");
      if (!w) window.location.href = data.signedUrl;
    }
  };

  return (
    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleClick} title="Ver currículo">
      <FileText className="h-3.5 w-3.5 text-primary" />
    </Button>
  );
}

export default function AdminTalentPipeline() {
  const { hasRole, unitIds: myUnitIds } = useAuth();
  // Só o admin da franqueadora vê vagas de todas as unidades. Franqueado/gestor
  // (e rh vinculado a unidades) veem apenas as vagas abertas das suas unidades.
  const scopedUnitIds = !hasRole("admin") && myUnitIds.length > 0 ? myUnitIds : undefined;
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selectedCandidate, setSelectedCandidate] = useState<any>(null);
  const [callDialog, setCallDialog] = useState<any>(null);
  const [callJobId, setCallJobId] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: applications, isLoading } = useQuery({
    queryKey: ["pipeline_candidaturas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select("id, candidate_id, status, created_at, unit_job_id, unit_jobs(id, unit_id, jobs(title), units(name, city, state)), profiles:candidate_id(full_name, email, city, state, phone, cpf, birth_date, resume_url, gender, cep, created_at, is_active), pipeline_phases(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;

      const { data: adminRoles } = await supabase
        .from("user_roles")
        .select("user_id")
        .in("role", ["admin", "rh_franqueadora", "auditor_admin", "gestor_recrutamento", "franqueado"]);
      const adminIds = new Set((adminRoles || []).map((r: any) => r.user_id));

      // Excluir admins e candidatos desativados + ordem alfabética por nome
      return (data || [])
        .filter((a: any) => !adminIds.has(a.candidate_id) && (a.profiles as any)?.is_active !== false)
        .sort((a: any, b: any) =>
          ((a.profiles as any)?.full_name || "").toLowerCase()
            .localeCompare(((b.profiles as any)?.full_name || "").toLowerCase(), "pt-BR")
        );
    },
  });

  const { data: funnelDiag } = useQuery({
    queryKey: ["pipeline_funnel_diag"],
    queryFn: async () => {
      const [pool, invites, openJobs] = await Promise.all([
        supabase.from("talent_pool_entries").select("id", { count: "exact", head: true }).eq("status", "active" as any),
        supabase.from("talent_invites").select("id", { count: "exact", head: true }).eq("status", "pending"),
        supabase.from("unit_jobs").select("id", { count: "exact", head: true }).eq("status", "aberta" as any),
      ]);
      return {
        pool: pool.count || 0,
        invites: invites.count || 0,
        openJobs: openJobs.count || 0,
      };
    },
  });

  const { data: unitJobs } = useQuery({
    queryKey: ["unit_jobs_open", scopedUnitIds],
    queryFn: async () => {
      let q = supabase
        .from("unit_jobs")
        .select("id, status, unit_id, jobs(title), units(name)")
        .eq("status", "aberta");
      if (scopedUnitIds) q = q.in("unit_id", scopedUnitIds);
      const { data } = await q;
      return data || [];
    },
  });

  // O escopo do pipeline por unidade é garantido pela RLS de `applications`
  // (franqueado/gestor só leem candidaturas das suas unidades). O recrutamento
  // cross-unit acontece pelo Banco de Talentos, não aqui.

  const callMutation = useMutation({
    mutationFn: async ({ candidateId, unitJobId }: { candidateId: string; unitJobId: string }) => {
      // Block if candidate is already hired
      const { count: hiredCount } = await supabase
        .from("applications")
        .select("id", { count: "exact", head: true })
        .eq("candidate_id", candidateId)
        .eq("status", "contratado");
      if ((hiredCount || 0) > 0) {
        throw new Error("Este candidato já está contratado. Não é possível enviar um convite.");
      }

      // Check if candidate already has an active process
      const { count } = await supabase
        .from("applications")
        .select("id", { count: "exact", head: true })
        .eq("candidate_id", candidateId)
        .eq("status", "em_andamento");

      const { data: maxSetting } = await supabase
        .from("global_settings")
        .select("value")
        .eq("category", "talent_pool")
        .eq("key", "max_active_processes")
        .single();

      const maxProcesses = maxSetting ? Number(maxSetting.value) : 1;
      if ((count || 0) >= maxProcesses) {
        throw new Error(`Candidato já possui ${count} processo(s) ativo(s). Limite: ${maxProcesses}.`);
      }

      // Check for existing pending invite
      const { count: existingInvite } = await supabase
        .from("talent_invites")
        .select("id", { count: "exact", head: true })
        .eq("candidate_id", candidateId)
        .eq("unit_job_id", unitJobId)
        .eq("status", "pending");
      if ((existingInvite || 0) > 0) {
        throw new Error("Já existe um convite pendente para este candidato nesta vaga.");
      }

      // Create talent invite (candidate will accept/decline)
      const { error } = await supabase.from("talent_invites").insert({
        candidate_id: candidateId,
        unit_job_id: unitJobId,
        channel: "sistema",
        status: "pending",
      });
      if (error) throw error;

      // Notify the candidate with dedup_key
      const { data: ujData } = await supabase
        .from("unit_jobs")
        .select("jobs:job_id(title), units:unit_id(name)")
        .eq("id", unitJobId)
        .single();
      const jobTitle = (ujData as any)?.jobs?.title || "vaga";
      const unitName = (ujData as any)?.units?.name || "unidade";

      const dedupKey = `talent_invite_sent:${candidateId}:${unitJobId}`;
      await supabase.from("notifications" as any).insert({
        event_type: "talent_invite_sent",
        recipient_id: candidateId,
        channel: "push",
        title: "Convite para Processo Seletivo",
        body: `Você foi convidado(a) para o processo seletivo de ${jobTitle} na ${unitName}. Acesse o Banco de Talentos para responder.`,
        status: "pending",
        action_url: "/banco-de-talentos",
        action_type: "action_required",
        payload: { unit_job_id: unitJobId, job_title: jobTitle, unit_name: unitName },
        dedup_key: dedupKey,
      } as any);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipeline_candidaturas"] });
      toast({ title: "Convite enviado ao candidato!", description: "O candidato receberá uma notificação para aceitar ou recusar." });
      setCallDialog(null);
      setCallJobId("");
    },
    onError: (e: any) => {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    },
  });

  const filtered = (applications || []).filter((a: any) => {
    if (statusFilter !== "all" && a.status !== statusFilter) return false;
    if (search) {
      const name = ((a.profiles as any)?.full_name || "").toLowerCase();
      const city = ((a.profiles as any)?.city || "").toLowerCase();
      if (!name.includes(search.toLowerCase()) && !city.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  const metrics = {
    total: applications?.length || 0,
    pendentes: applications?.filter((a: any) => a.status === "pendente").length || 0,
    emAndamento: applications?.filter((a: any) => a.status === "em_andamento").length || 0,
    standby: applications?.filter((a: any) => a.status === "standby").length || 0,
    contratados: applications?.filter((a: any) => a.status === "contratado").length || 0,
  };

  const hasActiveProcess = (candidateId: string) =>
    (applications || []).some((a: any) => a.candidate_id === candidateId && a.status === "em_andamento");

  return (
    <div className="space-y-6 pb-24">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <GitBranch className="h-6 w-6 text-primary" /> Pipeline de Candidaturas
          </h1>
          <p className="text-muted-foreground">
            Todas as candidaturas realizadas pelos candidatos
          </p>
        </div>
        <PageHelp />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        <Card><CardContent className="p-4 text-center"><Users className="h-5 w-5 mx-auto text-primary mb-1" /><p className="text-2xl font-bold">{metrics.total}</p><p className="text-xs text-muted-foreground">Total</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><Clock className="h-5 w-5 mx-auto text-yellow-500 mb-1" /><p className="text-2xl font-bold">{metrics.pendentes}</p><p className="text-xs text-muted-foreground">Pendentes</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><UserCheck className="h-5 w-5 mx-auto text-primary mb-1" /><p className="text-2xl font-bold">{metrics.emAndamento}</p><p className="text-xs text-muted-foreground">Em Andamento</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><Clock className="h-5 w-5 mx-auto text-warning mb-1" /><p className="text-2xl font-bold">{metrics.standby}</p><p className="text-xs text-muted-foreground">Standby</p></CardContent></Card>
        <Card><CardContent className="p-4 text-center"><Send className="h-5 w-5 mx-auto text-primary mb-1" /><p className="text-2xl font-bold">{metrics.contratados}</p><p className="text-xs text-muted-foreground">Contratados</p></CardContent></Card>
      </div>

      {!isLoading && (applications?.length || 0) === 0 && funnelDiag && (
        <Card className="border-dashed border-warning/40 bg-warning/5">
          <CardContent className="p-4 text-sm space-y-2">
            <p className="font-medium text-foreground">
              Nenhuma candidatura formal no momento.
            </p>
            <p className="text-muted-foreground">
              Estado atual do funil: <strong>{funnelDiag.pool}</strong> candidato(s) no Banco de
              Talentos, <strong>{funnelDiag.invites}</strong> convite(s) pendente(s),{" "}
              <strong>{funnelDiag.openJobs}</strong> vaga(s) aberta(s). Uma candidatura aparece
              aqui apenas quando o candidato confirma o interesse em uma unidade.
            </p>
            {funnelDiag.openJobs === 0 && (
              <p className="text-warning">
                Atenção: não há vagas abertas — sem vaga aberta, ninguém consegue se candidatar.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex gap-3 flex-wrap">
        <Input
          placeholder="Buscar por nome ou cidade..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent disableSearch>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="pendente">Pendentes</SelectItem>
            <SelectItem value="em_andamento">Em Andamento</SelectItem>
            <SelectItem value="contratado">Contratados</SelectItem>
            <SelectItem value="reprovado">Lista de Oportunidade</SelectItem>
            <SelectItem value="desistente">Desistentes</SelectItem>
            <SelectItem value="standby">Lista de Oportunidade (Standby)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Candidato</TableHead>
                <TableHead>Cidade/Estado</TableHead>
                <TableHead>Vaga</TableHead>
                <TableHead>Unidade</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>CV</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    Nenhuma candidatura encontrada
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((a: any) => (
                  <TableRow
                    key={a.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setSelectedCandidate(a)}
                  >
                    <TableCell className="font-medium">{(a.profiles as any)?.full_name || "\u2014"}</TableCell>
                    <TableCell className="text-xs">{(a.profiles as any)?.city || "\u2014"}/{(a.profiles as any)?.state || "\u2014"}</TableCell>
                    <TableCell className="text-xs">{a.unit_jobs?.jobs?.title || "\u2014"}</TableCell>
                    <TableCell className="text-xs">{a.unit_jobs?.units?.name || "\u2014"} ({a.unit_jobs?.units?.city}/{a.unit_jobs?.units?.state})</TableCell>
                    <TableCell>
                      <Badge variant={appStatusColors[a.status] || "secondary"}>
                        {appStatusLabels[a.status] || a.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <ResumeIcon candidateId={a.candidate_id} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(a.created_at).toLocaleDateString("pt-BR")}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={hasActiveProcess(a.candidate_id)}
                        title={hasActiveProcess(a.candidate_id) ? "Candidato já está em um processo seletivo" : "Chamar para processo seletivo"}
                        onClick={(e) => { e.stopPropagation(); setCallJobId(a.unit_job_id || ""); setCallDialog(a); }}
                      >
                        <UserPlus className="h-3 w-3 mr-1" /> Chamar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Candidate Detail Dialog */}
      <Dialog open={!!selectedCandidate} onOpenChange={(o) => !o && setSelectedCandidate(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Informações do Candidato</DialogTitle>
          </DialogHeader>
          {selectedCandidate && (() => {
            const p = selectedCandidate.profiles as any;
            return (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <Users className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">{p?.full_name || "\u2014"}</h3>
                    <p className="text-sm text-muted-foreground">{p?.cpf || "CPF não informado"}</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <span>{p?.email || "\u2014"}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    <span>{p?.phone || "\u2014"}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    <span>{p?.city || "\u2014"}/{p?.state || "\u2014"} {p?.cep ? `(${p.cep})` : ""}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span>{p?.birth_date ? formatDateBR(p.birth_date) : "\u2014"}</span>
                  </div>
                </div>
                {p?.gender && (
                  <div className="flex gap-2 flex-wrap">
                    <Badge variant="outline">{p.gender}</Badge>
                  </div>
                )}
                <div className="border-t pt-3 space-y-2">
                  <h4 className="text-sm font-medium">Candidatura</h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div><span className="text-muted-foreground">Vaga:</span> {selectedCandidate.unit_jobs?.jobs?.title || "\u2014"}</div>
                    <div><span className="text-muted-foreground">Unidade:</span> {selectedCandidate.unit_jobs?.units?.name || "\u2014"}</div>
                    <div><span className="text-muted-foreground">Status:</span>{" "}
                      <Badge variant={appStatusColors[selectedCandidate.status] || "secondary"} className="text-xs">
                        {appStatusLabels[selectedCandidate.status] || selectedCandidate.status}
                      </Badge>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 pt-2">
                  <Button
                    className="flex-1"
                    disabled={hasActiveProcess(selectedCandidate.candidate_id)}
                    onClick={() => { setSelectedCandidate(null); setCallJobId(selectedCandidate.unit_job_id || ""); setCallDialog(selectedCandidate); }}
                  >
                    <UserPlus className="h-4 w-4 mr-2" />
                    {hasActiveProcess(selectedCandidate.candidate_id) ? "Já em processo seletivo" : "Chamar para Processo Seletivo"}
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Call to Selection Process Dialog */}
      <Dialog open={!!callDialog} onOpenChange={(o) => !o && setCallDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Chamar para Processo Seletivo</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Candidato: <span className="font-medium text-foreground">{(callDialog?.profiles as any)?.full_name}</span>
            </p>
            <Select value={callJobId} onValueChange={setCallJobId}>
              <SelectTrigger><SelectValue placeholder="Selecione uma vaga aberta" /></SelectTrigger>
              <SelectContent>
                {(unitJobs || []).map((uj: any) => (
                  <SelectItem key={uj.id} value={uj.id}>
                    {uj.jobs?.title} — {uj.units?.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              className="w-full"
              disabled={!callJobId || callMutation.isPending}
              onClick={() => callDialog && callMutation.mutate({
                candidateId: callDialog.candidate_id,
                unitJobId: callJobId,
              })}
            >
              {callMutation.isPending ? "Processando..." : "Chamar para Processo Seletivo"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
