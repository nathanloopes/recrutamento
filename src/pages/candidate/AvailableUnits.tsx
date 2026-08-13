import { useState, useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { MapPin, Building2, Gift, TrendingUp, ChevronRight, Locate, LocateOff, CheckCircle2, DollarSign, Briefcase, Store, ArrowLeft, Home, Navigation, Clock, CalendarPlus } from "lucide-react";
import { SuccessConfetti } from "@/components/candidate/SuccessConfetti";
import { ReaproveitamentoCarousel } from "@/components/candidate/ReaproveitamentoCarousel";
import { InterviewScheduler } from "@/components/candidate/InterviewScheduler";
import { parseBoolSetting } from "@/lib/schedulingSettings";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHelp } from "@/components/ui/page-help";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { useNearbyJobs } from "@/hooks/useNearbyJobs";
import { useApplyToJob, useMyApplications } from "@/hooks/useApplications";
import { useJobBenefitsBatch, resolveBenefits } from "@/hooks/useJobBenefits";
import { resolveUnitJobLists } from "@/lib/resolveUnitJobLists";
import { useJobs } from "@/hooks/useJobs";
import { useCandidateTestStatus } from "@/hooks/useCargoTest";
import { useUnitAddress, formatFullAddress } from "@/hooks/useUnitAddress";
import { useTravelTime } from "@/hooks/useTravelTime";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useGlobalSettings } from "@/hooks/useGlobalSettings";
import { toast } from "sonner";
import { safeToast } from "@/lib/safeToast";
import { ResumeOptionalDialog } from "@/components/candidate/ResumeOptionalDialog";
import { useHasResume } from "@/hooks/useHasResume";


type RadiusFilter = "none" | "all" | 20 | 50 | 100;

const RADIUS_OPTIONS: Array<{ label: string; value: Exclude<RadiusFilter, "none"> }> = [
  { label: "Todas", value: "all" },
  { label: "20 km", value: 20 },
  { label: "50 km", value: 50 },
  { label: "100 km", value: 100 },
];

