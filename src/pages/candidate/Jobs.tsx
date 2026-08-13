import { useState, useMemo, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Search, MapPin, Building2, CheckCircle, Landmark, TrendingUp, Gift, ChevronRight, Locate, LocateOff, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbSeparator, BreadcrumbPage } from "@/components/ui/breadcrumb";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { useApplyToJob, useMyApplications } from "@/hooks/useApplications";
import { useStatesWithJobCount, useCitiesWithJobCount } from "@/hooks/useUnitSearch";
import { useUnitJobs } from "@/hooks/useUnitJobs";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { safeToast } from "@/lib/safeToast";
import { JobDetailDialog } from "@/components/candidate/JobDetailDialog";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useJobBenefitsBatch, resolveBenefits } from "@/hooks/useJobBenefits";
import { PageHelp } from "@/components/ui/page-help";
import { useNearbyJobs } from "@/hooks/useNearbyJobs";
import { useInfiniteJobs } from "@/hooks/useInfiniteJobs";
import { useJobsWithTests, jobHasTest } from "@/hooks/useJobsWithTests";


function useCareerBenefitsConfig() {
  return useQuery({
    queryKey: ["career_benefits_config"],
    staleTime: 60000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("global_settings")
        .select("key, value")
        .eq("category", "career_benefits");
      if (error) throw error;
      const cfg: Record<string, any> = {};
      (data || []).forEach((s: any) => {
        const v = typeof s.value === "string" ? s.value.replace(/"/g, "") : s.value;
        cfg[s.key] = v;
      });
      return {
        requireSalaryDisplay: cfg.require_salary_display !== "false" && cfg.require_salary_display !== false,
        highlightUnitsWithCareer: cfg.highlight_units_with_career !== "false" && cfg.highlight_units_with_career !== false,
        allowBenefitsCustom: cfg.allow_benefits_custom !== "false" && cfg.allow_benefits_custom !== false,
        aiExplainCareerPlan: cfg.ai_explain_career_plan !== "false" && cfg.ai_explain_career_plan !== false,
      };
    },
  });
}

function useActiveCareerPlans() {
  return useQuery({
    queryKey: ["active_career_plans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("career_plans")
        .select("*")
        .eq("is_active", true);
      if (error) throw error;
      return data || [];
    },
  });
}

function useTerritoryConfig() {
  return useQuery({
    queryKey: ["territory_config"],
    staleTime: 60000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("global_settings")
        .select("key, value")
        .eq("category", "territory");
      if (error) throw error;
      const cfg: Record<string, any> = {};
      (data || []).forEach((s: any) => {
        const v = typeof s.value === "string" ? s.value.replace(/"/g, "") : s.value;
        cfg[s.key] = v;
      });
      return {
        showFranqueadoraJobs: cfg.show_franqueadora_jobs !== "false" && cfg.show_franqueadora_jobs !== false,
        allowManualCitySearch: cfg.allow_manual_city_search !== "false" && cfg.allow_manual_city_search !== false,
        defaultRadius: Number(cfg.default_search_radius_km) || 20,
        maxRadius: Number(cfg.max_search_radius_km) || 100,
        unitPriorityWeight: Number(cfg.unit_priority_weight) || 0,
        geoEngineEnabled: cfg.geo_engine_enabled !== "false" && cfg.geo_engine_enabled !== false,
      };
    },
  });
}

function ExpirationBadge({ closesAt }: { closesAt?: string | null }) {
  if (!closesAt) return null;
  const ymd = String(closesAt).slice(0, 10);
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const endLocal = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const daysLeft = Math.ceil((endLocal - today.getTime()) / (1000 * 60 * 60 * 24));
  if (daysLeft < 0) return null;

  const fmt = `${m[3]}/${m[2]}/${m[1]}`;

  if (daysLeft === 0) {
    return <div className="text-xs font-medium text-destructive">Inscrições encerram hoje</div>;
  }
  if (daysLeft <= 2) {
    return (
      <div className="text-xs font-medium text-destructive">
        Inscrições até: {fmt} · encerra em {daysLeft}d
      </div>
    );
  }
  if (daysLeft <= 7) {
    return (
      <div className="text-xs font-medium text-amber-700 dark:text-amber-500">
        Inscrições até: {fmt} · encerra em {daysLeft}d
      </div>
    );
  }
  return <div className="text-xs text-muted-foreground">Inscrições até: {fmt}</div>;
}

