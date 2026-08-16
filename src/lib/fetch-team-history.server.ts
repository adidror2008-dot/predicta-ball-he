import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SOFASCORE_HOST = "sportapi7.p.rapidapi.com";

export type TeamHistoryTeamResult = {
  team_external_id: string;
  rows: number;
  ok: boolean;
  error: string | null;
};

export type JobRunStatus = "success" | "partial" | "failed" | "skipped";

export type FetchTeamHistoryResult = {
  status: JobRunStatus;
  teams_checked: number;
  teams_updated: number;
  rows_upserted: number;
  budget_exhausted: boolean;
  teams: TeamHistoryTeamResult[];
  message?: string;
  job_run_error?: string;
};

export async function runFetchTeamHistory(
  data: { teamExternalId?: string; limit?: number } = {},
): Promise<FetchTeamHistoryResult> {
  const limit = data.limit ?? 10;
  const startedAt = new Date().toISOString();
  const apiKey = process.env["SPORTAPI_API_KEY"];

  // Writes exactly ONE job_runs row at the end of the run.
  const report = async (
    status: JobRunStatus,
    metric: number,
    detail: Record<string, unknown>,
    error?: string,
  ): Promise<string | undefined> => {
    const { error: jobError } = await supabaseAdmin.from("job_runs").insert({
      job_name: "fetch-team-history",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status,
      result_metric: metric,
      result_detail: detail as never,
      error: error ?? null,
    });
    if (jobError) {
      console.error(
        `[fetch-team-history] job_runs insert failed: ${jobError.message}`,
        jobError,
      );
      return jobError.message;
    }
    return undefined;
  };

  const emptyDetail = {
    teams_checked: 0,
    teams_updated: 0,
    rows_upserted: 0,
    budget_exhausted: false,
    teams: [] as TeamHistoryTeamResult[],
  };

  if (!apiKey || apiKey.trim() === "") {
    const jobRunError = await report("failed", 0, emptyDetail, "missing SPORTAPI_API_KEY");
    return {
      status: "failed",
      ...emptyDetail,
      message: "missing SPORTAPI_API_KEY",
      ...(jobRunError ? { job_run_error: jobRunError } : {}),
    };
  }

  let query = supabaseAdmin
    .from("teams")
    .select("id, external_id, history_checked_at")
    .eq("source", "sofascore")
    .not("external_id", "is", null);

  if (data.teamExternalId) {
    query = query.eq("external_id", data.teamExternalId);
  } else {
    query = query
      .order("history_checked_at", { ascending: true, nullsFirst: true })
      .limit(limit);
  }

  const { data: teams, error: teamsError } = await query;

  if (teamsError) {
    const jobRunError = await report("failed", 0, emptyDetail, teamsError.message);
    return {
      status: "failed",
      ...emptyDetail,
      message: teamsError.message,
      ...(jobRunError ? { job_run_error: jobRunError } : {}),
    };
  }


  const targets = teams ?? [];
  const perTeam: TeamHistoryTeamResult[] = [];
  let teamsChecked = 0;
  let teamsUpdated = 0;
  let rowsUpserted = 0;
  let budgetExhausted = false;

  for (const team of targets) {
    const externalId = String(team.external_id);

    const { data: allowed } = await supabaseAdmin.rpc("api_budget_take", {
      p_provider: "sofascore",
      p_category: "bulk",
      p_count: 1,
    });

    if (allowed !== true) {
      budgetExhausted = true;
      break;
    }

    teamsChecked += 1;
    let ok = false;
    let teamRows = 0;
    let errorText: string | null = null;

    try {
      const res = await fetch(
        `https://${SOFASCORE_HOST}/api/v1/team/${externalId}/events/last/0`,
        { headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": SOFASCORE_HOST } },
      );
      const body = await res.text();

      if (!res.ok) {
        errorText = `http ${res.status}: ${body.slice(0, 200)}`;
      } else {
        const json = JSON.parse(body) as Record<string, any>;
        const events: Array<Record<string, any>> = json["events"] ?? [];
        const finished = events.filter((ev) => ev["status"]?.["type"] === "finished");

        const rows = finished.map((ev) => {
          const isHome = String(ev["homeTeam"]?.["id"] ?? "") === externalId;
          const homeGoals = ev["homeScore"]?.["current"] ?? null;
          const awayGoals = ev["awayScore"]?.["current"] ?? null;
          const goalsFor = isHome ? homeGoals : awayGoals;
          const goalsAgainst = isHome ? awayGoals : homeGoals;
          const opponent = isHome ? ev["awayTeam"] : ev["homeTeam"];
          let result: string | null = null;
          if (typeof goalsFor === "number" && typeof goalsAgainst === "number") {
            result = goalsFor > goalsAgainst ? "W" : goalsFor < goalsAgainst ? "L" : "D";
          }
          return {
            team_external_id: externalId,
            source: "sofascore",
            external_id: String(ev["id"]),
            opponent_external_id: opponent?.["id"] != null ? String(opponent["id"]) : null,
            opponent_name: opponent?.["name"] ?? opponent?.["shortName"] ?? null,
            is_home: isHome,
            goals_for: typeof goalsFor === "number" ? goalsFor : null,
            goals_against: typeof goalsAgainst === "number" ? goalsAgainst : null,
            result,
            played_at: ev["startTimestamp"]
              ? new Date(Number(ev["startTimestamp"]) * 1000).toISOString()
              : null,
            tournament_id: ev["tournament"]?.["id"] != null ? String(ev["tournament"]["id"]) : null,
            unique_tournament_id:
              ev["tournament"]?.["uniqueTournament"]?.["id"] != null
                ? String(ev["tournament"]["uniqueTournament"]["id"])
                : null,
            competition_name: ev["tournament"]?.["name"] ?? null,
            category_name: ev["tournament"]?.["category"]?.["name"] ?? null,
            season: ev["season"]?.["year"] != null ? String(ev["season"]["year"]) : null,
            raw: ev as never,
            fetched_at: new Date().toISOString(),
          };
        });

        if (rows.length > 0) {
          const { error: upsertError } = await supabaseAdmin
            .from("team_history")
            .upsert(rows, { onConflict: "team_external_id,source,external_id" });
          if (upsertError) {
            errorText = upsertError.message;
          } else {
            teamRows = rows.length;
            ok = true;
          }
        } else {
          ok = true;
        }
      }
    } catch (e) {
      errorText = e instanceof Error ? e.message : String(e);
    }

    await supabaseAdmin
      .from("teams")
      .update({ history_checked_at: new Date().toISOString() })
      .eq("id", team.id);

    if (ok) {
      teamsUpdated += 1;
      rowsUpserted += teamRows;
    }

    perTeam.push({ team_external_id: externalId, rows: teamRows, ok, error: errorText });
  }

  const detail = {
    teams_checked: teamsChecked,
    teams_updated: teamsUpdated,
    rows_upserted: rowsUpserted,
    budget_exhausted: budgetExhausted,
    teams: perTeam,
  };

  await finish("succeeded", teamsUpdated, detail);

  return { status: "succeeded", ...detail };
}
