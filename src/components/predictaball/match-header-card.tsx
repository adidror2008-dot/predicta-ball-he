import { CalendarDays, Clock, MapPin } from "lucide-react";
import { LogoSlot, LtrNum, SkeletonBlock } from "./ui-bits";
import { VenueText } from "./venue-text";
import type { MatchHeader } from "@/lib/match-details-read.server";
import {
  DISPLAY_STATUS_LABEL_HE,
  PENDING_SCORE_LABEL_HE,
  deriveDisplayStatus,
} from "@/lib/match-display-status";

function formatDate(iso: string | null) {
  if (!iso) return null;
  return new Intl.DateTimeFormat("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Jerusalem",
  }).format(new Date(iso));
}

function formatTime(iso: string | null) {
  if (!iso) return null;
  return new Intl.DateTimeFormat("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jerusalem",
  }).format(new Date(iso));
}

function TeamSide({ name, logo }: { name: string | null; logo: string | null }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-2">
      <LogoSlot className="size-14" logoUrl={logo} name={name} />
      <span dir="auto" className="line-clamp-2 text-center text-xs font-medium">
        {name ?? "—"}
      </span>
    </div>
  );
}

export function MatchHeaderCard({
  header,
  isPending,
}: {
  header: MatchHeader | null | undefined;
  isPending: boolean;
}) {
  if (isPending) return <SkeletonBlock className="h-44" />;
  if (!header) {
    return (
      <section className="rounded-2xl bg-card p-4 text-center text-sm text-muted-foreground shadow-card">
        אין נתוני משחק
      </section>
    );
  }

  const display = deriveDisplayStatus(header.status, header.kickoffAt);
  const isPostponed = display === "postponed";
  const isAwaitingUpdate = display === "pending";
  const isLive = display === "live";
  const hasScore =
    (header.isFinished || isAwaitingUpdate || isLive) &&
    header.homeScore !== null &&
    header.awayScore !== null;
  const date = isPostponed ? null : formatDate(header.kickoffAt);
  const time = isPostponed ? null : formatTime(header.kickoffAt);

  return (
    <section className="rounded-2xl bg-card p-4 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <TeamSide name={header.homeName} logo={header.homeLogo} />

        <div className="flex w-20 shrink-0 flex-col items-center gap-1 pt-3">
          {hasScore ? (
            <LtrNum className="text-2xl font-bold">
              {header.awayScore} - {header.homeScore}
            </LtrNum>
          ) : isPostponed ? (
            <span className="rounded-full bg-status-draw/25 px-2 py-0.5 text-[11px] font-medium text-status-draw">
              נדחה
            </span>
          ) : (
            <span className="text-xl font-bold text-muted-foreground">VS</span>
          )}
          {isLive ? (
            <span className="rounded-full bg-status-win/25 px-2 py-0.5 text-center text-[11px] font-medium text-status-win">
              {header.minute !== null ? (
                <LtrNum>{header.minute}'</LtrNum>
              ) : (
                DISPLAY_STATUS_LABEL_HE.live
              )}
            </span>
          ) : header.isFinished && hasScore ? (
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted-foreground">
              {DISPLAY_STATUS_LABEL_HE.finished}
            </span>
          ) : isAwaitingUpdate ? (
            <>
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-center text-[11px] text-muted-foreground">
                {DISPLAY_STATUS_LABEL_HE.pending}
              </span>
              {hasScore ? (
                <span className="text-center text-[10px] leading-tight text-muted-foreground">
                  {PENDING_SCORE_LABEL_HE}
                </span>
              ) : null}
            </>
          ) : null}
        </div>

        <TeamSide name={header.awayName} logo={header.awayLogo} />
      </div>

      <div className="mt-4 border-t border-border pt-3">
        <h2 className="mb-2 text-xs font-bold text-muted-foreground">פרטי המשחק</h2>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {isPostponed ? <span>מועד חדש טרם נקבע</span> : null}
          {date ? (
            <span className="flex items-center gap-1.5">
              <CalendarDays className="size-3.5" aria-hidden />
              <LtrNum>{date}</LtrNum>
            </span>
          ) : null}
          {time ? (
            <span className="flex items-center gap-1.5">
              <Clock className="size-3.5" aria-hidden />
              <LtrNum>{time}</LtrNum>
            </span>
          ) : null}
        </div>
        {header.venue ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex min-w-0 items-center gap-1.5">
              <MapPin className="size-3.5 shrink-0" aria-hidden />
              <span dir="auto" className="truncate">
                מיקום: <VenueText venue={header.venue} />
              </span>

            </span>
            {header.homeName ? <span>מארחת: {header.homeName}</span> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
