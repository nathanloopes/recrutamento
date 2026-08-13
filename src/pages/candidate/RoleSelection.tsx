import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useAvailableRoles, useOpenAreasFromJobs, classifyJobToArea, type OpenArea } from "@/hooks/useCargoTest";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DiscoveryChat } from "@/components/candidate/discovery/DiscoveryChat";


function useMyTestResults() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my_test_results", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("talent_pool_entries")
        .select("*")
        .eq("candidate_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const d = data as any;
      return {
        approved_job_id: d.approved_job_id as string | null,
        test_score: d.test_score as number | null,
        test_completed_at: d.test_completed_at as string | null,
        status: d.status as string,
      };
    },
  });
}

function useMyFirstName() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my_first_name", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("candidate_profiles")
        .select("full_name")
        .eq("candidate_id", user!.id)
        .maybeSingle();
      const fullName = (data as any)?.full_name as string | undefined;
      if (!fullName) return null;
      return fullName.trim().split(/\s+/)[0] || null;
    },
  });
}

type Step = "choose" | "list";

function getStorageKey(userId?: string) {
  return `onboarding_oportunidades_step:${userId || "anon"}`;
}

function getAreaStorageKey(userId?: string) {
  return `onboarding_oportunidades_area:${userId || "anon"}`;
}

export default function RoleSelection() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: roles, isLoading } = useAvailableRoles();
  const { data: testResult } = useMyTestResults();
  const { data: firstName } = useMyFirstName();
  const { data: openAreasData, isLoading: isLoadingAreas } = useOpenAreasFromJobs();
  const openAreas: OpenArea[] = openAreasData?.areas || [];

  const [step, setStep] = useState<Step>("choose");
  const [selectedAreaKey, setSelectedAreaKey] = useState<string | null>(null);

  // Hydrate from localStorage once user is known
  useEffect(() => {
    if (!user?.id) return;
    try {
      const saved = localStorage.getItem(getStorageKey(user.id)) as Step | null;
      if (saved === "choose" || saved === "list") {
        setStep(saved);
      }
      const savedAreaKey = localStorage.getItem(getAreaStorageKey(user.id));
      if (savedAreaKey) setSelectedAreaKey(savedAreaKey);
    } catch {
      // ignore storage errors
    }
  }, [user?.id]);

  // Persist step
  useEffect(() => {
    if (!user?.id) return;
    try {
      localStorage.setItem(getStorageKey(user.id), step);
    } catch {
      // ignore
    }
  }, [step, user?.id]);

  const handleSelect = (jobId: string) => {
    const isApproved = testResult?.approved_job_id === jobId && testResult?.test_score != null;
    if (isApproved) {
      navigate(`/unidades-disponiveis?cargo=${jobId}`);
    } else {
      navigate(`/teste-cargo/${jobId}`);
    }
  };

  const handleViewJobs = (jobId: string) => {
    navigate(`/unidades-disponiveis?cargo=${jobId}`);
  };

  const handleSelectArea = (areaKey: string) => {
    setSelectedAreaKey(areaKey);
    if (user?.id) {
      try {
        localStorage.setItem(getAreaStorageKey(user.id), areaKey);
      } catch {
        // ignore
      }
    }
    setStep("list");
  };

  // Etapa 3: filtra cargos da área selecionada usando o MESMO classificador
  // que monta as áreas em useOpenAreasFromJobs (fonte única da verdade).
  const sortedRoles = useMemo(() => {
    if (!roles) return [];
    if (!selectedAreaKey) return roles;
    return roles.filter((job: any) => {
      const matched = classifyJobToArea(job.title, job.description, job.departments?.name);
      if (matched) return matched.key === selectedAreaKey;
      const fallbackLabel = (job.departments?.name || "Outras áreas").trim();
      const fallbackKey = `dyn:${fallbackLabel.toLowerCase()}`;
      return fallbackKey === selectedAreaKey;
    });
  }, [roles, selectedAreaKey]);

  // Se a área salva não existe mais nas vagas atuais, limpar
  useEffect(() => {
    if (!selectedAreaKey || isLoadingAreas) return;
    if (openAreas.length === 0) return;
    const stillExists = openAreas.some((a) => a.key === selectedAreaKey);
    if (!stillExists) {
      setSelectedAreaKey(null);
      if (step === "list") setStep("choose");
    }
  }, [selectedAreaKey, openAreas, isLoadingAreas, step]);

  // ---------- Etapa 2: Escolha inicial da área (DINÂMICA, baseada nas vagas reais) ----------
  if (step === "choose") {
    const isEmpty = !isLoadingAreas && openAreas.length === 0;

    return (
      <div className="px-4 pt-6 pb-8 space-y-6">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {firstName ? `Oi, ${firstName}!` : "Oi!"}
          </p>
          <h1 className="text-2xl font-display font-bold text-foreground leading-snug">
            Para eu te indicar a vaga certa, me conta: com o que você mais se identifica no dia a dia?
          </h1>
          {!isEmpty && (
            <p className="text-sm text-muted-foreground leading-relaxed">
              Escolha a frase que mais combina com você — depois a gente continua a conversa. 💛
            </p>
          )}
        </div>

        {isLoadingAreas ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : isEmpty ? (
          <Card className="border-0 shadow-sm">
            <CardContent className="p-6 space-y-4 text-center">
              <div className="text-4xl">💛</div>
              <p className="text-base font-medium text-foreground">
                Por enquanto não tenho vagas abertas pra te mostrar.
              </p>
              <p className="text-sm text-muted-foreground">
                Assim que abrir algo novo, te aviso por aqui.
              </p>
              <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-center pt-2">
                <Button onClick={() => setStep("list")}>
                  Ver oportunidades mesmo assim
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="space-y-3">
              {openAreas.map((opt) => {
                const selected = selectedAreaKey === opt.key;
                return (
                  <Card
                    key={opt.key}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSelectArea(opt.key)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleSelectArea(opt.key);
                      }
                    }}
                    className={cn(
                      "border-2 shadow-sm cursor-pointer transition-all active:scale-[0.98]",
                      selected
                        ? "border-primary bg-primary/5 shadow-md"
                        : "border-transparent hover:border-primary/30"
                    )}
                  >
                    <CardContent className="p-5 flex items-center gap-4">
                      <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 text-2xl">
                        {opt.emoji}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-base font-medium text-foreground leading-snug">
                          {opt.activityLabel || opt.label}
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <div className="rounded-xl bg-muted/40 px-4 py-3 flex items-start gap-3">
              <span className="text-lg leading-none mt-0.5">💬</span>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Não achou exatamente a sua área? Tudo bem — escolha a mais próxima e a gente segue conversando.
              </p>
            </div>
          </>
        )}
      </div>
    );
  }

  // ---------- Etapa 3: Conversa de descoberta ----------
  if (isLoading) {
    return (
      <div className="px-4 pt-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  const areaInfo = selectedAreaKey ? openAreas.find((o) => o.key === selectedAreaKey) : null;
  const areaActivityLabel = areaInfo?.activityLabel || areaInfo?.label || undefined;

  return (
    <DiscoveryChat
      jobs={(sortedRoles as any[]) || []}
      areaActivityLabel={areaActivityLabel}
      candidateFirstName={firstName || undefined}
      onAcceptJob={(jobId) => handleSelect(jobId)}
      onChangeArea={() => setStep("choose")}
    />
  );
}
