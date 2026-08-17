import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SOFASCORE_HOST = "sportapi7.p.rapidapi.com";

export type SeasonDiscoveryRow = {
  tournament_id: number;
  name_he: string | null;
  seasons_count: number;
  current_season_id: string | null;
  season_year: string | null;
  expected_year: string | null;
  matched_exactly: boolean;
  http_status: number | null;
  note?: "quota_blocked" | "request_failed" | "no_seasons" | "update_failed";
};

export type DiscoverSeasonsResult =
  | { error: "missing_secret" }
  | { status: "ok"; succeeded: number; total: number; results: SeasonDiscoveryRow[] };

/** "2026/27" | "26/27" -> "26/27" ; "2026" -> "26" */
function normaliseYear(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .trim()
    .split("/")
    .map((part) => part.trim().slice(-2))
    .join("/");
}

export async function runDiscoverSeasons(): Promise<DiscoverSeasonsResult> {
  const apiKey = process.env["SPORTAPI_API_KEY"];
  if (!apiKey || apiKey.trim() === "") {
    return { error: "missing_secret" };
  }

  const started = new Date().toISOString();
  const results: SeasonDiscoveryRow[] = [];

  const { data: comps } = await supabaseAdmin
    .from("competitions")
    .select("id, tournament_id, name_he, season_calc_method")
    .eq("is_active", true)
    .not("tournament_id", "is", null)
    .order("sort_order", { ascending: true });

  const competitions = comps ?? [];

  for (const comp of competitions) {
    const tournamentId = Number(comp.tournament_id);
    const { data: expectedRaw } = await supabaseAdmin.rpc("compute_season", {
      kickoff: new Date().toISOString(),
      method: comp.season_calc_method ?? "aug_may",
    });
    const expected = (expectedRaw as string | null) ?? null;

    const base: SeasonDiscoveryRow = {
      tournament_id: tournamentId,
      name_he: comp.name_he ?? null,
      seasons_count: 0,
      current_season_id: null,
      season_year: null,
      expected_year: expected,
      matched_exactly: false,
      http_status: null,
    };

    const { data: allowed } = await supabaseAdmin.rpc("api_budget_take", {
      p_provider: "sofascore",
      p_category: "bulk",
      p_count: 1,
    });
    if (allowed !== true) {
      results.push({ ...base, note: "quota_blocked" });
      continue;
    }

    let httpStatus: number | null = null;
    let seasons: Array<{ id: number; year?: string; name?: string }> = [];
    try {
      const res = await fetch(
        `https://${SOFASCORE_HOST}/api/v1/unique-tournament/${tournamentId}/seasons`,
        { headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": SOFASCORE_HOST } },
      );
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
      results.push({ ...base, http_status: httpStatus, note: "request_failed" });
      continue;
    }
    if (seasons.length === 0) {
      results.push({ ...base, http_status: httpStatus, note: "no_seasons" });
      continue;
    }

    const target = normaliseYear(expected);
    const matched = target
      ? seasons.find((s) => normaliseYear(s.year) === target)
      : undefined;
    const chosen = matched ?? seasons[0]!;
    const seasonId = String(chosen.id);

    const { error: updateError } = await supabaseAdmin
      .from("competitions")
      .update({ current_season_id: seasonId, fetched_at: new Date().toISOString() })
      .eq("id", comp.id);

    results.push({
      ...base,
      seasons_count: seasons.length,
      current_season_id: seasonId,
      season_year: chosen.year ?? null,
      matched_exactly: Boolean(matched),
      http_status: httpStatus,
      ...(updateError ? { note: "update_failed" as const } : {}),
    });
  }

  const succeeded = results.filter((r) => r.current_season_id !== null && !r.note).length;

  await supabaseAdmin.from("job_runs").insert({
    job_name: "discover-seasons",
    started_at: started,
    finished_at: new Date().toISOString(),
    status:
      competitions.length === 0
        ? "skipped"
        : succeeded === competitions.length
          ? "success"
          : succeeded > 0
            ? "partial"
            : "failed",
    result_metric: succeeded,
    result_detail: { total: competitions.length, results } as any,
    error: null,
  });

  return { status: "ok", succeeded, total: competitions.length, results };
}
