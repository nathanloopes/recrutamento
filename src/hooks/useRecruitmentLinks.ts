import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type RecruitmentLinkChannel =
  | "whatsapp" | "instagram" | "facebook" | "tiktok" | "linkedin"
  | "email" | "qrcode_loja" | "indicacao" | "outro";

export const CHANNEL_LABELS: Record<RecruitmentLinkChannel, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  email: "E-mail",
  qrcode_loja: "QR Code (loja)",
  indicacao: "Indicação",
  outro: "Outro",
};

export interface RecruitmentLink {
  id: string;
  token: string;
  job_id: string;
  unit_id: string;
  unit_job_id: string | null;
  unit_slug: string | null;
  job_slug: string | null;
  short_code: string | null;
  channel: RecruitmentLinkChannel;
  campaign: string | null;
  label: string | null;
  created_by: string;
  is_active: boolean;
  expires_at: string | null;
  clicks_count: number;
  applications_count: number;
  deactivated_at: string | null;
  deactivation_reason: string | null;
  created_at: string;
  updated_at: string;
}

export function buildLinkUrl(token: string): string {
  if (typeof window === "undefined") return `/v/${token}`;
  return `${window.location.origin}/v/${token}`;
}

export function buildPrettyUrl(link: Pick<RecruitmentLink, "unit_slug" | "job_slug" | "short_code" | "token">): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  if (link.unit_slug && link.job_slug && link.short_code) {
    return `${origin}/u/${link.unit_slug}/${link.job_slug}/${link.short_code}`;
  }
  return `${origin}/v/${link.token}`;
}

export function useRecruitmentLinks(filters: { jobId?: string; unitId?: string; unitJobId?: string } = {}) {
  return useQuery({
    queryKey: ["recruitment_links", filters],
    queryFn: async (): Promise<RecruitmentLink[]> => {
      let q = (supabase.from("recruitment_links" as any) as any).select("*").order("created_at", { ascending: false });
      if (filters.jobId) q = q.eq("job_id", filters.jobId);
      if (filters.unitId) q = q.eq("unit_id", filters.unitId);
      if (filters.unitJobId) q = q.eq("unit_job_id", filters.unitJobId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as RecruitmentLink[];
    },
  });
}

export function useCreateRecruitmentLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      jobId: string;
      unitId: string;
      unitJobId: string;
      channel: RecruitmentLinkChannel;
      campaign?: string | null;
      label?: string | null;
      expiresAt?: string | null;
    }) => {
      const { data, error } = await (supabase.rpc as any)("create_recruitment_link", {
        _job_id: params.jobId,
        _unit_id: params.unitId,
        _unit_job_id: params.unitJobId,
        _channel: params.channel,
        _campaign: params.campaign ?? null,
        _label: params.label ?? null,
        _expires_at: params.expiresAt ?? null,
      });
      if (error) throw error;
      return data as RecruitmentLink;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recruitment_links"] });
      toast.success("Link criado");
    },
    onError: (e: any) => toast.error("Erro ao criar link: " + (e.message ?? "desconhecido")),
  });
}

export function useDeactivateRecruitmentLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await (supabase.from("recruitment_links" as any) as any)
        .update({ is_active: false, deactivated_at: new Date().toISOString(), deactivation_reason: reason })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recruitment_links"] });
      toast.success("Link desativado");
    },
    onError: (e: any) => toast.error("Erro: " + (e.message ?? "desconhecido")),
  });
}

export interface ResolveLinkIntent {
  verdict: "apply" | "blocked_active" | "redirect_discovery" | "login_required" | "applied";
  reason?: string;
  job_id?: string;
  unit_id?: string;
  unit_job_id?: string;
  active_application_id?: string;
  application_id?: string;
  origin_link_id?: string;
  origin_channel?: RecruitmentLinkChannel;
  origin_campaign?: string | null;
}

export async function resolveLinkIntent(token: string): Promise<ResolveLinkIntent> {
  const { data, error } = await (supabase.rpc as any)("resolve_link_intent", { _token: token });
  if (error) throw error;
  return data as ResolveLinkIntent;
}

export async function applyViaLink(token: string): Promise<ResolveLinkIntent> {
  const { data, error } = await (supabase.rpc as any)("apply_via_link", { _token: token });
  if (error) throw error;
  return data as ResolveLinkIntent;
}

export async function incrementLinkClick(token: string): Promise<void> {
  await (supabase.rpc as any)("increment_link_click", { _token: token });
}
