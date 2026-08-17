import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SOFASCORE_HOST = "sportapi7.p.rapidapi.com";
const SOURCE = "sofascore";

export type JobRunStatus = "success" | "partial" | "failed" | "skipped";

export type FetchMatchIncidentsResult = {
  status: JobRunStatus;
  match_external_id: string;
  match_id: string | null;
  http_status: number | null;
  incidents_returned: number;
  raw_incident_types: string[];
  goals_in_incidents: number;
  expected_goals: number | null;
  completeness: boolean;
  events_saved: number;
  budget_exhausted: boolean;
  message?: string;
  job_run_error?: string;
};

type AnyRec = Record<string, any>;

/**
 * Maps a provider incident to our event type.
 * Returns null for non-events (period markers, injury time, etc.) — those are filtered out.
 */
function mapIncidentType(inc: AnyRec): string | null {
  const t = String(inc["incidentType"] ?? "");
  const cls = String(inc["incidentClass"] ?? "");
  if (t === "goal") {
    if (cls === "ownGoal") return "own_goal";
    if (cls === "penalty") return "penalty_goal";
    return "goal";
  }
  if (t === "card") {
    if (cls === "yellow") return "yellow_card";
    if (cls === "yellowRed" || cls === "red") return "red_card";
    return "card";
  }
  if (t === "substitution") return "substitution";
  if (t === "varDecision" || t === "var") return "var";
  return null;
}

/**
 * Incidents fetcher. Never creates players (lineups fetcher owns that).
 * Saves nothing unless the incident goal count matches the known final score:
 * partial timelines mislead both the user and the prediction engine.
 */
