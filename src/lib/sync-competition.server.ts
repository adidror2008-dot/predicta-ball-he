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
    const seasonsRes = await call(`/api/v1/unique-tournament/${tournamentId}/seasons`);
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

    // ---- upcoming matches via category scheduled-events (day by day)
    let teamsUpserted = 0;
    let matchesUpserted = 0;
    let matchesFound = 0;
    let daysChecked = 0;
    let categoryId: number | null = null;

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

    const dayStr = (d: Date) => d.toISOString().slice(0, 10);
    const today = new Date();

    const stopPartial = async (reason: string, extra: Record<string, any> = {}) => {
      await finish("partial", matchesUpserted, {
        reason,
        category_id: categoryId,
        days_checked: daysChecked,
        matches_found_for_266: matchesFound,
        teams_upserted: teamsUpserted,
        matches_upserted: matchesUpserted,
        season_chosen: seasonId,
        ...extra,
      });
      return {
        status: "partial" as const,
        teams_upserted: teamsUpserted,
        matches_upserted: matchesUpserted,
        season_chosen: seasonId,
        message: reason,
      };
    };

    // 1. discover Israel category
    if (!(await takeBudget("bulk"))) {
      return stopPartial("budget_exhausted_at_categories");
    }
    const catsRes = await call(`/api/v1/sport/football/${dayStr(today)}/0/categories`);
    if (!catsRes.ok || !catsRes.json) {
      await finish(
        "failed",
        0,
        { stage: "categories", http_status: catsRes.status, season_chosen: seasonId },
        catsRes.body.slice(0, 500),
      );
      return {
        status: "error",
        teams_upserted: 0,
        matches_upserted: 0,
        season_chosen: seasonId,
        message: `categories request failed (${catsRes.status}): ${catsRes.body.slice(0, 200)}`,
      };
    }

    const categories: Array<Record<string, any>> =
      catsRes.json["categories"] ?? catsRes.json["data"]?.["categories"] ?? [];
    const israel = categories.find((c) => {
      const name = String(c["name"] ?? "").toLowerCase();
      const slug = String(c["slug"] ?? "").toLowerCase();
      const flag = String(c["flag"] ?? "").toLowerCase();
      const alpha = String(c["alpha2"] ?? "").toLowerCase();
      return name === "israel" || slug === "israel" || flag === "israel" || alpha === "il";
    });

    if (!israel) {
      await finish(
        "failed",
        0,
        { stage: "categories", season_chosen: seasonId, categories_count: categories.length },
        "israel category not found",
      );
      return {
        status: "error",
        teams_upserted: 0,
        matches_upserted: 0,
        season_chosen: seasonId,
        message: "israel category not found",
      };
    }
    categoryId = Number(israel["id"]);

    // 2. day by day scheduled events
    for (let i = 0; i <= 21; i++) {
      if (!(await takeBudget("bulk"))) {
        return stopPartial("budget_exhausted_at_day_" + i);
      }
      const d = new Date(today.getTime() + i * 86400000);
      const res = await call(`/api/v1/category/${categoryId}/scheduled-events/${dayStr(d)}`);
      daysChecked += 1;
      if (!res.ok || !res.json) continue;

      const events: Array<Record<string, any>> =
        res.json["events"] ?? res.json["data"]?.["events"] ?? [];

      for (const ev of events) {
        const uniqueId = ev["tournament"]?.["uniqueTournament"]?.["id"];
        if (Number(uniqueId) !== tournamentId) continue;
        matchesFound += 1;

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
            status: ev["status"]?.["type"] ?? null,
            venue: ev["venue"]?.["stadium"]?.["name"] ?? null,
            round: ev["roundInfo"]?.["round"] != null ? String(ev["roundInfo"]["round"]) : null,
            fetched_at: new Date().toISOString(),
          },
          { onConflict: "external_id,source" },
        );
        if (!error) matchesUpserted += 1;
      }
    }

    const status = matchesUpserted > 0 ? "success" : "skipped";
    await finish(status, matchesUpserted, {
      category_id: categoryId,
      days_checked: daysChecked,
      matches_found_for_266: matchesFound,
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
