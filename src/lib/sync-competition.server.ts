import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SOFASCORE_HOST = "sportapi7.p.rapidapi.com";

export type SyncResult = {
  status: "success" | "partial" | "skipped" | "error";
  teams_upserted: number;
  matches_upserted: number;
  season_chosen: string | null;
  message?: string;
};

export async function runSyncCompetition(data: { tournamentId: number }): Promise<SyncResult> {

    const tournamentId = data.tournamentId;
    const jobName = `sync-competition-${tournamentId}`;
    const apiKey = process.env["SPORTAPI_API_KEY"];

    const started = new Date().toISOString();
    const finish = async (
      status: string,
      metric: number,
      detail: Record<string, any>,
      error?: string,
    ) => {
      await supabaseAdmin.from("job_runs").insert({
        job_name: jobName,
        started_at: started,
        finished_at: new Date().toISOString(),
        status,
        result_metric: metric,
        result_detail: detail as any,
        error: error ?? null,
      });
    };

    if (!apiKey) {
      await finish("failed", 0, {}, "SPORTAPI_API_KEY missing");
      return {
        status: "error",
        teams_upserted: 0,
        matches_upserted: 0,
        season_chosen: null,
        message: "SPORTAPI_API_KEY missing",
      };
    }

    const takeBudget = async (category: "live" | "lineups" | "bulk") => {
      const { data: ok } = await supabaseAdmin.rpc("api_budget_take", {
        p_provider: "sofascore",
        p_category: category,
        p_count: 1,
      });
      return ok === true;
    };

    const call = async (path: string) => {
      const res = await fetch(`https://${SOFASCORE_HOST}${path}`, {
        headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": SOFASCORE_HOST },
      });
      const body = await res.text();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = null;
      }
      return { ok: res.ok, status: res.status, body, json: parsed as Record<string, any> | null };
    };

    // competition row
    const { data: comp } = await supabaseAdmin
      .from("competitions")
      .select("id, season_calc_method")
      .eq("tournament_id", String(tournamentId))
      .maybeSingle();

    if (!comp) {
      await finish("failed", 0, {}, "competition row not found");
      return {
        status: "error",
        teams_upserted: 0,
        matches_upserted: 0,
        season_chosen: null,
        message: "competition row not found",
      };
    }

    // ---- seasons
    if (!(await takeBudget("bulk"))) {
      await finish("skipped", 0, { reason: "budget_exhausted", stage: "seasons" });
      return { status: "skipped", teams_upserted: 0, matches_upserted: 0, season_chosen: null };
    }
    const seasonsRes = await call(`/tournaments/get-seasons?tournamentId=${tournamentId}`);
    if (!seasonsRes.ok || !seasonsRes.json) {
      await finish(
        "failed",
        0,
        { stage: "seasons", http_status: seasonsRes.status },
        seasonsRes.body.slice(0, 500),
      );
      return {
        status: "error",
        teams_upserted: 0,
        matches_upserted: 0,
        season_chosen: null,
        message: `seasons request failed (${seasonsRes.status}): ${seasonsRes.body.slice(0, 200)}`,
      };
    }

    const seasons: Array<{ id: number; year?: string; name?: string }> =
      seasonsRes.json["seasons"] ?? seasonsRes.json["data"]?.["seasons"] ?? [];
    if (seasons.length === 0) {
      await finish("failed", 0, { stage: "seasons" }, "no seasons returned");
      return {
        status: "error",
        teams_upserted: 0,
        matches_upserted: 0,
        season_chosen: null,
        message: "no seasons returned",
      };
    }

    const { data: expectedSeason } = await supabaseAdmin.rpc("compute_season", {
      kickoff: new Date().toISOString(),
      method: comp.season_calc_method ?? "aug_may",
    });
    const expected = (expectedSeason as string | null) ?? "";
    const matched = seasons.find((s) => (s.year ?? "").trim() === expected.trim());
    const chosen = matched ?? seasons[0]!;
    const seasonId = String(chosen.id);

    await supabaseAdmin
      .from("competitions")
      .update({ current_season_id: seasonId, fetched_at: new Date().toISOString() })
      .eq("id", comp.id);

    // ---- next matches (page 0 only)
    if (!(await takeBudget("bulk"))) {
      await finish("skipped", 0, { reason: "budget_exhausted", stage: "matches", season_chosen: seasonId });
      return { status: "skipped", teams_upserted: 0, matches_upserted: 0, season_chosen: seasonId };
    }
    const matchesRes = await call(
      `/tournaments/get-next-matches?tournamentId=${tournamentId}&seasonId=${seasonId}&page=0`,
    );
    if (!matchesRes.ok || !matchesRes.json) {
      await finish(
        "failed",
        0,
        { stage: "matches", http_status: matchesRes.status, season_chosen: seasonId },
        matchesRes.body.slice(0, 500),
      );
      return {
        status: "error",
        teams_upserted: 0,
        matches_upserted: 0,
        season_chosen: seasonId,
        message: `matches request failed (${matchesRes.status})`,
      };
    }

    const events: Array<Record<string, any>> =
      matchesRes.json["events"] ?? matchesRes.json["data"]?.["events"] ?? [];

    let teamsUpserted = 0;
    let matchesUpserted = 0;

    const teamIdCache = new Map<string, string>();
    const upsertTeam = async (team: Record<string, any> | undefined) => {
      if (!team?.['id']) return null;
      const key = String(team['id']);
      if (teamIdCache.has(key)) return teamIdCache.get(key)!;
      const { data: row, error } = await supabaseAdmin
        .from("teams")
        .upsert(
          {
            external_id: key,
            source: "sofascore",
            name_en: team['name'] ?? team['shortName'] ?? null,
            name_he: team['name'] ?? team['shortName'] ?? null,
            short_name: team['nameCode'] ?? team['shortName'] ?? null,
            country: team['country']?.['name'] ?? null,
            fetched_at: new Date().toISOString(),
          },
          { onConflict: "external_id,source" },
        )
        .select("id")
        .maybeSingle();
      if (error || !row) return null;
      teamsUpserted += 1;
      teamIdCache.set(key, row.id);
      return row.id;
    };

    for (const ev of events) {
      const homeId = await upsertTeam(ev["homeTeam"]);
      const awayId = await upsertTeam(ev["awayTeam"]);
      if (!homeId || !awayId) continue;

      const kickoff = ev["startTimestamp"]
        ? new Date(Number(ev["startTimestamp"]) * 1000).toISOString()
        : null;

      const { error } = await supabaseAdmin.from("matches").upsert(
        {
          external_id: String(ev["id"]),
          source: "sofascore",
          competition_id: comp.id,
          home_team_id: homeId,
          away_team_id: awayId,
          kickoff_at: kickoff,
          time_confirmed: ev["startTimestamp"] != null && ev["timeConfirmed"] === true,
          status: ev["status"]?.type ?? null,
          venue: ev["venue"]?.stadium?.name ?? null,
          round: ev["roundInfo"]?.round != null ? String(ev["roundInfo"].round) : null,
          fetched_at: new Date().toISOString(),
        },
        { onConflict: "external_id,source" },
      );
      if (!error) matchesUpserted += 1;
    }

    const status = matchesUpserted > 0 ? "success" : events.length > 0 ? "partial" : "skipped";
    await finish(status, matchesUpserted, {
      teams_upserted: teamsUpserted,
      matches_upserted: matchesUpserted,
      season_chosen: seasonId,
    });

    return {
      status: status as SyncResult["status"],
      teams_upserted: teamsUpserted,
      matches_upserted: matchesUpserted,
      season_chosen: seasonId,
    };
}
