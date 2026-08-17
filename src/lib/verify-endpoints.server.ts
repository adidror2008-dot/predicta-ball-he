import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SOFASCORE_HOST = "sportapi7.p.rapidapi.com";

type CallResult = {
  path: string;
  http_status: number | null;
  json: Record<string, any> | null;
  error?: string;
};

export type VerifyEndpointsResult =
  | { error: "missing_secret" }
  | { status: "ok" | "partial"; calls_made: number; report: Record<string, any> };

export async function runVerifyEndpoints(): Promise<VerifyEndpointsResult> {
  const apiKey = process.env["SPORTAPI_API_KEY"];
  if (!apiKey || apiKey.trim() === "") {
    return { error: "missing_secret" };
  }

  const started = new Date().toISOString();
  let callsMade = 0;
  let budgetBlockedAt: string | null = null;

  const takeBudget = async () => {
    const { data } = await supabaseAdmin.rpc("api_budget_take", {
      p_provider: "sofascore",
      p_category: "bulk",
      p_count: 1,
    });
    return data === true;
  };

  const call = async (path: string): Promise<CallResult | null> => {
    if (budgetBlockedAt) return null;
    if (!(await takeBudget())) {
      budgetBlockedAt = path;
      return null;
    }
    callsMade += 1;
    try {
      const res = await fetch(`https://${SOFASCORE_HOST}${path}`, {
        headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": SOFASCORE_HOST },
      });
      const text = await res.text();
      let json: Record<string, any> | null = null;
      try {
        json = JSON.parse(text) as Record<string, any>;
      } catch {
        json = null;
      }
      return { path, http_status: res.status, json };
    } catch (e) {
      return { path, http_status: null, json: null, error: String(e).slice(0, 200) };
    }
  };

  const eventsOf = (json: Record<string, any> | null) => {
    if (!json) return { events: [] as Array<Record<string, any>>, jsonPath: null as string | null };
    if (Array.isArray(json["events"])) return { events: json["events"], jsonPath: "events" };
    if (Array.isArray(json["data"]?.["events"]))
      return { events: json["data"]["events"], jsonPath: "data.events" };
    return { events: [], jsonPath: null };
  };

  // ---- (a) tournament identity
  const tournaments: Array<Record<string, any>> = [];
  for (const id of [7, 679, 8, 17, 325]) {
    const r = await call(`/api/v1/unique-tournament/${id}`);
    if (!r) break;
    const ut = r.json?.["uniqueTournament"] ?? null;
    tournaments.push({
      id_requested: id,
      http_status: r.http_status,
      name: ut?.["name"] ?? null,
      slug: ut?.["slug"] ?? null,
      category_name: ut?.["category"]?.["name"] ?? null,
      category_id: ut?.["category"]?.["id"] ?? null,
    });
  }

  // ---- (b) season-events endpoints
  const seasonEvents: Array<Record<string, any>> = [];
  for (const path of [
    "/api/v1/unique-tournament/266/season/96740/events/next/0",
    "/api/v1/unique-tournament/266/season/96740/events/last/0",
    "/api/v1/sport/football/events/live",
  ]) {
    const r = await call(path);
    if (!r) break;
    const { events, jsonPath } = eventsOf(r.json);
    const row: Record<string, any> = {
      path,
      http_status: r.http_status,
      events_count: events.length,
      has_hasNextPage_field: r.json ? Object.hasOwn(r.json, "hasNextPage") : false,
      hasNextPage_value: r.json?.["hasNextPage"] ?? null,
      json_path_of_events_array: jsonPath,
    };
    if (path.endsWith("/events/live")) {
      row["events_for_tournament_266"] = events.filter(
        (ev) => Number(ev["tournament"]?.["uniqueTournament"]?.["id"]) === 266,
      ).length;
    }
    seasonEvents.push(row);
  }

  // ---- (c) round metadata shape
  const roundMeta: Record<string, any> = {};
  const seasonsRes = await call("/api/v1/unique-tournament/7/seasons");
  if (seasonsRes) {
    const seasons: Array<Record<string, any>> =
      seasonsRes.json?.["seasons"] ?? seasonsRes.json?.["data"]?.["seasons"] ?? [];
    roundMeta["seasons_http_status"] = seasonsRes.http_status;
    roundMeta["first_3_seasons"] = seasons.slice(0, 3).map((s) => ({
      id: s["id"],
      year: s["year"] ?? null,
      name: s["name"] ?? null,
    }));

    const newest = seasons[0];
    if (newest?.["id"] != null) {
      const evRes = await call(
        `/api/v1/unique-tournament/7/season/${newest["id"]}/events/last/0`,
      );
      if (evRes) {
        const { events } = eventsOf(evRes.json);
        const roundInfos = new Map<string, Record<string, any>>();
        const statusTypes = new Set<string>();
        let anyAggregated = false;
        for (const ev of events) {
          const ri = ev["roundInfo"];
          if (ri) roundInfos.set(JSON.stringify(ri), ri);
          const st = ev["status"]?.["type"];
          if (st) statusTypes.add(String(st));
          if (Object.hasOwn(ev, "aggregatedWinnerCode")) anyAggregated = true;
        }
        roundMeta["events_season_id"] = newest["id"];
        roundMeta["events_http_status"] = evRes.http_status;
        roundMeta["events_count"] = events.length;
        roundMeta["distinct_roundInfo"] = Array.from(roundInfos.values());
        roundMeta["distinct_status_types"] = Array.from(statusTypes);
        roundMeta["any_aggregatedWinnerCode"] = anyAggregated;
        roundMeta["sample_event_keys"] = events[0] ? Object.keys(events[0]) : [];
      }
    }
  }

  const report = {
    tournaments,
    season_events: seasonEvents,
    round_metadata: roundMeta,
    budget_blocked_at: budgetBlockedAt,
    calls_made: callsMade,
  };

  await supabaseAdmin.from("job_runs").insert({
    job_name: "verify-endpoints",
    started_at: started,
    finished_at: new Date().toISOString(),
    status: budgetBlockedAt ? "partial" : "success",
    result_metric: callsMade,
    result_detail: report as any,
    error: null,
  });

  return { status: budgetBlockedAt ? "partial" : "ok", calls_made: callsMade, report };
}
