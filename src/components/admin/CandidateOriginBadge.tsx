import { ORIGIN_CHANNEL_META, type OriginChannel } from "@/lib/originChannel";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface Props {
  channel?: OriginChannel | string | null;
  campaign?: string | null;
  className?: string;
}

export function CandidateOriginBadge({ channel, campaign, className }: Props) {
  if (!channel) return null;
  const meta = ORIGIN_CHANNEL_META[channel as OriginChannel] ?? ORIGIN_CHANNEL_META.outro;
  const Icon = meta.Icon;
  const tooltip = campaign
    ? `Veio pela campanha "${campaign}" no ${meta.label}`
    : `Veio por link de divulgação no ${meta.label}`;
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={
              "inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-[10px] text-primary max-w-full " +
              (className ?? "")
            }
          >
            <Icon className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">
              via {meta.label}
              {campaign ? ` · ${campaign}` : ""}
            </span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
