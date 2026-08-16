import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SOFASCORE_HOST = "sportapi7.p.rapidapi.com";
const SOURCE = "sofascore";

export type JobRunStatus = "success" | "partial" | "failed" | "skipped";

export type FetchMatchDetailsResult = {
  status: JobRunStatus;
  match_external_id: string;
  match_id: string | null;
  lineups_upserted: number;
  players_upserted: number;
  events_upserted: number;
  event_types: string[];
  budget_exhausted: boolean;
  message?: string;
  job_run_error?: string;
};

type AnyRec = Record<string, any>;

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

export async function runFetchMatchDetails(data: {
  matchExternalId: string;
}): Promise<FetchMatchDetailsResult> {
  const startedAt = new Date().toISOString();
  const matchExternalId = String(data.matchExternalId);
  const apiKey = process.env["SPORTAPI_API_KEY"];

  let matchId: string | null = null;
  let lineupsUpserted = 0;
  let playersUpserted = 0;
  let eventsUpserted = 0;
  let budgetExhausted = false;
  const eventTypes = new Set<string>();

  // Writes exactly ONE job_runs row at the end of the run.
  const report = async (
    status: JobRunStatus,
    metric: number,
    error?: string,
  ): Promise<string | undefined> => {
    const { error: jobError } = await supabaseAdmin.from("job_runs").insert({
      job_name: "fetch-match-details",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status,
      result_metric: metric,
      result_detail: {
        match_external_id: matchExternalId,
        match_id: matchId,
        lineups_upserted: lineupsUpserted,
        players_upserted: playersUpserted,
        events_upserted: eventsUpserted,
        event_types: [...eventTypes],
        budget_exhausted: budgetExhausted,
      } as never,
      error: error ?? null,
    });
    if (jobError) {
      console.error(
        `[fetch-match-details] job_runs insert failed: ${jobError.message}`,
        jobError,
      );
      return jobError.message;
    }
    return undefined;
  };

  const finish = async (
    status: JobRunStatus,
    message?: string,
  ): Promise<FetchMatchDetailsResult> => {
    const jobRunError = await report(
      status,
      lineupsUpserted + eventsUpserted,
      message,
    );
    return {
      status,
      match_external_id: matchExternalId,
      match_id: matchId,
      lineups_upserted: lineupsUpserted,
      players_upserted: playersUpserted,
      events_upserted: eventsUpserted,
      event_types: [...eventTypes],
      budget_exhausted: budgetExhausted,
      ...(message ? { message } : {}),
      ...(jobRunError ? { job_run_error: jobRunError } : {}),
    };
  };

  if (!apiKey || apiKey.trim() === "") {
    return finish("failed", "missing SPORTAPI_API_KEY");
  }

  // Step 0 — resolve internal match id. Never create a match here.
  const { data: match, error: matchError } = await supabaseAdmin
    .from("matches")
    .select("id, home_team_id, away_team_id")
    .eq("external_id", matchExternalId)
    .eq("source", SOURCE)
    .maybeSingle();

  if (matchError) return finish("failed", matchError.message);
  if (!match) return finish("skipped", `match ${matchExternalId} not found in matches`);

  matchId = match.id;

  const apiGet = async (path: string): Promise<{ ok: boolean; status: number; json: AnyRec | null; body: string }> => {
    const res = await fetch(`https://${SOFASCORE_HOST}${path}`, {
      headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": SOFASCORE_HOST },
    });
    const body = await res.text();
    let json: AnyRec | null = null;
    if (res.ok) {
      try {
        json = JSON.parse(body) as AnyRec;
      } catch {
        json = null;
      }
    }
    return { ok: res.ok && json !== null, status: res.status, json, body };
  };

  const takeBudget = async (category: "lineups" | "bulk"): Promise<boolean> => {
    const { data: allowed } = await supabaseAdmin.rpc("api_budget_take", {
      p_provider: SOURCE,
      p_category: category,
      p_count: 1,
    });
    return allowed === true;
  };

  // Resolve team external ids -> internal uuids (single query).
  const teamMap = new Map<string, string>();
  {
    const { data: teams } = await supabaseAdmin
      .from("teams")
      .select("id, external_id")
      .eq("source", SOURCE)
      .not("external_id", "is", null);
    for (const t of teams ?? []) teamMap.set(String(t.external_id), t.id);
  }

  // Cache of player external_id -> internal uuid
  const playerMap = new Map<string, string>();

  const upsertPlayers = async (
    rows: Array<{
      external_id: string;
      name_en: string | null;
      position?: string | null;
      shirt_number?: number | null;
      team_id?: string | null;
    }>,
  ): Promise<string | null> => {
    if (rows.length === 0) return null;
    const payload = rows.map((r) => ({
      external_id: r.external_id,
      source: SOURCE,
      name_en: r.name_en,
      position: r.position ?? null,
      shirt_number: r.shirt_number ?? null,
      team_id: r.team_id ?? null,
      fetched_at: new Date().toISOString(),
    }));
    // Only the columns above are written; name_he / photo_url are untouched.
    const { data: saved, error } = await supabaseAdmin
      .from("players")
      .upsert(payload, { onConflict: "external_id,source" })
      .select("id, external_id");
    if (error) return error.message;
    for (const p of saved ?? []) playerMap.set(String(p.external_id), p.id);
    playersUpserted += payload.length;
    return null;
  };

  const problems: string[] = [];

  // ---- A) lineups (creates players) ----
  if (!(await takeBudget("lineups"))) {
    budgetExhausted = true;
    return finish("partial", "budget exhausted before lineups");
  }

  const lineupsRes = await apiGet(`/api/v1/event/${matchExternalId}/lineups`);
  if (!lineupsRes.ok) {
    return finish(
      "failed",
      `lineups http ${lineupsRes.status}: ${lineupsRes.body.slice(0, 200)}`,
    );
  }

  {
    const json = lineupsRes.json as AnyRec;
    const sides: Array<{ key: "home" | "away"; side: AnyRec }> = [];
    if (json["home"]) sides.push({ key: "home", side: json["home"] as AnyRec });
    if (json["away"]) sides.push({ key: "away", side: json["away"] as AnyRec });

    const playerRows: Array<{
      external_id: string;
      name_en: string | null;
      position: string | null;
      shirt_number: number | null;
      team_id: string | null;
    }> = [];
    const lineupRows: Array<{
      externalPlayerId: string;
      team_id: string | null;
      is_starting: boolean;
      position: string | null;
      shirt_number: number | null;
      formation: string | null;
    }> = [];

    for (const { key, side } of sides) {
      const formation = side["formation"] != null ? String(side["formation"]) : null;
      const fallbackTeamId = key === "home" ? match.home_team_id : match.away_team_id;
      for (const entry of (side["players"] as AnyRec[] | undefined) ?? []) {
        const p = (entry["player"] ?? {}) as AnyRec;
        if (p["id"] == null) continue;
        const externalPlayerId = String(p["id"]);
        const teamExternalId = entry["teamId"] != null ? String(entry["teamId"]) : null;
        const teamId =
          (teamExternalId ? teamMap.get(teamExternalId) : undefined) ?? fallbackTeamId ?? null;
        const shirt =
          entry["shirtNumber"] ?? p["jerseyNumber"] ?? null;
        playerRows.push({
          external_id: externalPlayerId,
          name_en: p["name"] ?? p["shortName"] ?? null,
          position: (entry["position"] ?? p["position"] ?? null) as string | null,
          shirt_number: shirt != null ? Number(shirt) : null,
          team_id: teamId,
        });
        lineupRows.push({
          externalPlayerId,
          team_id: teamId,
          is_starting: entry["substitute"] !== true,
          position: (entry["position"] ?? p["position"] ?? null) as string | null,
          shirt_number: shirt != null ? Number(shirt) : null,
          formation,
        });
      }
    }

    const playerErr = await upsertPlayers(playerRows);
    if (playerErr) {
      problems.push(`players: ${playerErr}`);
    } else {
      const rows = lineupRows
        .map((l) => {
          const playerId = playerMap.get(l.externalPlayerId);
          if (!playerId) return null;
          return {
            match_id: matchId as string,
            player_id: playerId,
            team_id: l.team_id,
            is_starting: l.is_starting,
            position: l.position,
            shirt_number: l.shirt_number,
            formation: l.formation,
            fetched_at: new Date().toISOString(),
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      if (rows.length > 0) {
        const { error } = await supabaseAdmin
          .from("lineups")
          .upsert(rows, { onConflict: "match_id,player_id" });
        if (error) problems.push(`lineups: ${error.message}`);
        else lineupsUpserted = rows.length;
      }
    }
  }

  // ---- B) incidents (links player_id) ----
  if (!(await takeBudget("bulk"))) {
    budgetExhausted = true;
    return finish("partial", "budget exhausted before incidents");
  }

  const incidentsRes = await apiGet(`/api/v1/event/${matchExternalId}/incidents`);
  if (!incidentsRes.ok) {
    problems.push(`incidents http ${incidentsRes.status}: ${incidentsRes.body.slice(0, 200)}`);
    return finish("partial", problems.join("; "));
  }

  {
    const incidents = ((incidentsRes.json as AnyRec)["incidents"] as AnyRec[] | undefined) ?? [];

    // Ensure every referenced player exists before linking.
    const missing = new Map<string, string | null>();
    const noteMissing = (p: AnyRec | undefined | null) => {
      if (!p || p["id"] == null) return;
      const id = String(p["id"]);
      if (!playerMap.has(id) && !missing.has(id)) {
        missing.set(id, (p["name"] ?? p["shortName"] ?? null) as string | null);
      }
    };

    const significant = incidents.filter((inc) => mapIncidentType(inc) !== null);
    for (const inc of significant) {
      noteMissing(inc["player"] as AnyRec);
      noteMissing(inc["playerIn"] as AnyRec);
      noteMissing(inc["playerOut"] as AnyRec);
      noteMissing(inc["assist1"] as AnyRec);
    }
    if (missing.size > 0) {
      const err = await upsertPlayers(
        [...missing.entries()].map(([external_id, name_en]) => ({ external_id, name_en })),
      );
      if (err) problems.push(`players(incidents): ${err}`);
    }

    const rows = significant
      .map((inc) => {
        const type = mapIncidentType(inc);
        if (!type || inc["id"] == null) return null;
        eventTypes.add(type);
        const isHome = inc["isHome"];
        const teamId =
          isHome === true
            ? match.home_team_id
            : isHome === false
              ? match.away_team_id
              : null;
        const primary =
          type === "substitution"
            ? (inc["playerIn"] as AnyRec | undefined)
            : (inc["player"] as AnyRec | undefined);
        const related =
          type === "substitution" ? (inc["playerOut"] as AnyRec | undefined) : undefined;
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

    if (rows.length > 0) {
      // events' uniqueness is a PARTIAL unique index (external_id IS NOT NULL),
      // which PostgREST cannot target with ON CONFLICT — delete-then-insert instead.
      const { error: delError } = await supabaseAdmin
        .from("events")
        .delete()
        .eq("source", SOURCE)
        .in(
          "external_id",
          rows.map((r) => r.external_id),
        );
      if (delError) problems.push(`events(delete): ${delError.message}`);
      const { error } = await supabaseAdmin.from("events").insert(rows);
      if (error) problems.push(`events: ${error.message}`);
      else eventsUpserted = rows.length;
    }
  }

  if (problems.length > 0) return finish("partial", problems.join("; "));
  return finish("success");
}
