import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MaskedDateInput } from "@/components/ui/masked-date-input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTestTemplates, useCreateTestAssignment } from "@/hooks/useTests";
import { useSendNotification } from "@/hooks/useNotifications";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { formatDateBR } from "@/lib/dateUtils";

interface TestAssignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  applicationId: string;
  candidateId: string;
}

export function TestAssignDialog({ open, onOpenChange, applicationId, candidateId }: TestAssignDialogProps) {
  const { data: templates } = useTestTemplates();
  const createMutation = useCreateTestAssignment();
  const sendNotification = useSendNotification();
  const { user } = useAuth();
  const [templateId, setTemplateId] = useState("");
  const [deadline, setDeadline] = useState("");
  const [isMandatory, setIsMandatory] = useState(false);

  const activeTemplates = templates || [];

  const handleAssign = async () => {
    if (!templateId || !user) return;
    try {
      await createMutation.mutateAsync({
        test_template_id: templateId,
        application_id: applicationId,
        candidate_id: candidateId,
        assigned_by: user.id,
        deadline: deadline ? new Date(deadline).toISOString() : null,
        is_mandatory: isMandatory,
      });
      // Send notification to candidate
      const selectedTemplate = activeTemplates.find(t => t.id === templateId);
      sendNotification.mutate({
        eventType: "test_assigned",
        recipientId: candidateId,
        payload: {
          application_id: applicationId,
          _title: "Novo teste atribuído",
          _body: `Você recebeu o teste "${selectedTemplate?.title || "Avaliação"}"${deadline ? `. Prazo: ${formatDateBR(deadline)}` : ""}`,
        },
        channel: "push",
      });
      toast({ title: "Teste atribuído com sucesso" });
      onOpenChange(false);
      setTemplateId("");
      setDeadline("");
      setIsMandatory(false);
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Atribuir Teste</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Template de teste</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger><SelectValue placeholder="Selecione um teste..." /></SelectTrigger>
              <SelectContent>
                {activeTemplates.length === 0 && (
                  <div className="px-2 py-3 text-xs text-muted-foreground">Nenhum teste cadastrado.</div>
                )}
                {activeTemplates.map(t => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.title} ({t.category}){!t.is_active ? " · inativo" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Prazo</Label>
            <MaskedDateInput value={deadline ? new Date(deadline) : null} onChange={d => setDeadline(d ? d.toISOString().slice(0, 16) : "")} format="dd/MM/yyyy HH:mm" placeholder="Selecione data e hora" />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={isMandatory} onCheckedChange={setIsMandatory} />
            <Label>Obrigatório para avançar no funil</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleAssign} disabled={!templateId}>Atribuir</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
