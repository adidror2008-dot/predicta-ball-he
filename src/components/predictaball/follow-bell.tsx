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


export function FollowBell({ label, following, pending, onClick }: BellProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={pending}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium transition-colors active:scale-95",
        following
          ? "bg-brand-gradient text-brand-foreground"
          : "bg-surface text-muted-foreground hover:text-foreground",
        pending && "opacity-60",
      )}
    >
      {following ? <BellRing className="size-3.5" aria-hidden /> : <Bell className="size-3.5" aria-hidden />}
      <span>{following ? "במעקב" : label}</span>
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
      label="מעקב"
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