function UnitCard({ uj, alreadyApplied, onApply, isPending, distanceKm, benefitsMap, isCorporate, userLat, userLng, onRequestLocation, hasUserCoords }: {
  uj: any;
  alreadyApplied: boolean;
  onApply: (unitJobId: string) => void;
  isPending: boolean;
  distanceKm?: number;
  benefitsMap?: Record<string, string[]>;
  isCorporate?: boolean;
  userLat?: number | null;
  userLng?: number | null;
  onRequestLocation?: () => void;
  hasUserCoords?: boolean;
}) {
  const { benefits: resolvedBenefits } = resolveUnitJobLists(uj);
  const benefits = resolveBenefits(uj.id, resolvedBenefits, benefitsMap);
  const unit = uj.units || {};
  const unitLat = unit.latitude;
  const unitLng = unit.longitude;

  const { data: addr } = useUnitAddress(unit.cep);
  const { data: travel } = useTravelTime(
    hasUserCoords ? { lat: userLat, lng: userLng } : null,
    unitLat != null && unitLng != null ? { lat: unitLat, lng: unitLng } : null,
  );

  const fullAddress = formatFullAddress(addr, unit.city, unit.state);

  const handleDirections = () => {
    let destination: string;
    if (unitLat != null && unitLng != null) {
      destination = `${unitLat},${unitLng}`;
    } else {
      destination = encodeURIComponent(
        [addr?.street, addr?.neighborhood, unit.city, unit.state, "Brasil"].filter(Boolean).join(", ")
      );
    }
    const url = `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <Card className={`border-0 shadow-sm ${isCorporate ? "ring-1 ring-primary/20" : ""}`}>
      <CardContent className="p-4 space-y-3">
        <div>
          <div className="flex items-center gap-2">
            {isCorporate ? (
              <Briefcase className="h-4 w-4 text-primary shrink-0" />
            ) : (
              <Building2 className="h-4 w-4 text-primary shrink-0" />
            )}
            <h3 className="font-semibold text-foreground">{unit.name}</h3>
            {isCorporate && (
              <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">Corporativa</Badge>
            )}
          </div>
          <div className="flex items-start gap-1.5 text-xs text-muted-foreground mt-1">
            <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span className="leading-snug">{fullAddress || `${unit.city || ""}, ${unit.state || ""}`}</span>
          </div>

          {/* Distância + tempo */}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {distanceKm != null && (
              <Badge variant="secondary" className="text-[10px]">
                <Navigation className="h-2.5 w-2.5 mr-1" />
                {distanceKm.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km
              </Badge>
            )}
            {travel && (
              <Badge variant="secondary" className="text-[10px]">
                <Clock className="h-2.5 w-2.5 mr-1" />
                ~{Math.max(1, Math.round(travel.minutes))} min de carro
              </Badge>
            )}
            {!hasUserCoords && onRequestLocation && (
              <button
                type="button"
                onClick={onRequestLocation}
                className="text-[11px] text-primary underline-offset-2 hover:underline"
              >
                Liberar localização para ver distância e tempo
              </button>
            )}
          </div>
        </div>

        {/* Remuneração */}
        <div className="rounded-lg border border-emerald-200/60 bg-emerald-50/50 dark:bg-emerald-950/20 dark:border-emerald-900/40 p-3 space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
            Remuneração
          </div>

          {uj.salary ? (
            <div className="flex items-baseline gap-2">
              <span className="text-xs text-muted-foreground">Salário base:</span>
              <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
                R$ {Number(uj.salary).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                {uj.salary_max ? ` – R$ ${Number(uj.salary_max).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : ""}
              </span>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">Salário a combinar</div>
          )}

          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Benefícios:</div>
            {benefits.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {benefits.map((b: string, i: number) => (
                  <Badge key={i} variant="outline" className="text-[10px] bg-background">
                    <Gift className="h-2.5 w-2.5 mr-0.5" />{b}
                  </Badge>
                ))}
              </div>
            ) : (
              <div className="text-[11px] text-muted-foreground italic">Nenhum benefício informado</div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleDirections}
            disabled={unitLat == null && !unit.city}
          >
            <Navigation className="h-3.5 w-3.5 mr-1" />
            Como chegar
          </Button>
          {alreadyApplied ? (
            <Badge variant="secondary" className="text-[10px]">
              <CheckCircle2 className="h-3 w-3 mr-1" />Interesse registrado
            </Badge>
          ) : (
            <Button size="sm" onClick={() => onApply(uj.id)} disabled={isPending}>
              Tenho Interesse
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function AvailableUnits() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const cargoId = searchParams.get("cargo");
  const [radius, setRadius] = useState<RadiusFilter>("none");
  const [selectionMode, setSelectionMode] = useState<"ask" | "nearby" | "manual">("ask");
  const [confirmApplyData, setConfirmApplyData] = useState<{ unitJobId: string; unitName: string; city: string; state: string; isCorporate: boolean; unitId?: string; jobId?: string } | null>(null);
  const [submittedInfo, setSubmittedInfo] = useState<{ unitName: string; city: string; state: string; unitJobId: string; applicationId?: string; unitId?: string; jobId?: string } | null>(null);
  const [resumeDialogOpen, setResumeDialogOpen] = useState(false);
  const { data: hasResume, refetch: refetchHasResume } = useHasResume();
  const [schedulerOpen, setSchedulerOpen] = useState(false);


  // Read geo_engine_enabled from CrossConfig
  const { data: territorySettings } = useGlobalSettings("territory");
  const geoEngineEnabled = useMemo(() => {
    const setting = territorySettings?.find((s) => s.key === "geo_engine_enabled");
    if (!setting) return true;
    return setting.value !== false && setting.value !== "false";
  }, [territorySettings]);

  const { data: testStatus, isLoading: statusLoading } = useCandidateTestStatus(cargoId || undefined);
  const { data: allJobs } = useJobs(true);
  const cargoTitle = allJobs?.find((j) => j.id === cargoId)?.title;

  // "Show all jobs" mode = no radius (none/all) OR geo engine disabled
  const isNumericRadius = radius === 20 || radius === 50 || radius === 100;
  const showAll = !geoEngineEnabled || !isNumericRadius;

  // Only call nearby RPC when a numeric radius is selected
  const { jobs: nearbyJobs, isLoading: nearbyLoading, hasCoords, geoError, geoLoading, needsProfileCep, requestGeolocation, isFallback, userLat, userLng } = useNearbyJobs(
    isNumericRadius ? (radius as number) : 0
  );

  // Direct query for corporate (franqueadora) unit_jobs for this cargo
  const corporateQuery = useQuery({
    queryKey: ["corporate_unit_jobs", cargoId],
    enabled: !!cargoId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("unit_jobs")
        .select("*, jobs!inner(id, title, benefits), units!inner(id, name, city, state, cep, latitude, longitude, is_franqueadora, is_active)")
        .eq("status", "aberta" as any)
        .eq("jobs.id", cargoId!)
        .eq("units.is_franqueadora", true)
        .eq("units.is_active", true);
      if (error) throw error;
      return (data || []).map((uj: any) => ({ ...uj, _corporate: true }));
    },
  });

  // Query ALL open unit_jobs for this cargo (no radius filter) — used in "Todas" mode
  const allJobsQuery = useQuery({
    queryKey: ["all_unit_jobs_for_cargo", cargoId],
    enabled: showAll && !!cargoId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("unit_jobs")
        .select("*, jobs!inner(id, title, benefits), units!inner(id, name, city, state, cep, latitude, longitude, is_franqueadora, is_active)")
        .eq("status", "aberta" as any)
        .eq("jobs.id", cargoId!)
        .eq("units.is_active", true);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: myApps } = useMyApplications();
  const apply = useApplyToJob();

  // Combine: nearby franchise units + corporate (sede) units
  const filteredJobs = useMemo(() => {
    const nearbyFiltered = (nearbyJobs || []).filter((uj: any) => uj.jobs?.id === cargoId);
    const corporate = corporateQuery.data || [];
    // Deduplicate by id
    const ids = new Set(nearbyFiltered.map((uj: any) => uj.id));
    const merged = [...nearbyFiltered];
    for (const uj of corporate) {
      if (!ids.has(uj.id)) merged.push(uj);
    }
    return merged;
  }, [nearbyJobs, cargoId, corporateQuery.data]);

  // Choose which list to display
  const displayJobs = showAll ? (allJobsQuery.data || []) : filteredJobs;

  // Separate corporate vs unit jobs for display
  const corporateJobs = useMemo(() => displayJobs.filter((uj: any) => uj.units?.is_franqueadora || uj._corporate), [displayJobs]);
  const unitLocalJobs = useMemo(() => displayJobs.filter((uj: any) => !uj.units?.is_franqueadora && !uj._corporate), [displayJobs]);

  const appliedJobIds = new Set(myApps?.map((a: any) => a.unit_job_id) || []);

  // Batch benefits lookup
  const unitJobIds = useMemo(() => displayJobs.map((uj: any) => uj.id), [displayJobs]);
  const { data: benefitsMap } = useJobBenefitsBatch(unitJobIds);

  const handleApplyRequest = (unitJobId: string) => {
    const uj = displayJobs.find((j: any) => j.id === unitJobId);
    setConfirmApplyData({
      unitJobId,
      unitName: uj?.units?.name || "—",
      city: uj?.units?.city || "—",
      state: uj?.units?.state || "—",
      isCorporate: !!(uj?.units?.is_franqueadora || uj?._corporate),
      unitId: uj?.units?.id || uj?.unit_id,
      jobId: uj?.jobs?.id || uj?.job_id,
    });
  };

  const performApply = async () => {
    if (!confirmApplyData) return;
    try {
      // Reaproveitamento (Item 3): quando chega via CTA "mesma vaga em outra
      // unidade" (?reuse=1), inicia direto na entrevista sem refazer a triagem.
      const reuseTriagem = searchParams.get("reuse") === "1";
      const created: any = await apply.mutateAsync({ unitJobId: confirmApplyData.unitJobId, origin: "nearby", selectionType: "post_test", reuseTriagem });

      // Sempre exibe a tela "Pronto 💛" inline (memory: confirmacao-final-candidatura).
      setSubmittedInfo({
        unitName: confirmApplyData.unitName,
        city: confirmApplyData.city,
        state: confirmApplyData.state,
        unitJobId: confirmApplyData.unitJobId,
        applicationId: created?.id,
        unitId: confirmApplyData.unitId,
        jobId: confirmApplyData.jobId,
      });
    } catch (e) {
      safeToast.error(e);
    }
    setConfirmApplyData(null);
  };

  const handleConfirmApply = async () => {
    if (!confirmApplyData) return;
    // Gate opcional de currículo: se o candidato ainda não tem, oferece anexar
    // antes de registrar o interesse. Pular = segue normalmente.
    if (hasResume === false) {
      setResumeDialogOpen(true);
      return;
    }
    await performApply();
  };

  // Self-schedule global flag (mesmo padrão de Home.tsx)
  const { data: selfScheduleSetting } = useQuery({
    queryKey: ["global_settings", "self_schedule"],
    queryFn: async () => {
      const { data } = await supabase
        .from("global_settings")
        .select("value")
        .eq("key", "allow_candidate_self_schedule")
        .maybeSingle();
      return data?.value;
    },
  });
  const canSelfSchedule = parseBoolSetting(selfScheduleSetting, true);

  // Status atual da application recém-criada — habilita o botão somente quando aprovada
  // (auto-aprovação por score quando aplicável; senão fica aguardando recrutador)
  const { data: postApplyStatus } = useQuery({
    queryKey: ["available_units_post_apply_status", submittedInfo?.applicationId],
    enabled: !!submittedInfo?.applicationId,
    refetchInterval: 4000,
    queryFn: async () => {
      const appId = submittedInfo!.applicationId!;
      const [{ data: app }, { data: ivs }] = await Promise.all([
        supabase.from("applications").select("status").eq("id", appId).maybeSingle(),
        supabase
          .from("interviews")
          .select("status")
          .eq("application_id", appId),
      ]);
      const interviews = (ivs as any[]) || [];
      const hasActive = interviews.some((i) => ["scheduled", "confirmed", "rescheduled"].includes(i.status));
      const hasTerminal = interviews.some((i) => ["completed", "no_show", "canceled"].includes(i.status));
      return { status: (app as any)?.status as string | undefined, hasActive, hasTerminal };
    },
  });
  const canShowScheduleButton =
    canSelfSchedule &&
    !!submittedInfo?.applicationId &&
    !!submittedInfo?.unitId &&
    postApplyStatus?.status === "aprovado" &&
    !postApplyStatus?.hasActive &&
    !postApplyStatus?.hasTerminal;




  // Loading
  if (statusLoading) {
    return (
      <div className="px-4 pt-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  // Não passou no teste
  if (!cargoId || !testStatus?.isApproved) {
    return (
      <div className="px-4 pt-6 space-y-6">
        <Card>
          <CardContent className="p-6 text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              Você precisa passar no teste do cargo primeiro.
            </p>
            <Button onClick={() => navigate("/oportunidades")}>
              Ir para Oportunidades
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 🎉 ETAPA FINAL — Tela de confirmação após registrar interesse
  if (submittedInfo) {
    return (
      <>
        <SuccessConfetti />
        <div className="px-4 sm:px-6 md:px-8 pt-6 pb-12 space-y-6 w-full animate-fade-in">
          <Card className="border-2 border-primary/30 shadow-lg rounded-2xl overflow-hidden bg-gradient-to-br from-amber-50/80 to-background dark:from-amber-900/20 dark:to-background animate-scale-in">
            <CardContent className="p-6 space-y-4 text-center">
              <Badge variant="secondary" className="mx-auto text-xs">
                🎉 Confirmação
              </Badge>
              <div className="space-y-2">
                <h1 className="text-2xl font-display font-bold text-foreground">
                  Pronto 💛
                </h1>
                <p className="text-sm text-foreground/90 leading-relaxed">
                  Seus dados foram enviados com sucesso.
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Agora nossa equipe vai analisar suas informações e, caso exista
                  compatibilidade com a vaga, entraremos em contato 😊
                </p>
              </div>

              <div className="rounded-xl bg-background/60 border border-border/60 p-3 text-left text-xs space-y-1">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Briefcase className="h-3.5 w-3.5" />
                  <span>{cargoTitle || "Cargo"}</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5" />
                  <span>
                    {submittedInfo.unitName} · {submittedInfo.city}/{submittedInfo.state}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-2 pt-2">
                {canShowScheduleButton && (
                  <Button
                    onClick={() => setSchedulerOpen(true)}
                    className="w-full"
                  >
                    <CalendarPlus className="h-4 w-4 mr-2" />
                    Agendar Entrevista
                  </Button>
                )}
                <Button variant="outline" onClick={() => navigate("/candidaturas")} className="w-full">
                  Acompanhar minha candidatura
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => navigate("/inicio")}
                  className="w-full"
                >
                  <Home className="h-4 w-4 mr-2" />
                  Voltar para o início
                </Button>
              </div>
            </CardContent>
          </Card>

          <ReaproveitamentoCarousel excludeUnitJobId={submittedInfo.unitJobId} />
        </div>

        {submittedInfo.applicationId && submittedInfo.unitId && (
          <InterviewScheduler
            applicationId={submittedInfo.applicationId}
            unitId={submittedInfo.unitId}
            jobTitle={cargoTitle}
            jobId={submittedInfo.jobId}
            open={schedulerOpen}
            onOpenChange={setSchedulerOpen}
            onScheduled={() => setSchedulerOpen(false)}
          />
        )}
      </>
    );
  }


  const renderJobList = (jobs: any[], isCorporateSection: boolean) => (
    <div className="space-y-3">
      {jobs.map((uj: any, idx: number) => (
        <div key={uj.id} {...(idx === 0 ? { "data-tour": "unit-card" } : {})}>
          <UnitCard
            uj={uj}
            alreadyApplied={appliedJobIds.has(uj.id)}
            onApply={handleApplyRequest}
            isPending={apply.isPending}
            distanceKm={isCorporateSection ? undefined : uj._distance_km}
            benefitsMap={benefitsMap}
            isCorporate={isCorporateSection}
            userLat={userLat}
            userLng={userLng}
            hasUserCoords={hasCoords}
            onRequestLocation={requestGeolocation}
          />
        </div>
      ))}
    </div>
  );

  // Tela de bifurcação obrigatória — escolha do modo de seleção de unidade
  if (selectionMode === "ask") {
    return (
      <div className="px-4 pt-6 space-y-6">
        <div>
          <h1 className="text-xl font-display font-bold text-foreground">
            Onde você quer trabalhar?
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {cargoTitle ? `Cargo: ${cargoTitle}` : "Escolha como prefere encontrar a unidade"}
          </p>
        </div>

        <Card className="border-2 border-primary/20">
          <CardContent className="p-6 space-y-3 text-sm text-foreground/90 leading-relaxed">
            <p>Agora quero entender onde você gostaria de trabalhar 😊</p>
            <p className="text-muted-foreground">Você prefere:</p>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-tour="unit-mode-grid">
          <button
            type="button"
            onClick={() => {
              try { localStorage.setItem("candidatura.preferenciaLocalizacao", "proximas"); } catch {}

              setSelectionMode("nearby");
              setRadius(20);
              if (!hasCoords) {
                requestGeolocation();
              }
            }}
            className="flex flex-col items-center gap-2 p-5 rounded-xl border-2 border-muted hover:border-primary/50 transition-all"
          >
            <MapPin className="h-10 w-10 text-primary" />
            <span className="text-sm font-medium text-foreground">📍 Ver unidades próximas</span>
            <span className="text-[11px] text-muted-foreground text-center">
              Usa sua localização e ordena por distância
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              try { localStorage.setItem("candidatura.preferenciaLocalizacao", "especifica"); } catch {}
              
              setSelectionMode("manual");
              setRadius("all");
            }}
            className="flex flex-col items-center gap-2 p-5 rounded-xl border-2 border-muted hover:border-primary/50 transition-all"
          >
            <Store className="h-10 w-10 text-primary" />
            <span className="text-sm font-medium text-foreground">🏪 Escolher unidade</span>
            <span className="text-[11px] text-muted-foreground text-center">
              Lista completa de unidades ativas com vagas abertas
            </span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pt-6 space-y-6">
      <Button variant="ghost" size="sm" onClick={() => setSelectionMode("ask")}>
        <ArrowLeft className="h-4 w-4 mr-1" /> Trocar modo de seleção
      </Button>
      <div className="flex items-center justify-between">

        <div>
          <h1 className="text-xl font-display font-bold text-foreground">
            {showAll ? "Todas as Vagas" : "Unidades Disponíveis"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {cargoTitle ? `Cargo: ${cargoTitle}` : "Unidades que aceitam seu cargo"}
            {showAll ? " · Todas as regiões" : isFallback ? " · Por estado" : ` · Raio de ${radius} km`}
          </p>
        </div>
        <PageHelp />
      </div>

      {/* Radius / All filter — always visible when geo engine enabled */}
      {geoEngineEnabled && (
        <div className="flex flex-wrap gap-2">
          {RADIUS_OPTIONS.map((opt) => (
            <Button
              key={opt.label}
              variant={radius === opt.value ? "default" : "outline"}
              size="sm"
              onClick={() => setRadius(opt.value)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      )}

      {/* Sem coordenadas — sempre exibir aviso quando filtro de raio está ativo e não há coords */}
      {!showAll && geoEngineEnabled && !hasCoords && !nearbyLoading && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="p-4 text-center space-y-3">
            {geoLoading ? (
              <>
                <Locate className="h-8 w-8 text-primary mx-auto animate-pulse" />
                <p className="text-sm font-medium text-foreground">Buscando sua localização…</p>
              </>
            ) : needsProfileCep ? (
              <>
                <LocateOff className="h-8 w-8 text-primary mx-auto" />
                <p className="text-sm font-medium text-foreground">Cadastre seu CEP no perfil</p>
                <p className="text-xs text-muted-foreground">Sem localização e sem CEP cadastrado, não dá pra calcular as unidades mais próximas.</p>
                <div className="flex flex-wrap gap-2 justify-center">
                  <Button variant="default" size="sm" onClick={() => navigate("/perfil")}>
                    Cadastrar CEP no perfil
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setRadius("all")}>
                    Ver todas as vagas
                  </Button>
                </div>
              </>
            ) : geoError ? (
              <>
                <LocateOff className="h-8 w-8 text-primary mx-auto" />
                <p className="text-sm font-medium text-foreground">Precisamos da sua localização para filtrar por distância</p>
                <p className="text-xs text-muted-foreground">{geoError}</p>
                <div className="flex flex-wrap gap-2 justify-center">
                  <Button variant="default" size="sm" onClick={requestGeolocation}>
                    <Locate className="h-4 w-4 mr-1" /> Tentar novamente
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setRadius("all")}>
                    Ver todas as vagas
                  </Button>
                </div>
              </>
            ) : (
              <>
                <Locate className="h-8 w-8 text-primary mx-auto" />
                <p className="text-sm font-medium text-foreground">Compartilhe sua localização para ver unidades próximas</p>
                <p className="text-xs text-muted-foreground">Vamos pedir permissão do navegador. Se você negar, usamos automaticamente o CEP cadastrado no seu perfil.</p>
                <div className="flex flex-wrap gap-2 justify-center">
                  <Button variant="default" size="sm" onClick={requestGeolocation}>
                    <Locate className="h-4 w-4 mr-1" /> Compartilhar localização
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setRadius("all")}>
                    Ver todas as vagas
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {((nearbyLoading || corporateQuery.isLoading) && !showAll && displayJobs.length === 0) && (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      )}
      {showAll && allJobsQuery.isLoading && (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      )}

      {/* Resultados — busca por raio (separated into Corporate and Unit sections) */}
      {!nearbyLoading && !showAll && geoEngineEnabled && (hasCoords || isFallback || filteredJobs.length > 0) && (
        <>
          {filteredJobs.length === 0 ? (
            <div className="text-center py-8 space-y-3">
              <MapPin className="h-10 w-10 text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground">
                {isFallback
                  ? "Nenhuma unidade encontrada para este cargo no momento."
                  : `Nenhuma unidade encontrada em um raio de ${radius} km.`}
              </p>
              {isNumericRadius && (radius as number) < 100 && !isFallback && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRadius(radius === 20 ? 50 : 100)}
                >
                  Ampliar raio
                </Button>
              )}
              {((isNumericRadius && (radius as number) >= 100) || isFallback) && (
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => setRadius("all")}
                  className="mt-2"
                >
                  <Building2 className="h-4 w-4 mr-1" />
                  Ver todas as vagas disponíveis
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              <p className="text-xs text-muted-foreground">
                {filteredJobs.length} {filteredJobs.length === 1 ? "vaga encontrada" : "vagas encontradas"}
              </p>

              {/* Corporate jobs section */}
              {corporateJobs.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Briefcase className="h-4 w-4 text-primary" />
                    <h2 className="text-sm font-semibold text-foreground">Vagas Corporativas</h2>
                    <Badge variant="secondary" className="text-[10px]">{corporateJobs.length}</Badge>
                  </div>
                  {renderJobList(corporateJobs, true)}
                </div>
              )}

              {/* Unit jobs section */}
              {unitLocalJobs.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <h2 className="text-sm font-semibold text-foreground">Vagas das Unidades</h2>
                    <Badge variant="secondary" className="text-[10px]">{unitLocalJobs.length}</Badge>
                  </div>
                  {renderJobList(unitLocalJobs, false)}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Show All results — also separated */}
      {showAll && !allJobsQuery.isLoading && (
        <>
          {displayJobs.length === 0 ? (
            <div className="text-center py-8 space-y-3">
              <MapPin className="h-10 w-10 text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground">
                Nenhuma vaga disponível para este cargo no momento.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              <p className="text-xs text-muted-foreground">
                {displayJobs.length} {displayJobs.length === 1 ? "vaga encontrada" : "vagas encontradas"} em todas as regiões
              </p>

              {/* Corporate jobs section */}
              {corporateJobs.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Briefcase className="h-4 w-4 text-primary" />
                    <h2 className="text-sm font-semibold text-foreground">Vagas Corporativas</h2>
                    <Badge variant="secondary" className="text-[10px]">{corporateJobs.length}</Badge>
                  </div>
                  {renderJobList(corporateJobs, true)}
                </div>
              )}

              {/* Unit jobs section */}
              {unitLocalJobs.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <h2 className="text-sm font-semibold text-foreground">Vagas das Unidades</h2>
                    <Badge variant="secondary" className="text-[10px]">{unitLocalJobs.length}</Badge>
                  </div>
                  {renderJobList(unitLocalJobs, false)}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Confirmation Dialog */}
      <AlertDialog open={!!confirmApplyData} onOpenChange={(open) => { if (!open) setConfirmApplyData(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary" />Confirmar Interesse
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 pt-2">
                <p className="text-sm text-muted-foreground">Revise os dados antes de confirmar:</p>
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
                  <span className="font-medium text-foreground">Cargo:</span>
                  <span>{cargoTitle || "—"}</span>
                  <span className="font-medium text-foreground">Unidade:</span>
                  <span>{confirmApplyData?.unitName}</span>
                  <span className="font-medium text-foreground">Local:</span>
                  <span>{confirmApplyData?.city}, {confirmApplyData?.state}</span>
                  <span className="font-medium text-foreground">Tipo:</span>
                  <span>{confirmApplyData?.isCorporate ? "Sede / Franqueadora" : "Unidade franqueada"}</span>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button onClick={handleConfirmApply} disabled={apply.isPending}>
              Confirmar Interesse
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Gate opcional de currículo antes de registrar interesse */}
      <ResumeOptionalDialog
        open={resumeDialogOpen}
        onOpenChange={setResumeDialogOpen}
        onContinue={async () => {
          await refetchHasResume();
          await performApply();
        }}
      />
    </div>
  );
}
