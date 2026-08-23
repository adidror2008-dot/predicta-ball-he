import { useQuery } from "@tanstack/react-query";
import { Table2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { EmptyState, LogoSlot, SkeletonBlock } from "@/components/predictaball/ui-bits";
import { supabase } from "@/integrations/supabase/client";

const MIN_ROWS = 10;
const LOGO_BUCKET = "team-logos";
const LOGO_SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

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

/**
 * The `team-logos` bucket stores relative paths (e.g. `sofascore/1641.png`),
 * so logos are signed at read time — the same approach the match list uses.
 */
async function signLogos(rows: StandingRow[]) {
  const paths = Array.from(
    new Set(
      rows
        .map((r) => r.teams?.logo_url)
        .filter((u): u is string => !!u && !/^https?:\/\//i.test(u)),
    ),
  );
  const signedByPath = new Map<string, string>();
  if (paths.length > 0) {
    const { data } = await supabase.storage
      .from(LOGO_BUCKET)
      .createSignedUrls(paths, LOGO_SIGNED_URL_TTL_SECONDS);
    for (const s of data ?? []) {
      if (s.signedUrl && s.path) signedByPath.set(s.path, s.signedUrl);
    }
  }
  return (raw: string | null | undefined): string | null => {
    if (!raw) return null;
    if (/^https?:\/\//i.test(raw)) return raw;
    return signedByPath.get(raw) ?? null;
  };
}

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
  if (rows.length === 0) return { season: null as string | null, rows, logos: [] as (string | null)[] };

  // Keep only the most recently computed season for this competition.
  const latest = rows.reduce<StandingRow>((acc, r) => {
    const a = acc.computed_at ?? "";
    const b = r.computed_at ?? "";
    return b > a ? r : acc;
  }, rows[0]!);
  const seasonRows = rows.filter((r) => r.season === latest.season);
  const logoUrl = await signLogos(seasonRows);
  return {
    season: latest.season,
    rows: seasonRows,
    logos: seasonRows.map((r) => logoUrl(r.teams?.logo_url)),
  };
}

function Num({ children }: { children: React.ReactNode }) {
  return (
    <span dir="ltr" className="tabular-nums">
      {children}
    </span>
  );
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

        <div className="px-4 pb-8">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <SkeletonBlock key={i} className="h-12" />
              ))}
            </div>
          ) : rows.length < MIN_ROWS ? (
            <EmptyState text="הטבלה תתעדכן עם תחילת העונה" />
          ) : (
            <table className="w-full table-fixed text-[13px]">
              <colgroup>
                <col className="w-7" />
                <col />
                <col className="w-9" />
                <col className="w-9" />
                <col className="w-9" />
                <col className="w-9" />
                <col className="w-11" />
                <col className="w-11" />
              </colgroup>
              <thead>
                <tr className="text-[11px] text-muted-foreground">
                  <th className="pb-3 text-start font-medium">#</th>
                  <th className="pb-3 ps-2 text-start font-medium">קבוצה</th>
                  <th className="pb-3 text-center font-medium">מש׳</th>
                  <th className="pb-3 text-center font-medium">נצ׳</th>
                  <th className="pb-3 text-center font-medium">תי׳</th>
                  <th className="pb-3 text-center font-medium">הפ׳</th>
                  <th className="pb-3 text-center font-medium">הפרש</th>
                  <th className="pb-3 text-center font-medium">נק׳</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.position}-${i}`} className="border-t border-border">
                    <td className="py-3 text-start text-xs text-muted-foreground">
                      <Num>{r.position ?? i + 1}</Num>
                    </td>
                    <td className="py-3 ps-2">
                      <div className="flex items-center gap-2.5">
                        <LogoSlot
                          className="size-7"
                          logoUrl={data?.logos?.[i] ?? null}
                          name={r.teams?.name_he ?? r.teams?.name_en ?? null}
                        />
                        <span className="truncate">
                          {r.teams?.name_he ?? r.teams?.name_en ?? "—"}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 text-center text-muted-foreground">
                      <Num>{r.played ?? 0}</Num>
                    </td>
                    <td className="py-3 text-center">
                      <Num>{r.won ?? 0}</Num>
                    </td>
                    <td className="py-3 text-center">
                      <Num>{r.drawn ?? 0}</Num>
                    </td>
                    <td className="py-3 text-center">
                      <Num>{r.lost ?? 0}</Num>
                    </td>
                    <td className="py-3 text-center text-muted-foreground">
                      <Num>{r.goal_diff ?? 0}</Num>
                    </td>
                    <td className="py-3 text-center">
                      <span
                        dir="ltr"
                        className="inline-block min-w-7 rounded-lg bg-surface-2 px-1.5 py-0.5 font-bold tabular-nums text-brand-3"
                      >
                        {r.points ?? 0}
                      </span>
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
