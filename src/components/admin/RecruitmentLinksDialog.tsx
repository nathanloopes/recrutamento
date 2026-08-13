import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Copy, Link2, Plus, Trash2, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  useRecruitmentLinks,
  useCreateRecruitmentLink,
  useDeactivateRecruitmentLink,
  buildLinkUrl,
  buildPrettyUrl,
  CHANNEL_LABELS,
  type RecruitmentLinkChannel,
} from "@/hooks/useRecruitmentLinks";
import { DoubleConfirmDialog } from "@/components/admin/DoubleConfirmDialog";

interface Props {
  jobId: string;
  unitId: string;
  unitJobId: string;
  jobTitle: string;
  unitName: string;
  triggerLabel?: string;
}

const CHANNELS: RecruitmentLinkChannel[] = [
  "whatsapp", "instagram", "facebook", "tiktok", "linkedin",
  "email", "qrcode_loja", "indicacao", "outro",
];

export function RecruitmentLinksDialog({ jobId, unitId, unitJobId, jobTitle, unitName, triggerLabel }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="text-xs">
          <Link2 className="h-3.5 w-3.5 mr-1" /> {triggerLabel ?? "Links"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Links de divulgação · {jobTitle} — {unitName}</DialogTitle>
        </DialogHeader>
        <RecruitmentLinksContent jobId={jobId} unitId={unitId} unitJobId={unitJobId} />
      </DialogContent>
    </Dialog>
  );
}

function RecruitmentLinksContent({ jobId, unitId, unitJobId }: { jobId: string; unitId: string; unitJobId: string }) {
  const { data: links, isLoading } = useRecruitmentLinks({ unitJobId });
  const create = useCreateRecruitmentLink();
  const deactivate = useDeactivateRecruitmentLink();

  const [channel, setChannel] = useState<RecruitmentLinkChannel>("whatsapp");
  const [campaign, setCampaign] = useState("");
  const [label, setLabel] = useState("");
  const [confirmDeactivate, setConfirmDeactivate] = useState<{ id: string; label: string } | null>(null);

  function copy(url: string) {
    navigator.clipboard.writeText(url);
    toast.success("Link copiado");
  }

  function handleCreate() {
    create.mutate(
      {
        jobId,
        unitId,
        unitJobId,
        channel,
        campaign: campaign.trim() || null,
        label: label.trim() || null,
      },
      {
        onSuccess: () => {
          setCampaign("");
          setLabel("");
        },
      }
    );
  }

  return (
    <div className="space-y-6 max-h-[70vh] overflow-y-auto">
      <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
        <div className="text-sm font-medium">Criar novo link</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">Canal *</Label>
            <Select value={channel} onValueChange={(v) => setChannel(v as RecruitmentLinkChannel)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CHANNELS.map((c) => (
                  <SelectItem key={c} value={c}>{CHANNEL_LABELS[c]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Campanha (opcional)</Label>
            <Input value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="ex: promo-novembro" maxLength={80} />
          </div>
          <div>
            <Label className="text-xs">Identificação interna (opcional)</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ex: post stories" maxLength={80} />
          </div>
        </div>
        <Button onClick={handleCreate} disabled={create.isPending} size="sm">
          {create.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
          Gerar link
        </Button>
      </div>

      <div>
        <div className="text-sm font-medium mb-2">Links existentes</div>
        {isLoading ? (
          <div className="text-sm text-muted-foreground py-4">Carregando...</div>
        ) : !links || links.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4 text-center border rounded-lg">
            Nenhum link criado ainda.
          </div>
        ) : (
          <div className="space-y-2">
            {links.map((l) => {
              const prettyUrl = buildPrettyUrl(l);
              const shortUrl = buildLinkUrl(l.token);
              const conv = l.clicks_count > 0
                ? Math.round((l.applications_count / l.clicks_count) * 100)
                : null;
              return (
                <div
                  key={l.id}
                  className={`rounded-lg border p-3 flex flex-col gap-2 ${l.is_active ? "" : "opacity-60 bg-muted/30"}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{CHANNEL_LABELS[l.channel]}</Badge>
                    {l.campaign && <Badge variant="outline" className="text-xs">{l.campaign}</Badge>}
                    {l.label && <span className="text-xs text-muted-foreground">{l.label}</span>}
                    {!l.is_active && <Badge variant="destructive" className="text-xs">desativado</Badge>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="text-xs bg-muted px-2 py-1 rounded flex-1 min-w-0 truncate">{prettyUrl}</code>
                    <Button size="sm" variant="outline" onClick={() => copy(prettyUrl)}>
                      <Copy className="h-3.5 w-3.5 mr-1" /> Copiar
                    </Button>
                    <Button size="sm" variant="ghost" asChild>
                      <a href={prettyUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" /></a>
                    </Button>
                    {l.is_active && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setConfirmDeactivate({ id: l.id, label: `${CHANNEL_LABELS[l.channel]}${l.campaign ? " · " + l.campaign : ""}` })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-3">
                    <span>{l.clicks_count} cliques</span>
                    <span>{l.applications_count} candidaturas</span>
                    {conv !== null && <span>{conv}% conversão</span>}
                    <span>criado em {new Date(l.created_at).toLocaleDateString("pt-BR")}</span>
                    {prettyUrl !== shortUrl && (
                      <button
                        type="button"
                        onClick={() => copy(shortUrl)}
                        className="underline-offset-2 hover:underline"
                        title={shortUrl}
                      >
                        copiar link curto
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {confirmDeactivate && (
        <DoubleConfirmDialog
          open={true}
          onOpenChange={(o) => !o && setConfirmDeactivate(null)}
          title="Desativar link"
          description={`Tem certeza que deseja desativar o link "${confirmDeactivate.label}"? Quem clicar nele será redirecionado para o portal completo. Essa ação não pode ser revertida (crie um novo link se precisar).`}
          confirmLabel="Desativar"
          skipTextConfirm
          loading={deactivate.isPending}
          onConfirm={async () => {
            await deactivate.mutateAsync({ id: confirmDeactivate.id, reason: "manual_deactivation" });
            setConfirmDeactivate(null);
          }}
        />
      )}
    </div>
  );
}
