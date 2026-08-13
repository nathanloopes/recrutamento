import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertTriangle } from "lucide-react";
import { RESTART_MODE_LABELS, type RestartMode } from "@/lib/applicationCycle";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidateName?: string;
  defaultMode?: RestartMode;
  /** Texto do botão de confirmação. Default: "Reativar". */
  confirmLabel?: string;
  onConfirm: (mode: RestartMode) => void | Promise<void>;
  loading?: boolean;
}

const ORDER: RestartMode[] = ["triagem", "teste", "entrevista", "documentacao", "last_valid"];

export function ReactivationModeDialog({
  open,
  onOpenChange,
  candidateName,
  defaultMode = "triagem",
  confirmLabel = "Reativar",
  onConfirm,
  loading,
}: Props) {
  const [mode, setMode] = useState<RestartMode>(defaultMode);
  const [ack, setAck] = useState(false);

  return (
    <AlertDialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setAck(false); setMode(defaultMode); } }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reativar candidatura</AlertDialogTitle>
          <AlertDialogDescription>
            {candidateName ? `Como reativar ${candidateName}?` : "Escolha onde o candidato deve recomeçar."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <RadioGroup value={mode} onValueChange={(v) => setMode(v as RestartMode)} className="space-y-2 py-2">
          {ORDER.map((m) => (
            <div key={m} className="flex items-center space-x-2">
              <RadioGroupItem value={m} id={`mode-${m}`} />
              <Label htmlFor={`mode-${m}`} className="font-normal cursor-pointer">
                {RESTART_MODE_LABELS[m]}
              </Label>
            </div>
          ))}
        </RadioGroup>

        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-amber-900 dark:text-amber-200">
            Todas as etapas futuras (testes, entrevistas e documentos) serão zeradas.
            O histórico do ciclo atual fica preservado.
          </p>
        </div>

        <div className="flex items-center space-x-2 pt-1">
          <Checkbox id="ack-restart" checked={ack} onCheckedChange={(v) => setAck(!!v)} />
          <Label htmlFor="ack-restart" className="text-sm font-normal cursor-pointer">
            Entendi e desejo iniciar um novo ciclo.
          </Label>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={!ack || loading}
            onClick={(e) => { e.preventDefault(); onConfirm(mode); }}
          >
            {loading ? "Processando..." : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
