import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SOFASCORE_HOST = "sportapi7.p.rapidapi.com";
const TOURNAMENT_IDS = [266, 370, 9355, 9356];

export type SeasonDiscoveryRow = {
  tournament_id: number;
  seasons_count: number;
  current_season_id: string | null;
  http_status: number | null;
  note?: "quota_blocked" | "request_failed" | "no_seasons";
};

export type DiscoverSeasonsResult =
  | { error: "missing_secret" }
  | { status: "ok"; succeeded: number; total: number; results: SeasonDiscoveryRow[] };

export async function runDiscoverSeasons(): Promise<DiscoverSeasonsResult> {
  const apiKey = process.env["SPORTAPI_API_KEY"];
  if (!apiKey || apiKey.trim() === "") {
    return { error: "missing_secret" };
  }

  const started = new Date().toISOString();
  const results: SeasonDiscoveryRow[] = [];

  for (const id of TOURNAMENT_IDS) {
    const { data: allowed } = await supabaseAdmin.rpc("api_budget_take", {
      p_provider: "sofascore",
      p_category: "bulk",
      p_count: 1,
    });

    if (allowed !== true) {
      results.push({
        tournament_id: id,
        seasons_count: 0,
        current_season_id: null,
        http_status: null,
        note: "quota_blocked",
      });
      continue;
    }

    let httpStatus: number | null = null;
    let seasons: Array<{ id: number; year?: string; name?: string }> = [];
    try {
      const res = await fetch(`https://${SOFASCORE_HOST}/api/v1/unique-tournament/${id}/seasons`, {
        headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": SOFASCORE_HOST },
      });
      httpStatus = res.status;
      const text = await res.text();
      if (res.ok) {
        try {
          const json = JSON.parse(text) as Record<string, any>;
          seasons = json["seasons"] ?? json["data"]?.["seasons"] ?? [];
        } catch {
          seasons = [];
        }
      }
    } catch {
      httpStatus = null;
    }

    if (httpStatus !== 200) {
      results.push({
        tournament_id: id,
        seasons_count: 0,
        current_season_id: null,
        http_status: httpStatus,
        note: "request_failed",
      });
      continue;
    }

    results.push({
      tournament_id: id,
      seasons_count: seasons.length,
      current_season_id: seasons.length > 0 ? String(seasons[0]!.id) : null,
      http_status: httpStatus,
      ...(seasons.length === 0 ? { note: "no_seasons" as const } : {}),
    });
  }

  const succeeded = results.filter((r) => r.http_status === 200 && r.seasons_count > 0).length;

  await supabaseAdmin.from("job_runs").insert({
    job_name: "discover-seasons",
    started_at: started,
    finished_at: new Date().toISOString(),
    status: succeeded === TOURNAMENT_IDS.length ? "success" : succeeded > 0 ? "partial" : "failed",
    result_metric: succeeded,
    result_detail: { total: TOURNAMENT_IDS.length, results } as any,
    error: null,
  });

  return { status: "ok", succeeded, total: TOURNAMENT_IDS.length, results };
}
