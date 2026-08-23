import { supabaseAdmin } from "@/integrations/supabase/client.server";

const MIN_TEAMS = 10;

type Row = {
  competition_id: string;
  season: string;
  team_id: string;
  position: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  goal_diff: number;
  points: number;
  form: string;
  computed_at: string;
};

export type CompetitionStandingsResult = {
  competition_id: string;
  name_he: string;
  season: string;
  teams: number;
  rows_written: number;
  skipped: boolean;
  reason?: "less_than_10_teams" | "no_finished_matches";
};

type Agg = {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  points: number;
  results: Array<{ at: string; r: "W" | "D" | "L" }>;
};

function emptyAgg(): Agg {
  return { played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0, results: [] };
}

export async function runComputeStandings(): Promise<{
  status: "success" | "partial" | "failed";
  rows_written: number;
  competitions: CompetitionStandingsResult[];
  error?: string;
}> {
  const startedAt = new Date().toISOString();
  const results: CompetitionStandingsResult[] = [];
  let rowsWritten = 0;
  let failure: string | null = null;

  try {
    const { data: comps, error: compsError } = await supabaseAdmin
      .from("competitions")
      .select("id, name_he, season_calc_method")
      .eq("is_active", true);
    if (compsError) throw compsError;

    for (const comp of comps ?? []) {
      // Season is derived from the database's own single source of truth,
      // the same compute_season() used by the matches trigger.
      const { data: seasonRaw, error: seasonError } = await supabaseAdmin.rpc("compute_season", {
        kickoff: new Date().toISOString(),
        method: comp.season_calc_method ?? "aug_may",
      });
      if (seasonError) throw seasonError;
      const season = String(seasonRaw ?? "");
      if (!season) continue;

      const { data: matches, error: matchesError } = await supabaseAdmin
        .from("matches")
        .select("home_team_id, away_team_id, home_score, away_score, kickoff_at")
        .eq("competition_id", comp.id)
        .eq("season", season)
        .eq("status", "finished")
        .not("home_team_id", "is", null)
        .not("away_team_id", "is", null)
        .not("home_score", "is", null)
        .not("away_score", "is", null);
      if (matchesError) throw matchesError;

      const table = new Map<string, Agg>();
      for (const m of matches ?? []) {
        const home = m.home_team_id as string;
        const away = m.away_team_id as string;
        const hs = m.home_score as number;
        const as = m.away_score as number;
        const at = m.kickoff_at ?? "";

        const h = table.get(home) ?? emptyAgg();
        const a = table.get(away) ?? emptyAgg();
        h.played += 1;
        a.played += 1;
        h.gf += hs;
        h.ga += as;
        a.gf += as;
        a.ga += hs;
        if (hs > as) {
          h.won += 1;
          h.points += 3;
          a.lost += 1;
          h.results.push({ at, r: "W" });
          a.results.push({ at, r: "L" });
        } else if (hs < as) {
          a.won += 1;
          a.points += 3;
          h.lost += 1;
          h.results.push({ at, r: "L" });
          a.results.push({ at, r: "W" });
        } else {
          h.drawn += 1;
          a.drawn += 1;
          h.points += 1;
          a.points += 1;
          h.results.push({ at, r: "D" });
          a.results.push({ at, r: "D" });
        }
        table.set(home, h);
        table.set(away, a);
      }

      if (table.size === 0) {
        results.push({
          competition_id: comp.id,
          name_he: comp.name_he,
          season,
          teams: 0,
          rows_written: 0,
          skipped: true,
          reason: "no_finished_matches",
        });
        continue;
      }

      if (table.size < MIN_TEAMS) {
        results.push({
          competition_id: comp.id,
          name_he: comp.name_he,
          season,
          teams: table.size,
          rows_written: 0,
          skipped: true,
          reason: "less_than_10_teams",
        });
        continue;
      }

      const computedAt = new Date().toISOString();
      const ordered = [...table.entries()].sort((x, y) => {
        const [, a] = x;
        const [, b] = y;
        return (
          b.points - a.points ||
          b.gf - b.ga - (a.gf - a.ga) ||
          b.gf - a.gf
        );
      });

      const rows: Row[] = ordered.map(([teamId, agg], index) => ({
        competition_id: comp.id,
        season,
        team_id: teamId,
        position: index + 1,
        played: agg.played,
        won: agg.won,
        drawn: agg.drawn,
        lost: agg.lost,
        goals_for: agg.gf,
        goals_against: agg.ga,
        goal_diff: agg.gf - agg.ga,
        points: agg.points,
        form: agg.results
          .slice()
          .sort((p, q) => (q.at > p.at ? 1 : q.at < p.at ? -1 : 0))
          .slice(0, 5)
          .map((e) => e.r)
          .join(""),
        computed_at: computedAt,
      }));

      const { error: upsertError } = await supabaseAdmin
        .from("standings")
        .upsert(rows as never, { onConflict: "competition_id,season,team_id" });
      if (upsertError) throw upsertError;

      rowsWritten += rows.length;
      results.push({
        competition_id: comp.id,
        name_he: comp.name_he,
        season,
        teams: rows.length,
        rows_written: rows.length,
        skipped: false,
      });
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  const status = failure ? (rowsWritten > 0 ? "partial" : "failed") : "success";

  await supabaseAdmin.from("job_runs").insert({
    job_name: "compute-standings",
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    status,
    result_metric: rowsWritten,
    result_detail: { competitions: results } as never,
    error: failure,
  });

  return { status, rows_written: rowsWritten, competitions: results, ...(failure ? { error: failure } : {}) };
}
