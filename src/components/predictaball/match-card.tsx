import { Link } from "@tanstack/react-router";
import { BallIcon } from "./ball-icon";
import { MatchFollowBell } from "./follow-bell";
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
  minute?: number | null;
};


const statusLabel: Record<MatchStatus, string> = {
  scheduled: "טרם החל",
  live: "משחק חי",
  finished: "הסתיים",
};

const statusClass: Record<MatchStatus, string> = {
  scheduled: "bg-surface-2 text-muted-foreground",
  live: "bg-status-loss/15 text-status-loss",
  finished: "bg-status-draw/20 text-muted-foreground",
};

export function MatchCard({ match }: { match: MatchCardData }) {
  const hasScore = match.homeScore !== null && match.awayScore !== null;
  const isFuture = match.status === "scheduled";

  return (
    <Link
      id={`match-${match.id}`}
      to="/match/$id"
      params={{ id: match.id }}
      className="relative block rounded-2xl bg-card p-4 shadow-card transition-colors hover:bg-surface-2"
    >
      <MatchFollowBell matchId={match.id} />

      <div className="flex items-center justify-between gap-3 pe-9">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium",
            statusClass[match.status],
          )}
        >
          {match.status === "live" ? <BallIcon spin /> : null}
          {statusLabel[match.status]}
        </span>
        <div className="flex items-center gap-2">
          {!isFuture && match.date ? (
            <LtrNum className="text-[11px] text-muted-foreground">{match.date}</LtrNum>
          ) : null}
        </div>
      </div>


      <div className="mt-3 flex items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <LogoSlot logoUrl={match.homeLogo ?? null} name={match.homeName} />
          <span className="min-w-0 flex-1 truncate whitespace-nowrap text-start text-sm font-medium">{match.homeName}</span>
        </div>

        <div className="w-14 shrink-0 text-center">
          {hasScore ? (
            <div className="flex flex-col items-center gap-0.5">
              {match.status === "live" && match.minute != null ? (
                <LtrNum className="text-[11px] font-semibold text-status-loss">
                  {match.minute}׳
                </LtrNum>
              ) : null}
              <LtrNum className="text-lg font-bold">
                {match.homeScore} - {match.awayScore}
              </LtrNum>
            </div>
          ) : isFuture && match.date ? (
            <div className="flex flex-col items-center gap-0.5">
              <LtrNum className="text-[13px] font-medium text-foreground">{match.date}</LtrNum>
              {match.kickoffTime ? (
                <LtrNum className="text-sm font-medium text-muted-foreground">{match.kickoffTime}</LtrNum>
              ) : (
                <span className="text-sm text-muted-foreground">—</span>
              )}
            </div>
          ) : match.kickoffTime ? (
            <LtrNum className="text-sm font-medium text-muted-foreground">
              {match.kickoffTime}
            </LtrNum>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          )}
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          <span className="min-w-0 flex-1 truncate whitespace-nowrap text-end text-sm font-medium">{match.awayName}</span>
          <LogoSlot logoUrl={match.awayLogo ?? null} name={match.awayName} />
        </div>
      </div>
    </Link>
  );
}