function JobCard({ uj, alreadyApplied, onApply, isPending, careerPlan, distanceKm, benefitsMap, cbConfig }: {
  uj: any;
  alreadyApplied: boolean;
  onApply: (id: string, origin: string, type: string) => void;
  isPending: boolean;
  careerPlan?: any;
  distanceKm?: number;
  benefitsMap?: Record<string, string[]>;
  cbConfig?: { requireSalaryDisplay: boolean; highlightUnitsWithCareer: boolean; allowBenefitsCustom: boolean; aiExplainCareerPlan: boolean };
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  const isFranqueadora = uj.units?.is_franqueadora;
  const benefits = resolveBenefits(uj.id, uj.jobs?.benefits, benefitsMap);
  const hasCareer = !!careerPlan;
  const showSalary = cbConfig?.requireSalaryDisplay !== false;
  const showCareerBadge = cbConfig?.highlightUnitsWithCareer !== false;
  const showBenefits = cbConfig?.allowBenefitsCustom !== false;

  return (
    <>
      <Card key={uj.id} className="border-0 shadow-sm cursor-pointer hover:shadow-md transition-shadow" onClick={() => { setDetailOpen(true); }}>
        <CardContent className="p-4 space-y-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-foreground">{uj.jobs?.title}</h3>
              {hasCareer && showCareerBadge && (
                <Badge variant="default" className="text-[10px] bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20">
                  <TrendingUp className="h-3 w-3 mr-0.5" />Plano de Carreira
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
              <Building2 className="h-3.5 w-3.5" /><span>{uj.units?.name}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
              <MapPin className="h-3.5 w-3.5" /><span>{uj.units?.city}, {uj.units?.state}</span>
              {distanceKm != null && (
                <Badge variant="secondary" className="text-[10px] ml-1">
                  {distanceKm.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km
                </Badge>
              )}
            </div>
            {uj.closes_at && (
              <div className="mt-1.5">
                <ExpirationBadge closesAt={uj.closes_at} />
              </div>
            )}
          </div>

          {showBenefits && benefits.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {benefits.slice(0, 4).map((b: string, i: number) => (
                <Badge key={i} variant="outline" className="text-[10px]">
                  <Gift className="h-2.5 w-2.5 mr-0.5" />{b}
                </Badge>
              ))}
              {benefits.length > 4 && (
                <Badge variant="outline" className="text-[10px]">+{benefits.length - 4}</Badge>
              )}
            </div>
          )}

          <div className="flex items-center justify-between">
            {showSalary && uj.salary ? (
              <p className="text-sm font-semibold text-primary">R$ {Number(uj.salary).toLocaleString("pt-BR")}</p>
            ) : <span />}
            {alreadyApplied ? (
              <Badge variant="secondary" className="text-[10px]"><CheckCircle className="h-3 w-3 mr-1" />Candidatado</Badge>
            ) : (
              <Button size="sm" onClick={(e) => { e.stopPropagation(); onApply(uj.id, isFranqueadora ? "franqueadora" : "unit", "manual"); }} disabled={isPending}>
                Candidatar-se
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
      <JobDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        uj={uj}
        careerPlan={careerPlan}
        alreadyApplied={alreadyApplied}
        onApply={() => { onApply(uj.id, isFranqueadora ? "franqueadora" : "unit", "manual"); setDetailOpen(false); }}
        isPending={isPending}
        aiExplainEnabled={cbConfig?.aiExplainCareerPlan !== false}
      />
    </>
  );
}

function LocationCard({ label, count, onClick }: { label: string; count: number; onClick: () => void }) {
  return (
    <Card className="cursor-pointer hover:shadow-md hover:border-primary/30 transition-all" onClick={onClick}>
      <CardContent className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center">
            <MapPin className="h-4 w-4 text-primary" />
          </div>
          <span className="font-medium text-foreground">{label}</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">{count} {count === 1 ? "vaga" : "vagas"}</Badge>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  );
}

function BrowseBreadcrumb({ state, city, onReset, onSelectState }: {
  state: string | null;
  city: string | null;
  onReset: () => void;
  onSelectState: () => void;
}) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          {!state ? (
            <BreadcrumbPage>Todos os estados</BreadcrumbPage>
          ) : (
            <BreadcrumbLink className="cursor-pointer" onClick={onReset}>Todos os estados</BreadcrumbLink>
          )}
        </BreadcrumbItem>
        {state && (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              {!city ? (
                <BreadcrumbPage>{state}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink className="cursor-pointer" onClick={onSelectState}>{state}</BreadcrumbLink>
              )}
            </BreadcrumbItem>
          </>
        )}
        {city && (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{city}</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

export default function Jobs() {
  const { profile, user } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");


  const [activeTab, setActiveTab] = useState("all");
  const [browseState, setBrowseState] = useState<string | null>(null);
  const [browseCity, setBrowseCity] = useState<string | null>(null);
  const { data: territoryConfig } = useTerritoryConfig();
  const { data: cbConfig } = useCareerBenefitsConfig();
  const defaultRadius = territoryConfig?.defaultRadius ?? 20;
  const maxRadius = territoryConfig?.maxRadius ?? 100;
  const showFranq = territoryConfig?.showFranqueadoraJobs ?? true;
  const showManualSearch = territoryConfig?.allowManualCitySearch ?? true;
  const geoEngineEnabled = territoryConfig?.geoEngineEnabled ?? true;
  const unitPriorityWeight = territoryConfig?.unitPriorityWeight ?? 0;

  // Adjust default tab when geo is disabled
  useEffect(() => {
    if (territoryConfig && !territoryConfig.geoEngineEnabled && activeTab === "near") {
      setActiveTab(showManualSearch ? "search" : "all");
    }
  }, [territoryConfig, activeTab, showManualSearch]);
  const RADIUS_OPTIONS = useMemo(() => {
    const opts = [defaultRadius];
    if (defaultRadius < 50 && 50 <= maxRadius) opts.push(50);
    if (maxRadius > 50) opts.push(maxRadius);
    return [...new Set(opts)].sort((a, b) => a - b);
  }, [defaultRadius, maxRadius]);
  const [nearbyRadius, setNearbyRadius] = useState(defaultRadius);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [confirmApplyData, setConfirmApplyData] = useState<{ unitJobId: string; origin: string; selectionType: string; unitName: string; city: string; state: string; jobTitle: string } | null>(null);

  const qc = useQueryClient();

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data: myApps } = useMyApplications();
  const apply = useApplyToJob();
  const { data: careerPlans } = useActiveCareerPlans();
  const { data: testsData } = useJobsWithTests();
  const { data: statesWithCount, isLoading: statesLoading } = useStatesWithJobCount();
  const { data: citiesWithCount, isLoading: citiesLoading } = useCitiesWithJobCount(browseState);

  // Nearby jobs via Haversine (disabled when geo engine is off)
  const { jobs: nearbyJobs, isLoading: nearbyLoading, hasCoords, geoError, geoLoading, needsProfileCep, requestGeolocation, locationSource } = useNearbyJobs(geoEngineEnabled ? nearbyRadius : 0);

  const { data: browseJobs, isLoading: browseJobsLoading } = useUnitJobs({
    status: "aberta",
    city: browseCity || undefined,
    state: !browseCity ? (browseState || undefined) : undefined,
    isFranqueadora: false,
  });

  const { data: franqJobs, isLoading: franqLoading } = useUnitJobs({
    status: "aberta",
    isFranqueadora: true,
  });

  const appliedJobIds = new Set(myApps?.map((a: any) => a.unit_job_id) || []);

  const getCareerPlan = (unitId: string, jobId: string) =>
    careerPlans?.find((cp: any) => cp.unit_id === unitId && cp.job_id === jobId);

  const filterBySearch = (list: any[] | undefined) =>
    list?.filter((uj: any) => {
      // Hide jobs without tests
      if (!jobHasTest(uj.jobs?.id, testsData)) return false;
      if (!search) return true;
      const words = search.trim().toLowerCase().split(/\s+/);
      const text = `${uj.jobs?.title ?? ""} ${uj.jobs?.description ?? ""} ${uj.units?.city ?? ""} ${uj.units?.state ?? ""} ${uj.units?.name ?? ""}`.toLowerCase();
      return words.every((w) => text.includes(w));
    }) || [];

  const nearFiltered = useMemo(() => {
    const filtered = filterBySearch(nearbyJobs);
    if (unitPriorityWeight > 0) {
      return [...filtered].sort((a: any, b: any) => {
        const distA = a._distance_km ?? 9999;
        const distB = b._distance_km ?? 9999;
        const prioA = a.units?.priority ?? 0;
        const prioB = b.units?.priority ?? 0;
        // Lower weighted score = better (closer + higher priority)
        const scoreA = distA - (prioA * unitPriorityWeight);
        const scoreB = distB - (prioB * unitPriorityWeight);
        return scoreA - scoreB;
      });
    }
    return filtered;
  }, [nearbyJobs, search, unitPriorityWeight]);

  // Infinite scroll for "Todas" tab
  const {
    data: infiniteData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: infiniteLoading,
  } = useInfiniteJobs(debouncedSearch);

  const allJobs = useMemo(
    () => (infiniteData?.pages.flatMap((p) => p.items) || []).filter(
      (uj: any) => jobHasTest(uj.jobs?.id, testsData)
    ),
    [infiniteData, testsData]
  );

  // Collect all unit_job IDs for batch benefits lookup
  const allUnitJobIds = useMemo(() => {
    const ids = new Set<string>();
    allJobs.forEach((uj: any) => ids.add(uj.id));
    nearbyJobs?.forEach((uj: any) => ids.add(uj.id));
    browseJobs?.forEach((uj: any) => ids.add(uj.id));
    franqJobs?.forEach((uj: any) => ids.add(uj.id));
    return Array.from(ids);
  }, [allJobs, nearbyJobs, browseJobs, franqJobs]);
  const { data: benefitsMap } = useJobBenefitsBatch(allUnitJobIds);

  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loadMoreRef.current || !hasNextPage || activeTab !== "all") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isFetchingNextPage) fetchNextPage();
      },
      { threshold: 0.1 }
    );
    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, activeTab]);

  const handleApply = (unitJobId: string, origin: string, selectionType: string) => {
    // Find the unit_job to show confirmation details
    const allLists = [...(nearbyJobs || []), ...(browseJobs || []), ...(franqJobs || []), ...allJobs];
    const uj = allLists.find((j: any) => j.id === unitJobId);
    setConfirmApplyData({
      unitJobId,
      origin,
      selectionType,
      unitName: uj?.units?.name || "—",
      city: uj?.units?.city || "—",
      state: uj?.units?.state || "—",
      jobTitle: uj?.jobs?.title || "—",
    });
  };

  const executeApply = async (unitJobId: string, origin: string, selectionType: string) => {
    try {
      await apply.mutateAsync({ unitJobId, origin, selectionType });
      toast.success("Candidatura enviada!");
    } catch (e) {
      safeToast.error(e);
    }
  };

  const handleConfirmApply = () => {
    if (!confirmApplyData) return;
    const { unitJobId, origin, selectionType } = confirmApplyData;
    setConfirmApplyData(null);
    executeApply(unitJobId, origin, selectionType);
  };

  const renderList = (jobs: any[], loading: boolean) => {
    if (loading) return <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
    if (!jobs.length) return <p className="text-center text-muted-foreground py-8">Nenhuma vaga encontrada.</p>;
    return (
      <div className="space-y-3">
        {jobs.map((uj: any) => (
          <JobCard
            key={uj.id}
            uj={uj}
            alreadyApplied={appliedJobIds.has(uj.id)}
            onApply={handleApply}
            isPending={apply.isPending}
            careerPlan={getCareerPlan(uj.unit_id, uj.job_id)}
            distanceKm={uj._distance_km}
            benefitsMap={benefitsMap}
            cbConfig={cbConfig}
          />
        ))}
      </div>
    );
  };

  const renderNearContent = () => {
    // No coords available
    if (!hasCoords && !nearbyLoading) {
      return (
        <div className="text-center py-8 space-y-3">
          {geoLoading ? (
            <>
              <Locate className="h-10 w-10 text-muted-foreground mx-auto animate-pulse" />
              <p className="text-sm text-muted-foreground">Buscando sua localização…</p>
            </>
          ) : needsProfileCep ? (
            <>
              <LocateOff className="h-10 w-10 text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground">Cadastre seu CEP no perfil para ver vagas próximas.</p>
              <Button variant="default" size="sm" onClick={() => navigate("/perfil")}>
                Cadastrar CEP no perfil
              </Button>
            </>
          ) : geoError ? (
            <>
              <LocateOff className="h-10 w-10 text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground">{geoError}</p>
              <Button variant="outline" size="sm" onClick={requestGeolocation}>
                <Locate className="h-4 w-4 mr-1" /> Tentar novamente
              </Button>
            </>
          ) : (
            <>
              <Locate className="h-10 w-10 text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground">Compartilhe sua localização para ver vagas próximas.</p>
              <p className="text-xs text-muted-foreground">Se você negar, usamos seu CEP cadastrado automaticamente.</p>
              <Button variant="default" size="sm" onClick={requestGeolocation}>
                <Locate className="h-4 w-4 mr-1" /> Compartilhar localização
              </Button>
            </>
          )}
        </div>
      );
    }

    // Has coords, show results
    if (nearFiltered.length === 0 && !nearbyLoading) {
      const currentIdx = RADIUS_OPTIONS.indexOf(nearbyRadius);
      const canExpand = currentIdx < RADIUS_OPTIONS.length - 1;

      return (
        <div className="text-center py-8 space-y-3">
          <MapPin className="h-10 w-10 text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">
            Nenhuma vaga encontrada em um raio de {nearbyRadius} km.
          </p>
          {canExpand ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setNearbyRadius(RADIUS_OPTIONS[currentIdx + 1])}
            >
              Ampliar para {RADIUS_OPTIONS[currentIdx + 1]} km
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              Tente buscar por estado na aba "Buscar".
            </p>
          )}
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {locationSource && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Locate className="h-3.5 w-3.5" />
            <span>
              {locationSource === "cep" ? "Baseado no seu CEP" : "Baseado na localização do dispositivo"}
              {" · "}Raio: {nearbyRadius} km
            </span>
            {nearbyRadius > 20 && (
              <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5" onClick={() => setNearbyRadius(20)}>
                Reduzir
              </Button>
            )}
          </div>
        )}
        {renderList(nearFiltered, nearbyLoading)}
      </div>
    );
  };

  const renderBrowseContent = () => {
    if (browseCity) return renderList(filterBySearch(browseJobs), browseJobsLoading);

    if (browseState) {
      if (citiesLoading) return <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
      if (!citiesWithCount?.length) return <p className="text-center text-muted-foreground py-8">Nenhuma cidade com vagas neste estado.</p>;
      return (
        <div className="space-y-2">
          {citiesWithCount.map((c) => (
            <LocationCard key={c.city} label={c.city} count={c.jobCount} onClick={() => setBrowseCity(c.city)} />
          ))}
        </div>
      );
    }

    if (statesLoading) return <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
    if (!statesWithCount?.length) return <p className="text-center text-muted-foreground py-8">Nenhum estado com vagas abertas no momento.</p>;
    return (
      <div className="space-y-2">
        {statesWithCount.map((s) => (
          <LocationCard key={s.state} label={s.state} count={s.jobCount} onClick={() => setBrowseState(s.state)} />
        ))}
      </div>
    );
  };

  return (
    <div className="px-4 pt-6 pb-24 space-y-4" data-tour="job-list">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-display font-bold text-foreground">Vagas</h1>
        <PageHelp />
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Buscar cargo, cidade, unidade..." className="pl-10 h-11" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); setBrowseState(null); setBrowseCity(null); }} className="w-full">
        <TabsList>
          <TabsTrigger value="all">Todas</TabsTrigger>
          {geoEngineEnabled && (
            <TabsTrigger value="near"><MapPin className="h-3.5 w-3.5 mr-1" />Perto</TabsTrigger>
          )}
          {showManualSearch && (
            <TabsTrigger value="search"><Building2 className="h-3.5 w-3.5 mr-1" />Local</TabsTrigger>
          )}
          {showFranq && (
            <TabsTrigger value="franq"><Landmark className="h-3.5 w-3.5 mr-1" />Sede</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="all" className="space-y-3">
          {infiniteLoading ? (
            <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>
          ) : !allJobs.length ? (
            <p className="text-center text-muted-foreground py-8">
              {debouncedSearch ? "Nenhuma vaga encontrada para essa busca." : "Nenhuma vaga disponível no momento."}
            </p>
          ) : (
            <div className="space-y-3">
              {allJobs.map((uj: any) => (
                <JobCard
                  key={uj.id}
                  uj={uj}
                  alreadyApplied={appliedJobIds.has(uj.id)}
                  onApply={handleApply}
                  isPending={apply.isPending}
                  careerPlan={getCareerPlan(uj.unit_id, uj.job_id)}
                  cbConfig={cbConfig}
                />
              ))}
              <div ref={loadMoreRef} className="h-4" />
              {isFetchingNextPage && (
                <div className="flex justify-center py-4"><div className="animate-spin h-6 w-6 border-4 border-primary border-t-transparent rounded-full" /></div>
              )}
              {!hasNextPage && allJobs.length > 0 && !debouncedSearch && (
                <p className="text-center text-xs text-muted-foreground py-2">Todas as vagas carregadas</p>
              )}
            </div>
          )}
        </TabsContent>

        {geoEngineEnabled && (
          <TabsContent value="near">
            {renderNearContent()}
          </TabsContent>
        )}

        {showManualSearch && (
          <TabsContent value="search" className="space-y-3">
            <BrowseBreadcrumb
              state={browseState}
              city={browseCity}
              onReset={() => { setBrowseState(null); setBrowseCity(null); }}
              onSelectState={() => setBrowseCity(null)}
            />
            {renderBrowseContent()}
          </TabsContent>
        )}

        {showFranq && (
          <TabsContent value="franq">
            <p className="text-sm text-muted-foreground mb-3">Vagas administrativas na sede da franqueadora.</p>
            {renderList(filterBySearch(franqJobs), franqLoading)}
          </TabsContent>
        )}
      </Tabs>

      {/* Confirmation Dialog */}
      <AlertDialog open={!!confirmApplyData} onOpenChange={(open) => { if (!open) setConfirmApplyData(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-primary" />Confirmar Candidatura
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 pt-2">
                <p className="text-sm text-muted-foreground">Revise os dados antes de confirmar:</p>
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
                  <span className="font-medium text-foreground">Cargo:</span>
                  <span>{confirmApplyData?.jobTitle}</span>
                  <span className="font-medium text-foreground">Unidade:</span>
                  <span>{confirmApplyData?.unitName}</span>
                  <span className="font-medium text-foreground">Local:</span>
                  <span>{confirmApplyData?.city}, {confirmApplyData?.state}</span>
                  <span className="font-medium text-foreground">Origem:</span>
                  <span>{confirmApplyData?.origin === "franqueadora" ? "Sede / Franqueadora" : "Unidade franqueada"}</span>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button onClick={handleConfirmApply} disabled={apply.isPending}>
              Confirmar Candidatura
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
