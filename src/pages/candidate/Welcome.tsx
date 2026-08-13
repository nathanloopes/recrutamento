import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { EnableNotificationsStep } from "@/components/candidate/onboarding/EnableNotificationsStep";
import { TestNotificationStep } from "@/components/candidate/onboarding/TestNotificationStep";
import { resolvePostAuthRedirect } from "@/lib/postAuthRedirect";

export function getWelcomeSeenKey(userId?: string | null) {
  return `candidate_welcome_seen:${userId || "anon"}`;
}

export function getNotificationsSkippedKey(userId?: string | null) {
  return `candidate_notifications_skipped:${userId || "anon"}`;
}

type Step = "enable" | "test" | "welcome";

export default function Welcome() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const [step, setStep] = useState<Step>("enable");

  const firstName = (profile?.full_name || "").trim().split(/\s+/)[0] || "";

  const handleEnabled = () => setStep("test");

  const handleSkip = () => {
    try {
      if (user?.id) {
        localStorage.setItem(getNotificationsSkippedKey(user.id), "true");
      }
    } catch {
      /* ignore */
    }
    setStep("welcome");
  };

  const handleTestConfirmed = () => setStep("welcome");

  const handleStart = async () => {
    try {
      if (user?.id) {
        localStorage.setItem(getWelcomeSeenKey(user.id), "true");
      }
    } catch {
      /* ignore */
    }
    const target = resolvePostAuthRedirect();
    navigate(target ?? "/oportunidades", { replace: true });
  };

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-background app-safe-area px-4 py-8 overflow-y-auto gap-3">
      {step === "enable" && (
        <EnableNotificationsStep
          firstName={firstName}
          onEnabled={handleEnabled}
          onSkip={handleSkip}
        />
      )}

      {step === "test" && (
        <TestNotificationStep
          onConfirmed={handleTestConfirmed}
          onRetry={() => setStep("enable")}
        />
      )}

      {step !== "welcome" && (
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={handleStart}
        >
          Continuar sem configurar →
        </Button>
      )}

      {step === "welcome" && (
        <Card className="border-0 shadow-md w-full max-w-md">
          <CardContent className="p-6 sm:p-8 space-y-5 text-center">
            <p className="text-2xl font-display font-bold text-[#3D2B1F]">
              Pronto 💛
            </p>
            <p className="text-base text-foreground">
              Agora a gente consegue conversar de verdade.
            </p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Antes de te mostrar as vagas, preciso te conhecer um pouquinho
              melhor pra entender em qual tipo de oportunidade você mais se
              encaixa dentro da Recruta.
            </p>
            <p className="text-base text-foreground">
              Prometo que vai ser rapidinho.
            </p>
            <Button
              size="lg"
              className="w-full mt-2 bg-amber-500 hover:bg-amber-600 text-white"
              onClick={handleStart}
            >
              🚀 Começar
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
