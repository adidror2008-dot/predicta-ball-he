import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeftRight, CircleAlert, Goal, RectangleVertical, Video } from "lucide-react";
import type { ReactNode } from "react";
import { EmptyState, LtrNum, SkeletonBlock } from "./ui-bits";
import { getIncidentsFn } from "@/lib/match-details-read.functions";
import { cn } from "@/lib/utils";

const labelByType: Record<string, string> = {
  goal: "שער",
  penalty_goal: "שער",
  own_goal: "שער עצמי",
  yellow_card: "כרטיס צהוב",
  red_card: "כרטיס אדום",
  substitution: "חילוף",
  var: "VAR",
};

function iconFor(type: string | null): ReactNode {
  switch (type) {
    case "goal":
    case "penalty_goal":
    case "own_goal":
      return <Goal className="size-4" aria-hidden />;
    case "yellow_card":
      return <RectangleVertical className="size-4 text-status-draw" aria-hidden />;
    case "red_card":
      return <RectangleVertical className="size-4 text-status-loss" aria-hidden />;
    case "substitution":
      return <ArrowLeftRight className="size-4" aria-hidden />;
    case "var":
      return <Video className="size-4" aria-hidden />;
    default:
      return <CircleAlert className="size-4" aria-hidden />;
  }
}

function minuteText(minute: number | null, added: number | null) {
  if (minute === null) return "—";
  return added && added > 0 ? `${minute}+${added}'` : `${minute}'`;
}

export function MatchEventsTab({ matchRef }: { matchRef: string }) {
  const fetchIncidents = useServerFn(getIncidentsFn);
  const { data, isPending } = useQuery({
    queryKey: ["match-incidents", matchRef],
    queryFn: () => fetchIncidents({ data: { matchExternalId: matchRef } }),
  });

  if (isPending) {
    return (
      <div className="flex flex-col gap-2">
        <SkeletonBlock className="h-14" />
        <SkeletonBlock className="h-14" />
        <SkeletonBlock className="h-14" />
      </div>
    );
  }

  const events = data ?? [];
  if (events.length === 0) return <EmptyState text="אין אירועים להצגה" />;

  return (
    <ol className="flex flex-col gap-2">
      {events.map((ev, i) => {
        const label = ev.type ? labelByType[ev.type] : undefined;
        return (
          <li
            key={`${ev.minute ?? "x"}-${ev.player_id ?? "p"}-${i}`}
            className="flex items-center gap-3 rounded-2xl bg-card p-3 shadow-card"
          >
            <LtrNum className="min-w-12 text-center text-xs font-bold text-muted-foreground">
              {minuteText(ev.minute, ev.added_minute)}
            </LtrNum>
            <span className="text-muted-foreground">{iconFor(ev.type)}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{ev.player_name ?? "—"}</p>
              {label ? (
                <p className="truncate text-xs text-muted-foreground">
                  {label}
                  {ev.type === "substitution" && ev.related_player_name
                    ? ` · ${ev.related_player_name}`
                    : ""}
                </p>
              ) : null}
            </div>
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[11px]",
                ev.side ? "bg-surface-2 text-muted-foreground" : "text-muted-foreground",
              )}
            >
              {ev.side === "home" ? "בית" : ev.side === "away" ? "חוץ" : "—"}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
