import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Brain } from "lucide-react";
import { isNativeApp } from "@/lib/isNativeApp";
import { supabase } from "@/integrations/supabase/client";

const STORAGE_KEY = "ai_disclosure_ack_v1";

/**
 * Aviso global exibido uma vez após o login (para qualquer perfil) informando
 * que o app utiliza um serviço de IA de terceiros (OpenAI) e apontando para a
 * Política de Privacidade. Garante a divulgação exigida pelas diretrizes
 * 5.1.1(i) e 5.1.2(i) da App Store, inclusive para contas administrativas que
 * não passam pelo fluxo de triagem.
 */
export function AIDisclosureModal() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isNativeApp()) return;
    try {
      if (localStorage.getItem(STORAGE_KEY) === null) {
        setOpen(true);
      }
    } catch {
      setOpen(true);
    }
  }, []);

  const acknowledge = () => {
    if (!checked) return;
    try {
      localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    } catch {
      /* ambiente sem localStorage */
    }
    setOpen(false);
  };

  const declineAndLogout = async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      /* ignore logout errors */
    }
    setOpen(false);
    navigate("/auth", { replace: true });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={() => {
        /* não fecha por clique fora ou ESC — só ação deliberada */
      }}
      modal
    >
      <DialogContent
        className="[&>button]:hidden"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            Uso de Inteligência Artificial
          </DialogTitle>
          <DialogDescription className="pt-2 text-sm text-foreground/80 space-y-2">
            <span className="block">
              Utilizamos Inteligência Artificial (OpenAI) para transcrever e analisar respostas do processo seletivo.
            </span>
            <span className="block">
              Ao continuar, você concorda com o envio das informações necessárias (como respostas em texto e gravações de voz, quando utilizadas) exclusivamente para essa finalidade.
            </span>
            <span className="block">
              Consulte nossa{" "}
              <Link to="/politica-de-privacidade" className="underline text-primary" target="_blank" rel="noopener">
                Política de Privacidade
              </Link>{" "}
              para saber como seus dados são tratados.
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-3 py-2">
          <Checkbox
            id="ai-disclosure-checkbox"
            checked={checked}
            onCheckedChange={(v) => setChecked(v === true)}
            className="mt-0.5"
          />
          <label
            htmlFor="ai-disclosure-checkbox"
            className="text-sm text-foreground/90 leading-snug cursor-pointer"
          >
            Li e concordo com o processamento dos meus dados por IA (OpenAI).
          </label>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button onClick={acknowledge} disabled={!checked} className="w-full sm:w-auto">
            Concordo e continuar
          </Button>
          <Button
            variant="outline"
            onClick={declineAndLogout}
            className="w-full sm:w-auto"
          >
            Não concordo e sair
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
