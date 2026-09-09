import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Manual, bounded backfill of overdue match results through API-Football.
 *
 * Iron rules honoured here:
 * - API-Football is a BACKUP source. It may only UPDATE status/score on
 *   matches that already exist (created by Sofascore, the identity owner).
 *   It never inserts teams, competitions or matches, and never touches
 *   external_id / source identity columns.
 * - Every outgoing call passes api_budget_take(provider='api-football').
 * - Provider truth only: status is copied from the provider, never inferred
 *   from the fact that the kickoff time has passed.
 */

const HOST = "https://v3.football.api-sports.io";
const PROVIDER = "api-football";
const LIVE_SOURCE = "api-football";

type AnyRec = Record<string, any>;

export type BackfillResult = {
  status: "success" | "partial" | "failed" | "skipped";
  reason?: string;
  key_present: boolean;
  plan: {
    requests_limit_day: number | null;
    requests_current: number | null;
    rate_limit_headers: Record<string, string>;
    quota_row_updated: boolean;
    daily_limit_applied: number | null;
    reserve_applied: number | null;
  };
  calls_used: number;
  candidates: number;
  dates_fetched: number;
  matched: number;
  updated: number;
  unchanged: number;
  ambiguous_flagged: number;
  not_found: number;
  still_open_at_provider: number;
  by_competition: Record<string, { before: number; updated: number }>;
  changes: Array<{
    match: string;
    kickoff: string;
    competition: string;
    from: string;
    to: string;
    score: string | null;
  }>;
  conflicts: string[];
  unmatched: Array<{
    match: string;
    kickoff: string;
    competition: string;
    closest: string | null;
    closest_score: number;
    closest_kickoff: string | null;
  }>;
  errors: string[];
  details_note: string;
};


const DROP_TOKENS = new Set([
  "fc", "sc", "sv", "ac", "as", "cf", "afc", "ssc", "vfb", "vfl", "bsc", "tsg",
  "rc", "cd", "ca", "ec", "se", "cr", "fk", "if", "bk", "us", "ud", "club",
  "de", "the", "cp", "sk", "ss", "kv", "rcd", "aj", "og", "sd", "tsv", "1",
]);

function normalizeName(raw: string): string[] {
  const base = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return base
    .split(" ")
    .filter((t) => t.length > 0 && !DROP_TOKENS.has(t) && !/^\d+$/.test(t));
}

/** 1 = one token set fully contains the other, else Jaccard-ish overlap ratio. */
function similarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter += 1;
  if (inter === 0) return 0;
  return inter / Math.min(sa.size, sb.size);
}

function mapStatus(short: string): { status: string; final: boolean; live: boolean } | null {
  switch (short) {
    case "FT":
    case "AET":
    case "PEN":
      return { status: "finished", final: true, live: false };
    case "PST":
      return { status: "postponed", final: true, live: false };
    case "CANC":
      return { status: "canceled", final: true, live: false };
    case "ABD":
      return { status: "canceled", final: true, live: false };
    case "AWD":
    case "WO":
      return { status: "awarded", final: true, live: false };
    case "1H":
    case "2H":
    case "HT":
    case "ET":
    case "BT":
    case "P":
    case "LIVE":
    case "INT":
      return { status: "inprogress", final: false, live: true };
    case "NS":
    case "TBD":
      return { status: "notstarted", final: false, live: false };
    default:
      return null;
  }
}

