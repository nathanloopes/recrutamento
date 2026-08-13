import { Mail, Phone, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface CollaboratorInfoCardProps {
  name: string;
  role: string;
  isActive: boolean;
  avatarUrl: string | null;
  tags: string[];
  hiredAt: string;
  email?: string;
  phone?: string | null;
}

export function CollaboratorInfoCard({
  name,
  role,
  isActive,
  avatarUrl,
  tags,
  hiredAt,
  email,
  phone,
}: CollaboratorInfoCardProps) {
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();

  return (
    <div className="group relative rounded-2xl bg-card border border-border/50 p-6 transition-all duration-500 hover:shadow-xl hover:shadow-primary/5 hover:-translate-y-1 overflow-hidden">
      {/* Animated Grid Background */}
      <div className="absolute inset-0 overflow-hidden opacity-0 group-hover:opacity-100 transition-opacity duration-700">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(hsl(var(--muted-foreground) / 0.06) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--muted-foreground) / 0.06) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
            animation: "gridMove 4s linear infinite",
          }}
        />
      </div>

      <style>{`
        @keyframes gridMove {
          0% { transform: translate(0, 0); }
          100% { transform: translate(40px, 40px); }
        }
      `}</style>

      <div className="relative z-10 flex flex-col items-center text-center">
        {/* Status indicator */}
        <div className="absolute top-0 right-0">
          <div className="relative flex items-center gap-1.5">
            <div
              className={cn(
                "h-2.5 w-2.5 rounded-full",
                isActive ? "bg-emerald-500" : "bg-destructive"
              )}
            />
            {isActive && (
              <div className="absolute inset-0 h-2.5 w-2.5 rounded-full bg-emerald-500 animate-ping opacity-75" />
            )}
          </div>
        </div>

        {/* Avatar with glow ring */}
        <div className="relative mb-4">
          <div className="relative transition-transform duration-500 group-hover:scale-105">
            <Avatar className="h-20 w-20 border-2 border-border shadow-lg">
              <AvatarImage src={avatarUrl || undefined} alt={name} />
              <AvatarFallback className="text-lg font-bold bg-muted text-muted-foreground">
                {initials}
              </AvatarFallback>
            </Avatar>
            {/* Glow ring on hover */}
            <div className="absolute -inset-1 rounded-full bg-gradient-to-r from-primary/40 to-primary/20 opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-sm -z-10" />
          </div>
        </div>

        {/* Name & Role */}
        <div className="mb-3 transition-all duration-300 group-hover:translate-y-[-2px]">
          <h3 className="font-semibold text-sm text-foreground truncate max-w-[200px]">
            {name}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">{role}</p>
        </div>

        {/* Hired date */}
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-3">
          <CalendarDays className="h-3 w-3" />
          <span>{hiredAt}</span>
        </div>

        {/* Tags */}
        {tags.length > 0 && (
          <div className="flex flex-wrap justify-center gap-1.5 mb-4">
            {tags.map((tag, i) => (
              <span
                key={i}
                className={cn(
                  "px-2 py-0.5 rounded-full text-[10px] font-medium border transition-all duration-300",
                  i === 0
                    ? "bg-primary/10 text-primary border-primary/20 group-hover:bg-primary/20"
                    : "bg-muted text-muted-foreground border-border group-hover:bg-accent"
                )}
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2 w-full">
          {email && (
            <a
              href={`mailto:${email}`}
              className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-lg bg-muted/50 border border-border text-muted-foreground text-xs font-medium transition-all duration-300 hover:bg-primary hover:text-primary-foreground hover:border-primary hover:shadow-md"
            >
              <Mail className="h-3.5 w-3.5" />
            </a>
          )}
          {phone && (
            <a
              href={`tel:${phone}`}
              className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-lg bg-muted/50 border border-border text-muted-foreground text-xs font-medium transition-all duration-300 hover:bg-primary hover:text-primary-foreground hover:border-primary hover:shadow-md"
            >
              <Phone className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </div>

      {/* Animated border on hover */}
      <div className="absolute inset-0 rounded-2xl border-2 border-transparent group-hover:border-primary/20 transition-colors duration-500 pointer-events-none" />
    </div>
  );
}
