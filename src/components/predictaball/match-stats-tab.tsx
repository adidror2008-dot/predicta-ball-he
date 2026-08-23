import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { EmptyState, LtrNum, SkeletonBlock } from "@/components/predictaball/ui-bits";
import { getMatchStatsFn } from "@/lib/match-details-read.functions";

function formatValue(value: number, isPercent: boolean) {
  const n = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return isPercent ? `${n}%` : n;
}

export function MatchStatsTab({ matchRef }: { matchRef: string }) {
  const fetchStats = useServerFn(getMatchStatsFn);
  const { data, isPending } = useQuery({
    queryKey: ["match-stats", matchRef],
    queryFn: () => fetchStats({ data: { matchExternalId: matchRef } }),
  });

  if (isPending) {
    return (
      <div className="flex flex-col gap-3">
        <SkeletonBlock className="h-12" />
        <SkeletonBlock className="h-12" />
        <SkeletonBlock className="h-12" />
        <SkeletonBlock className="h-12" />
      </div>
    );
  }

  if (!data || data.length === 0) {
    return <EmptyState text="אין סטטיסטיקות זמינות למשחק זה" />;
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-card px-4 py-4 shadow-card">
      {data.map((stat) => {
        const total = stat.home + stat.away;
        const homePct = total > 0 ? (stat.home / total) * 100 : 50;
        const awayPct = 100 - homePct;
        return (
          <div key={stat.key} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs">
              <LtrNum className="font-bold text-foreground">
                {formatValue(stat.home, stat.is_percent)}
              </LtrNum>
              <span className="text-muted-foreground">{stat.label_he}</span>
              <LtrNum className="font-bold text-foreground">
                {formatValue(stat.away, stat.is_percent)}
              </LtrNum>
            </div>
            <div className="flex h-1.5 w-full gap-1 overflow-hidden">
              <div className="flex flex-1 justify-end">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${homePct}%` }}
                  aria-hidden
                />
              </div>
              <div className="flex flex-1 justify-start">
                <div
                  className="h-full rounded-full bg-surface-2"
                  style={{ width: `${awayPct}%` }}
                  aria-hidden
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
