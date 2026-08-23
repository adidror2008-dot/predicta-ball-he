import { useQuery } from "@tanstack/react-query";
import { Table2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { EmptyState, LogoSlot, SkeletonBlock } from "@/components/predictaball/ui-bits";
import { supabase } from "@/integrations/supabase/client";

const MIN_ROWS = 10;

type StandingRow = {
  position: number | null;
  played: number | null;
  won: number | null;
  drawn: number | null;
  lost: number | null;
  goals_for: number | null;
  goals_against: number | null;
  goal_diff: number | null;
  points: number | null;
  season: string | null;
  computed_at: string | null;
  teams: { name_he: string | null; name_en: string | null; logo_url: string | null } | null;
};

async function fetchStandings(competitionId: string) {
  const { data, error } = await supabase
    .from("standings")
    .select(
      "position, played, won, drawn, lost, goals_for, goals_against, goal_diff, points, season, computed_at, teams(name_he, name_en, logo_url)",
    )
    .eq("competition_id", competitionId)
    .order("position", { ascending: true });
  if (error) throw error;

  const rows = (data ?? []) as StandingRow[];
  if (rows.length === 0) return { season: null as string | null, rows };

  // Keep only the most recently computed season for this competition.
  const latest = rows.reduce<StandingRow>((acc, r) => {
    const a = acc.computed_at ?? "";
    const b = r.computed_at ?? "";
    return b > a ? r : acc;
  }, rows[0]!);
  return {
    season: latest.season,
    rows: rows.filter((r) => r.season === latest.season),
  };
}

export function StandingsSheet({
  open,
  onOpenChange,
  competitionId,
  competitionName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  competitionId: string;
  competitionName: string;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["standings", competitionId],
    queryFn: () => fetchStandings(competitionId),
    enabled: open,
  });

  const rows = data?.rows ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-start">
            טבלת דירוג · {competitionName}
            {data?.season ? (
              <span className="ms-2 text-xs font-normal text-muted-foreground">
                עונת <span dir="ltr">{data.season}</span>
              </span>
            ) : null}
          </SheetTitle>
        </SheetHeader>

        <div className="px-4 pb-6">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <SkeletonBlock key={i} className="h-9" />
              ))}
            </div>
          ) : rows.length < MIN_ROWS ? (
            <EmptyState text="הטבלה תתעדכן עם תחילת העונה" />
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="py-2 text-start font-medium">#</th>
                  <th className="py-2 text-start font-medium">קבוצה</th>
                  <th className="py-2 text-center font-medium">מש׳</th>
                  <th className="py-2 text-center font-medium">נצ׳</th>
                  <th className="py-2 text-center font-medium">תי׳</th>
                  <th className="py-2 text-center font-medium">הפ׳</th>
                  <th className="py-2 text-center font-medium">שערים</th>
                  <th className="py-2 text-center font-medium">הפרש</th>
                  <th className="py-2 text-center font-medium">נק׳</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.position}-${i}`} className="border-t border-border">
                    <td className="py-2 text-start text-muted-foreground">
                      <span dir="ltr">{r.position ?? i + 1}</span>
                    </td>
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        <LogoSlot
                          className="size-6"
                          logoUrl={r.teams?.logo_url}
                          name={r.teams?.name_he ?? r.teams?.name_en}
                        />
                        <span className="truncate">
                          {r.teams?.name_he ?? r.teams?.name_en ?? "—"}
                        </span>
                      </div>
                    </td>
                    <td className="py-2 text-center">
                      <span dir="ltr">{r.played ?? 0}</span>
                    </td>
                    <td className="py-2 text-center">
                      <span dir="ltr">{r.won ?? 0}</span>
                    </td>
                    <td className="py-2 text-center">
                      <span dir="ltr">{r.drawn ?? 0}</span>
                    </td>
                    <td className="py-2 text-center">
                      <span dir="ltr">{r.lost ?? 0}</span>
                    </td>
                    <td className="py-2 text-center">
                      <span dir="ltr">{`${r.goals_against ?? 0}:${r.goals_for ?? 0}`}</span>
                    </td>
                    <td className="py-2 text-center">
                      <span dir="ltr">{r.goal_diff ?? 0}</span>
                    </td>
                    <td className="py-2 text-center font-bold">
                      <span dir="ltr">{r.points ?? 0}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function StandingsButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex shrink-0 items-center gap-1.5 rounded-2xl bg-surface px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors active:bg-surface-2"
    >
      <Table2 className="size-3.5" aria-hidden />
      טבלת דירוג
    </button>
  );
}
