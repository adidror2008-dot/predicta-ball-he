import { Bell, BellRing } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useCompetitionFollows,
  useMatchFollows,
  useToggleCompetitionFollow,
  useToggleMatchFollow,
} from "@/hooks/use-follows";

type BellProps = {
  label: string;
  following: boolean;
  pending?: boolean;
  variant?: "chip" | "icon";
  className?: string;
  onClick: () => void;
};


export function FollowBell({ label, following, pending, variant = "chip", className, onClick }: BellProps) {
  const icon = following ? (
    <BellRing className="size-3.5" aria-hidden />
  ) : (
    <Bell className="size-3.5" aria-hidden />
  );

  return (
    <button
      type="button"
      aria-label={following ? "הסרה מהמעקב" : label}
      title={following ? "במעקב" : label}
      disabled={pending}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full transition-colors active:scale-95",
        variant === "icon" ? "size-7" : "gap-1 px-2 py-1 text-[11px] font-medium",
        following
          ? "bg-brand-gradient text-brand-foreground"
          : "bg-surface text-muted-foreground hover:text-foreground",
        pending && "opacity-60",
        className,
      )}
    >
      {icon}
      {variant === "chip" ? <span>{following ? "במעקב" : label}</span> : null}
    </button>
  );
}

export function MatchFollowBell({ matchId }: { matchId: string }) {
  const { data: follows, isLoading } = useMatchFollows();
  const toggle = useToggleMatchFollow();
  const following = (follows ?? []).includes(matchId);
  const pending = toggle.isPending;

  return (
    <FollowBell
      variant="icon"
      className="absolute top-2 end-2 z-10"
      label="מעקב אחרי המשחק"
      following={following}
      pending={pending || isLoading}
      onClick={() => toggle.mutate({ id: matchId, following })}
    />
  );
}


export function CompetitionFollowBell({ competitionId }: { competitionId: string }) {
  const { data: follows, isLoading } = useCompetitionFollows();
  const toggle = useToggleCompetitionFollow();
  const following = (follows ?? []).includes(competitionId);
  const pending = toggle.isPending;

  return (
    <FollowBell
      label="מעקב ליגה"
      following={following}
      pending={pending || isLoading}
      onClick={() => toggle.mutate({ id: competitionId, following })}
    />
  );
}