export async function runBackfillApiFootball(options: {
  cutoffIso: string;
  maxCalls?: number;
  dryRun?: boolean;
}): Promise<BackfillResult> {
  const startedAt = new Date().toISOString();
  const apiKey = process.env["API_FOOTBALL_KEY"];
  const maxCalls = options.maxCalls ?? 20;

  const result: BackfillResult = {
    status: "success",
    key_present: Boolean(apiKey && apiKey.length > 0),
    plan: {
      requests_limit_day: null,
      requests_current: null,
      rate_limit_headers: {},
      quota_row_updated: false,
      daily_limit_applied: null,
      reserve_applied: null,
    },
    calls_used: 0,
    candidates: 0,
    dates_fetched: 0,
    matched: 0,
    updated: 0,
    unchanged: 0,
    ambiguous_flagged: 0,
    not_found: 0,
    still_open_at_provider: 0,
    by_competition: {},
    changes: [],
    conflicts: [],
    errors: [],
    details_note:
      "Project rule: API-Football may only update status/score on existing matches. Lineups, events and statistics stay Sofascore-owned and were not fetched.",
  };

  const finish = async (status: BackfillResult["status"], reason?: string) => {
    result.status = status;
    if (reason) result.reason = reason;
    await supabaseAdmin.from("job_runs").insert({
      job_name: "backfill-api-football",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status,
      result_metric: result.updated,
      result_detail: result as never,
      error: result.errors[0] ?? null,
    });
    return result;
  };

  if (!apiKey) return finish("failed", "API_FOOTBALL_KEY missing");

  const gate = async (): Promise<boolean> => {
    const { data: ok } = await supabaseAdmin.rpc("api_budget_take", {
      p_provider: PROVIDER,
      p_category: "bulk",
      p_count: 1,
    });
    return ok === true;
  };

  const call = async (path: string): Promise<{ status: number; json: AnyRec | null; headers: Headers } | null> => {
    if (result.calls_used >= maxCalls) return null;
    if (!(await gate())) {
      result.errors.push("budget_exhausted");
      return null;
    }
    result.calls_used += 1;
    const res = await fetch(`${HOST}${path}`, {
      headers: { "x-apisports-key": apiKey, accept: "application/json" },
    });
    const body = await res.text();
    let json: AnyRec | null = null;
    try {
      json = JSON.parse(body) as AnyRec;
    } catch {
      json = null;
    }
    if (res.status < 200 || res.status >= 300) {
      result.errors.push(`http ${res.status} on ${path.split("?")[0]}`);
    }
    return { status: res.status, json, headers: res.headers };
  };

  // ---------------------------------------------------------------- plan check
  const statusRes = await call("/status");
  if (!statusRes) return finish("failed", "status_call_blocked");
  for (const h of [
    "x-ratelimit-limit",
    "x-ratelimit-remaining",
    "x-ratelimit-requests-limit",
    "x-ratelimit-requests-remaining",
    "x-ratelimit-reset",
  ]) {
    const v = statusRes.headers.get(h);
    if (v) result.plan.rate_limit_headers[h] = v;
  }
  const reqs = statusRes.json?.["response"]?.["requests"] as AnyRec | undefined;
  const limitDay =
    (typeof reqs?.["limit_day"] === "number" ? (reqs["limit_day"] as number) : null) ??
    (Number(result.plan.rate_limit_headers["x-ratelimit-requests-limit"]) || null);
  result.plan.requests_limit_day = limitDay;
  result.plan.requests_current = typeof reqs?.["current"] === "number" ? (reqs["current"] as number) : null;
  if (statusRes.status !== 200) return finish("failed", "provider_status_not_ok");

  if (limitDay && limitDay > 0) {
    const reserve = Math.max(1, Math.round(limitDay * 0.05));
    const { error: qErr } = await supabaseAdmin.from("api_quotas").upsert(
      {
        provider: PROVIDER,
        daily_limit: limitDay,
        monthly_limit: null,
        per_minute_limit: null,
        live_reserve_daily: reserve,
        configured: true,
        notes: `PRO plan verified against provider /status on ${new Date().toISOString().slice(0, 10)}; daily_limit=${limitDay}, 5% reserve kept.`,
      } as never,
      { onConflict: "provider" },
    );
    if (qErr) result.errors.push(`quota_upsert: ${qErr.message}`);
    else {
      result.plan.quota_row_updated = true;
      result.plan.daily_limit_applied = limitDay;
      result.plan.reserve_applied = reserve;
    }
  }

  // ---------------------------------------------------------------- candidates
  const { data: rows, error: selErr } = await supabaseAdmin
    .from("matches")
    .select(
      "id, kickoff_at, status, home_score, away_score, competition_id, home_team_id, away_team_id",
    )
    .lt("kickoff_at", options.cutoffIso)
    .or("status.is.null,status.not.in.(finished,canceled,postponed,awarded,removed)")
    .order("kickoff_at", { ascending: true })
    .limit(500);
  if (selErr) return finish("failed", selErr.message);

  const candidates = rows ?? [];
  result.candidates = candidates.length;
  if (candidates.length === 0) return finish("success", "nothing_to_do");

  const teamIds = [
    ...new Set(candidates.flatMap((m) => [m.home_team_id, m.away_team_id]).filter(Boolean)),
  ] as string[];
  const compIds = [...new Set(candidates.map((m) => m.competition_id).filter(Boolean))] as string[];

  const [{ data: teams }, { data: comps }, { data: aliases }] = await Promise.all([
    supabaseAdmin.from("teams").select("id, name_en, name_he, short_name").in("id", teamIds),
    supabaseAdmin.from("competitions").select("id, name_he").in("id", compIds),
    supabaseAdmin.from("team_aliases").select("team_id, alias").in("team_id", teamIds),
  ]);

  const teamNames = new Map<string, string[][]>();
  for (const t of teams ?? []) {
    const forms = [t.name_en, t.short_name].filter(Boolean) as string[];
    teamNames.set(t.id, forms.map(normalizeName).filter((f) => f.length > 0));
  }
  for (const a of aliases ?? []) {
    const cur = teamNames.get(a.team_id) ?? [];
    const n = normalizeName(a.alias);
    if (n.length > 0) cur.push(n);
    teamNames.set(a.team_id, cur);
  }
  const compName = new Map((comps ?? []).map((c) => [c.id, c.name_he]));
  const teamLabel = new Map((teams ?? []).map((t) => [t.id, t.name_en ?? t.name_he ?? t.id]));

  for (const m of candidates) {
    const key = compName.get(m.competition_id ?? "") ?? "ללא תחרות";
    result.by_competition[key] ??= { before: 0, updated: 0 };
    result.by_competition[key]!.before += 1;
  }

  const bestScore = (teamId: string | null, providerName: string): number => {
    if (!teamId) return 0;
    const forms = teamNames.get(teamId) ?? [];
    const pn = normalizeName(providerName);
    let best = 0;
    for (const f of forms) best = Math.max(best, similarity(f, pn));
    return best;
  };

  // ---------------------------------------------------------------- by date
  const byDate = new Map<string, typeof candidates>();
  for (const m of candidates) {
    const d = String(m.kickoff_at).slice(0, 10);
    const list = byDate.get(d) ?? [];
    list.push(m);
    byDate.set(d, list);
  }

  for (const [day, list] of [...byDate.entries()].sort()) {
    if (result.calls_used >= maxCalls) break;
    const res = await call(`/fixtures?date=${day}&timezone=UTC`);
    if (!res) break;
    if (res.status !== 200 || !res.json) continue;
    result.dates_fetched += 1;
    const fixtures = (res.json["response"] as AnyRec[] | undefined) ?? [];

    for (const m of list) {
      const koMs = Date.parse(String(m.kickoff_at));
      let best: { fx: AnyRec; score: number } | null = null;
      let second = 0;
      let reversedBetter = false;

      for (const fx of fixtures) {
        const fxKo = Date.parse(String(fx["fixture"]?.["date"] ?? ""));
        if (!Number.isFinite(fxKo) || Math.abs(fxKo - koMs) > 3 * 3600_000) continue;
        const hName = String(fx["teams"]?.["home"]?.["name"] ?? "");
        const aName = String(fx["teams"]?.["away"]?.["name"] ?? "");
        const fwd = Math.min(bestScore(m.home_team_id, hName), bestScore(m.away_team_id, aName));
        const rev = Math.min(bestScore(m.home_team_id, aName), bestScore(m.away_team_id, hName));
        if (rev > fwd && rev >= 0.99) reversedBetter = true;
        if (fwd > (best?.score ?? 0)) {
          second = best?.score ?? 0;
          best = { fx, score: fwd };
        } else if (fwd > second) second = fwd;
      }

      const label = `${teamLabel.get(m.home_team_id ?? "") ?? "?"} - ${teamLabel.get(m.away_team_id ?? "") ?? "?"}`;
      if (!best || best.score < 0.99) {
        result.not_found += 1;
        // Diagnostic only: closest provider fixture anywhere that day, no time window.
        let diag: { name: string; score: number; when: string } | null = null;
        for (const fx of fixtures) {
          const hName = String(fx["teams"]?.["home"]?.["name"] ?? "");
          const aName = String(fx["teams"]?.["away"]?.["name"] ?? "");
          const s = Math.min(bestScore(m.home_team_id, hName), bestScore(m.away_team_id, aName));
          if (s > (diag?.score ?? 0)) {
            diag = { name: `${hName} - ${aName}`, score: Number(s.toFixed(2)), when: String(fx["fixture"]?.["date"] ?? "") };
          }
        }
        result.unmatched.push({
          match: label,
          kickoff: String(m.kickoff_at),
          competition: compName.get(m.competition_id ?? "") ?? "ללא תחרות",
          closest: diag?.name ?? null,
          closest_score: diag?.score ?? 0,
          closest_kickoff: diag?.when ?? null,
        });
        continue;
      }

      if (second >= 0.99 || reversedBetter) {
        result.ambiguous_flagged += 1;
        result.conflicts.push(`${label} @ ${String(m.kickoff_at).slice(0, 16)} — ambiguous/reversed candidate`);
        if (!options.dryRun) {
          await supabaseAdmin.from("matches").update({ needs_review: true } as never).eq("id", m.id);
        }
        continue;
      }

      result.matched += 1;
      const st = best.fx["fixture"]?.["status"] as AnyRec | undefined;
      const mapped = mapStatus(String(st?.["short"] ?? ""));
      if (!mapped) {
        result.conflicts.push(`${label} — unmapped provider status ${String(st?.["short"])}`);
        continue;
      }
      if (!mapped.final && mapped.status === "notstarted") {
        result.still_open_at_provider += 1;
        continue;
      }

      const goals = best.fx["goals"] as AnyRec | undefined;
      const hs = typeof goals?.["home"] === "number" ? (goals["home"] as number) : null;
      const as_ = typeof goals?.["away"] === "number" ? (goals["away"] as number) : null;
      const update: AnyRec = {
        status: mapped.status,
        live_source: LIVE_SOURCE,
        fetched_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (mapped.status === "finished" || mapped.status === "awarded" || mapped.live) {
        if (hs != null) update["home_score"] = hs;
        if (as_ != null) update["away_score"] = as_;
      }
      update["minute"] = mapped.live && typeof st?.["elapsed"] === "number" ? st["elapsed"] : null;
      if (mapped.status === "finished" && (hs == null || as_ == null)) {
        result.conflicts.push(`${label} — provider finished without a score, skipped`);
        continue;
      }
      if (mapped.live) result.still_open_at_provider += 1;

      if (m.status === mapped.status && m.home_score === hs && m.away_score === as_) {
        result.unchanged += 1;
        continue;
      }

      if (!options.dryRun) {
        const { error: upErr } = await supabaseAdmin
          .from("matches")
          .update(update as never)
          .eq("id", m.id)
          .or("status.is.null,status.not.in.(finished,canceled,postponed,awarded,removed)");
        if (upErr) {
          result.errors.push(`update ${m.id}: ${upErr.message}`);
          continue;
        }
      }
      result.updated += 1;
      const compKey = compName.get(m.competition_id ?? "") ?? "ללא תחרות";
      result.by_competition[compKey] ??= { before: 0, updated: 0 };
      result.by_competition[compKey]!.updated += 1;
      result.changes.push({
        match: label,
        kickoff: String(m.kickoff_at),
        competition: compKey,
        from: m.status ?? "null",
        to: mapped.status,
        score: hs != null && as_ != null ? `${hs}-${as_}` : null,
      });
    }
  }

  const blocked = result.errors.length > 0;
  return finish(blocked ? "partial" : "success");
}
