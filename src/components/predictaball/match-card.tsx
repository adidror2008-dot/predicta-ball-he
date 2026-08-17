import { Link } from "@tanstack/react-router";
import { LtrNum, LogoSlot } from "./ui-bits";
import { cn } from "@/lib/utils";

export type MatchStatus = "scheduled" | "live" | "finished";

export type MatchCardData = {
  id: string;
  homeName: string;
  awayName: string;
  homeLogo?: string | null;
  awayLogo?: string | null;
  homeScore: number | null;
  awayScore: number | null;
  kickoffTime: string | null;
  date: string | null;
  status: MatchStatus;
};


const statusLabel: Record<MatchStatus, string> = {
  scheduled: "טרם החל",
  live: "משחק חי",
  finished: "הסתיים",
};

const statusClass: Record<MatchStatus, string> = {
  scheduled: "bg-surface-2 text-muted-foreground",
  live: "bg-status-win/15 text-status-win",
  finished: "bg-status-draw/20 text-muted-foreground",
};

export function MatchCard({ match }: { match: MatchCardData }) {
  const hasScore = match.homeScore !== null && match.awayScore !== null;

  return (
    <Link
      to="/match/$id"
      params={{ id: match.id }}
      className="block rounded-2xl bg-card p-4 shadow-card transition-colors hover:bg-surface-2"
    >
      <div className="flex items-center justify-between gap-3">
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-[11px] font-medium",
            statusClass[match.status],
          )}
        >
          {statusLabel[match.status]}
        </span>
        {match.date ? (
          <LtrNum className="text-[11px] text-muted-foreground">{match.date}</LtrNum>
        ) : null}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div className="flex flex-1 items-center gap-2">
          <LogoSlot />
          <span className="truncate text-sm font-medium">{match.homeName}</span>
        </div>

        <div className="min-w-14 text-center">
          {hasScore ? (
            <LtrNum className="text-lg font-bold">
              {match.homeScore} - {match.awayScore}
            </LtrNum>
          ) : match.kickoffTime ? (
            <LtrNum className="text-sm font-medium text-muted-foreground">
              {match.kickoffTime}
            </LtrNum>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          )}
        </div>

        <div className="flex flex-1 items-center justify-end gap-2">
          <span className="truncate text-sm font-medium">{match.awayName}</span>
          <LogoSlot />
        </div>
      </div>
    </Link>
  );
}