export async function runFetchMatchIncidents(data: {
  matchExternalId: string;
}): Promise<FetchMatchIncidentsResult> {
  const startedAt = new Date().toISOString();
  const matchExternalId = String(data.matchExternalId);
  const apiKey = process.env["SPORTAPI_API_KEY"];

  let matchId: string | null = null;
  let httpStatus: number | null = null;
  let incidentsReturned = 0;
  let rawTypes: string[] = [];
  let goalsInIncidents = 0;
  let expectedGoals: number | null = null;
  let completeness = false;
  let eventsSaved = 0;
  let budgetExhausted = false;

  // Writes exactly ONE job_runs row at the end of the run.
  const report = async (
    status: JobRunStatus,
    error?: string,
  ): Promise<string | undefined> => {
    const { error: jobError } = await supabaseAdmin.from("job_runs").insert({
      job_name: "fetch-match-incidents",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status,
      result_metric: eventsSaved,
      result_detail: {
        match_external_id: matchExternalId,
        match_id: matchId,
        http_status: httpStatus,
        incidents_returned: incidentsReturned,
        raw_incident_types: rawTypes,
        goals_in_incidents: goalsInIncidents,
        expected_goals: expectedGoals,
        completeness,
        events_saved: eventsSaved,
        budget_exhausted: budgetExhausted,
      } as never,
      error: error ?? null,
    });
    if (jobError) {
      console.error(
        `[fetch-match-incidents] job_runs insert failed: ${jobError.message}`,
        jobError,
      );
      return jobError.message;
    }
    return undefined;
  };

  const finish = async (
    status: JobRunStatus,
    message?: string,
  ): Promise<FetchMatchIncidentsResult> => {
    const jobRunError = await report(status, message);
    return {
      status,
      match_external_id: matchExternalId,
      match_id: matchId,
      http_status: httpStatus,
      incidents_returned: incidentsReturned,
      raw_incident_types: rawTypes,
      goals_in_incidents: goalsInIncidents,
      expected_goals: expectedGoals,
      completeness,
      events_saved: eventsSaved,
      budget_exhausted: budgetExhausted,
      ...(message ? { message } : {}),
      ...(jobRunError ? { job_run_error: jobRunError } : {}),
    };
  };

  if (!apiKey || apiKey.trim() === "") {
    return finish("failed", "missing SPORTAPI_API_KEY");
  }

  // Step 0 — resolve match. Never create one here.
  const { data: match, error: matchError } = await supabaseAdmin
    .from("matches")
    .select("id, home_team_id, away_team_id, home_score, away_score")
    .eq("external_id", matchExternalId)
    .eq("source", SOURCE)
    .maybeSingle();

  if (matchError) return finish("failed", matchError.message);
  if (!match) return finish("skipped", `match ${matchExternalId} not found in matches`);
  matchId = match.id;

  if (match.home_score == null || match.away_score == null) {
    return finish(
      "skipped",
      "final score unknown in matches — completeness cannot be verified, nothing saved",
    );
  }
  expectedGoals = Number(match.home_score) + Number(match.away_score);

  // Budget gate.
  const { data: allowed, error: budgetError } = await supabaseAdmin.rpc("api_budget_take", {
    p_provider: SOURCE,
    p_category: "bulk",
    p_count: 1,
  });
  if (budgetError) return finish("failed", `budget: ${budgetError.message}`);
  if (allowed !== true) {
    budgetExhausted = true;
    return finish("skipped", "budget exhausted for category bulk");
  }

  // Single outgoing call. No retry.
  const res = await fetch(
    `https://${SOFASCORE_HOST}/api/v1/event/${matchExternalId}/incidents`,
    { headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": SOFASCORE_HOST } },
  );
  httpStatus = res.status;
  const body = await res.text();
  if (!res.ok) {
    return finish("failed", `incidents http ${res.status}: ${body.slice(0, 200)}`);
  }

  let json: AnyRec;
  try {
    json = JSON.parse(body) as AnyRec;
  } catch {
    return finish("failed", "incidents response is not valid JSON");
  }

  const incidents = (json["incidents"] as AnyRec[] | undefined) ?? [];
  incidentsReturned = incidents.length;
  rawTypes = [...new Set(incidents.map((i) => String(i["incidentType"] ?? "")))].filter(Boolean);

  // Real events only — period / injuryTime markers are dropped.
  const significant = incidents.filter((inc) => mapIncidentType(inc) !== null);
  goalsInIncidents = significant.filter((inc) => String(inc["incidentType"]) === "goal").length;

  // Integrity gate: partial timelines are worse than none.
  if (goalsInIncidents !== expectedGoals) {
    return finish(
      "partial",
      `incomplete incidents: goals_in_incidents=${goalsInIncidents} vs expected_goals=${expectedGoals} — nothing saved`,
    );
  }
  completeness = true;

  // Link players by external_id; never create them here.
  const playerMap = new Map<string, string>();
  {
    const ids = new Set<string>();
    const note = (p: AnyRec | undefined | null) => {
      if (p && p["id"] != null) ids.add(String(p["id"]));
    };
    for (const inc of significant) {
      note(inc["player"] as AnyRec);
      note(inc["playerIn"] as AnyRec);
      note(inc["playerOut"] as AnyRec);
      note(inc["assist1"] as AnyRec);
    }
    if (ids.size > 0) {
      const { data: players } = await supabaseAdmin
        .from("players")
        .select("id, external_id")
        .eq("source", SOURCE)
        .in("external_id", [...ids]);
      for (const p of players ?? []) playerMap.set(String(p.external_id), p.id);
    }
  }

  const rows = significant
    .map((inc) => {
      const type = mapIncidentType(inc);
      if (!type || inc["id"] == null) return null;
      const isHome = inc["isHome"];
      const teamId =
        isHome === true ? match.home_team_id : isHome === false ? match.away_team_id : null;
      const primary =
        type === "substitution"
          ? (inc["playerIn"] as AnyRec | undefined)
          : (inc["player"] as AnyRec | undefined);
      const related =
        type === "substitution"
          ? (inc["playerOut"] as AnyRec | undefined)
          : (inc["assist1"] as AnyRec | undefined);
      const addedTime = inc["addedTime"];
      return {
        external_id: String(inc["id"]),
        source: SOURCE,
        match_id: matchId as string,
        type,
        minute: inc["time"] != null ? Number(inc["time"]) : null,
        added_minute: addedTime != null ? Number(addedTime) : null,
        team_id: teamId,
        player_id:
          primary?.["id"] != null ? (playerMap.get(String(primary["id"])) ?? null) : null,
        related_player_id:
          related?.["id"] != null ? (playerMap.get(String(related["id"])) ?? null) : null,
        detail: (inc["incidentClass"] ?? inc["text"] ?? null) as string | null,
        home_score: inc["homeScore"] != null ? Number(inc["homeScore"]) : null,
        away_score: inc["awayScore"] != null ? Number(inc["awayScore"]) : null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) {
    return finish("success", "no significant incidents to save");
  }

  // Uniqueness on events is a PARTIAL unique index (external_id IS NOT NULL),
  // which PostgREST cannot target with ON CONFLICT — delete-then-insert keeps it idempotent.
  const { error: delError } = await supabaseAdmin
    .from("events")
    .delete()
    .eq("source", SOURCE)
    .in(
      "external_id",
      rows.map((r) => r.external_id),
    );
  if (delError) return finish("failed", `events(delete): ${delError.message}`);

  const { error: insError } = await supabaseAdmin.from("events").insert(rows);
  if (insError) return finish("failed", `events(insert): ${insError.message}`);
  eventsSaved = rows.length;

  return finish("success");
}
