import { useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface DoubleConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmWord?: string;
  onConfirm: () => void | Promise<void>;
  /** Skip typed confirmation – just show two-step buttons */
  skipTextConfirm?: boolean;
  /** Custom label for the final confirm button */
  confirmLabel?: string;
  /** Disable confirm button (e.g. while loading) */
  loading?: boolean;
}

export function DoubleConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmWord = "CONFIRMAR",
  onConfirm,
  skipTextConfirm = false,
  confirmLabel,
  loading = false,
}: DoubleConfirmDialogProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [typed, setTyped] = useState("");

  const handleClose = (v: boolean) => {
    if (!v) {
      setStep(1);
      setTyped("");
    }
    onOpenChange(v);
  };

  const handleStep1 = () => {
    if (skipTextConfirm) {
      // No text step – go straight to confirm
      setStep(2);
    } else {
      setStep(2);
    }
  };

  const handleFinalConfirm = async () => {
    if (!skipTextConfirm && typed !== confirmWord) return;
    try {
      await onConfirm();
    } finally {
      setStep(1);
      setTyped("");
      onOpenChange(false);
    }
  };

  const finalLabel = confirmLabel || "Confirmar exclusão";

  return (
    <AlertDialog open={open} onOpenChange={handleClose}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        {step === 1 ? (
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleStep1(); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Continuar
            </AlertDialogAction>
          </AlertDialogFooter>
        ) : skipTextConfirm ? (
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleFinalConfirm(); }}
              disabled={loading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {loading ? "Excluindo..." : finalLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        ) : (
          <>
            <div className="space-y-2 py-2">
              <Label className="text-sm">
                Digite <strong>{confirmWord}</strong> para confirmar:
              </Label>
              <Input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={confirmWord}
                autoFocus
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={loading}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); handleFinalConfirm(); }}
                disabled={typed !== confirmWord || loading}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {loading ? "Excluindo..." : finalLabel}
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
