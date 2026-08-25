// PredictaBall — one-off ClubElo ingest (runs from the deployed runtime, not the build sandbox).
//
// ClubElo is a free public source with no key and no quota, so it is NOT
// routed through api_budget_take (that gate guards the paid sofascore/AI
// providers). Every step writes a job_runs row with a real metric.

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const BASE = "http://api.clubelo.com";
const FETCH_TIMEOUT_MS = 20_000;
const CHUNK = 500;

type Supa = ReturnType<typeof buildClient>;

function buildClient() {
  const supabaseUrl = process.env["SUPABASE_URL"];
  const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing required secret(s): SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient<Database>(supabaseUrl, serviceKey, {
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (headers.get("Authorization") === `Bearer ${serviceKey}`) headers.delete("Authorization");
        headers.set("apikey", serviceKey);
        return fetch(input, { ...init, headers });
      },
    },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

async function fetchText(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: "text/csv,*/*" } });
    if (!res.ok) throw new Error(`ClubElo HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCsv(path: string): Promise<string[][]> {
  let lastError: unknown;
  for (const base of [BASE, BASE_HTTP]) {
    try {
      const text = await fetchText(`${base}${path}`);
      return text
        .trim()
        .split("\n")
        .map((line) => line.trim().split(","));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Connectivity probe — reports the exact outcome per protocol, no writes. */
export async function runClubEloProbe(): Promise<Record<string, string>> {
  const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const out: Record<string, string> = {};
  for (const url of [`${BASE}/${day}`, `${BASE_HTTP}/${day}`, "https://example.com"]) {
    try {
      const text = await fetchText(url, 15_000);
      out[url] = `ok ${text.length} bytes`;
    } catch (error) {
      out[url] = error instanceof Error ? error.message : String(error);
    }
  }
  return out;
}


async function logJob(
  supabase: Supa,
  jobName: string,
  startedAt: number,
  status: string,
  metric: number,
  detail: Record<string, unknown>,
) {
  await supabase.from("job_runs").insert({
    job_name: jobName,
    started_at: new Date(startedAt).toISOString(),
    finished_at: new Date().toISOString(),
    status,
    result_metric: metric,
    result_detail: detail as never,
  });
}

/** ---------- step 1: snapshot of every currently rated club ---------- */

export interface SnapshotResult {
  status: string;
  snapshot_date: string;
  clubs: number;
  israeli_clubs: number;
  israeli_sample: string[];
  error?: string;
}

export async function runClubEloSnapshot(): Promise<SnapshotResult> {
  const startedAt = Date.now();
  const supabase = buildClient();
  const d = new Date(Date.now() - 86_400_000);
  const snapshotDate = d.toISOString().slice(0, 10);

  let rows: string[][];
  try {
    rows = await fetchCsv(`${BASE}/${snapshotDate}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logJob(supabase, "clubelo_snapshot", startedAt, "error", 0, { error: message });
    return {
      status: "error",
      snapshot_date: snapshotDate,
      clubs: 0,
      israeli_clubs: 0,
      israeli_sample: [],
      error: `ClubElo unreachable from runtime: ${message}`,
    };
  }

  const header = (rows[0] ?? []).map((h) => h.toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const iRank = idx("rank");
  const iClub = idx("club");
  const iCountry = idx("country");
  const iLevel = idx("level");
  const iElo = idx("elo");

  const records = rows.slice(1).flatMap((cols) => {
    const club = cols[iClub];
    if (!club) return [];
    const rankRaw = iRank >= 0 ? cols[iRank] : undefined;
    const rank = rankRaw && /^\d+$/.test(rankRaw) ? Number(rankRaw) : null;
    return [
      {
        club,
        country: iCountry >= 0 ? (cols[iCountry] ?? null) : null,
        level: iLevel >= 0 && cols[iLevel] ? Number(cols[iLevel]) : null,
        elo: iElo >= 0 && cols[iElo] ? Number(cols[iElo]) : null,
        rank,
        snapshot_date: snapshotDate,
      },
    ];
  });

  for (let i = 0; i < records.length; i += CHUNK) {
    const { error } = await supabase
      .from("clubelo_current")
      .upsert(records.slice(i, i + CHUNK), { onConflict: "club,snapshot_date" });
    if (error) throw new Error(`clubelo_current upsert failed: ${error.message}`);
  }

  const israeli = records.filter((r) => r.country === "ISR");
  await logJob(supabase, "clubelo_snapshot", startedAt, "success", records.length, {
    snapshot_date: snapshotDate,
    clubs: records.length,
    israeli_clubs: israeli.length,
  });

  return {
    status: "success",
    snapshot_date: snapshotDate,
    clubs: records.length,
    israeli_clubs: israeli.length,
    israeli_sample: israeli.slice(0, 20).map((r) => r.club),
  };
}

/** ---------- step 2: name matching into team_aliases ---------- */

const MANUAL_SEEDS: Record<string, string> = {
  "Bodoe Glimt": "Bodø/Glimt",
  Salzburg: "Red Bull Salzburg",
  Lyon: "Olympique Lyonnais",
  "Sparta Praha": "AC Sparta Praha",
  Paphos: "Pafos FC",
};

const STOP_WORDS = new Set(["fc", "ac", "sc", "cf", "afc", "cd", "ud", "if", "bk", "fk", "club", "de", "the"]);

export function normalizeName(raw: string): string {
  const noDiacritics = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ø/gi, "o")
    .replace(/ß/g, "ss")
    .replace(/æ/gi, "ae")
    .replace(/đ/gi, "d");
  const words = noDiacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w));
  return words.join("");
}

export interface MatchResult {
  status: string;
  our_teams: number;
  clubelo_clubs: number;
  matched: number;
  matched_exact: number;
  matched_fuzzy: number;
  matched_manual: number;
  israeli_teams: number;
  israeli_matched: number;
  israeli_unmatched: string[];
  israeli_coverage_pct: number;
}

export async function runClubEloMatch(): Promise<MatchResult> {
  const startedAt = Date.now();
  const supabase = buildClient();

  const { data: latest, error: latestError } = await supabase
    .from("clubelo_current")
    .select("snapshot_date")
    .order("snapshot_date", { ascending: false })
    .limit(1);
  if (latestError) throw new Error(`clubelo_current read failed: ${latestError.message}`);
  const snapshotDate = latest?.[0]?.snapshot_date;
  if (!snapshotDate) throw new Error("clubelo_current is empty — run the snapshot step first");

  const { data: clubs, error: clubsError } = await supabase
    .from("clubelo_current")
    .select("club, country")
    .eq("snapshot_date", snapshotDate);
  if (clubsError) throw new Error(`clubelo_current read failed: ${clubsError.message}`);

  const byNorm = new Map<string, string>();
  for (const c of clubs ?? []) {
    const key = normalizeName(c.club);
    if (!byNorm.has(key)) byNorm.set(key, c.club);
  }

  const teams: Array<{ id: string; name_en: string | null; name_he: string | null; country: string | null }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("teams")
      .select("id, name_en, name_he, country")
      .range(from, from + 999);
    if (error) throw new Error(`teams read failed: ${error.message}`);
    teams.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const { data: existingAliases } = await supabase
    .from("team_aliases")
    .select("team_id, alias")
    .eq("source", "clubelo");
  const alreadyMatched = new Set((existingAliases ?? []).map((a) => a.team_id));

  const inserts: Array<{ team_id: string; alias: string; source: string }> = [];
  let exact = 0;
  let fuzzy = 0;
  let manual = 0;
  const matchedTeamIds = new Set<string>(alreadyMatched);

  for (const team of teams) {
    const ourName = team.name_en;
    if (!ourName) continue;
    if (matchedTeamIds.has(team.id)) continue;

    let clubeloName: string | null = null;
    let kind: "exact" | "fuzzy" | "manual" | null = null;

    // manual seeds are keyed by the ClubElo name → our name
    for (const [ceName, ourSeed] of Object.entries(MANUAL_SEEDS)) {
      if (ourSeed.toLowerCase() === ourName.toLowerCase() && byNorm.has(normalizeName(ceName))) {
        clubeloName = byNorm.get(normalizeName(ceName)) as string;
        kind = "manual";
        break;
      }
    }

    if (!clubeloName) {
      const directHit = (clubs ?? []).find((c) => c.club.toLowerCase() === ourName.toLowerCase());
      if (directHit) {
        clubeloName = directHit.club;
        kind = "exact";
      }
    }

    if (!clubeloName) {
      const hit = byNorm.get(normalizeName(ourName));
      if (hit) {
        clubeloName = hit;
        kind = "fuzzy";
      }
    }

    if (!clubeloName || !kind) continue;
    inserts.push({ team_id: team.id, alias: clubeloName, source: "clubelo" });
    matchedTeamIds.add(team.id);
    if (kind === "exact") exact++;
    else if (kind === "fuzzy") fuzzy++;
    else manual++;
  }

  for (let i = 0; i < inserts.length; i += CHUNK) {
    const { error } = await supabase.from("team_aliases").insert(inserts.slice(i, i + CHUNK));
    if (error) throw new Error(`team_aliases insert failed: ${error.message}`);
  }

  const israeliTeams = teams.filter((t) => t.country === "Israel" || t.country === "ISR");
  const israeliMatched = israeliTeams.filter((t) => matchedTeamIds.has(t.id));
  const israeliUnmatched = israeliTeams
    .filter((t) => !matchedTeamIds.has(t.id))
    .map((t) => t.name_en ?? t.name_he ?? t.id);

  const result: MatchResult = {
    status: "success",
    our_teams: teams.length,
    clubelo_clubs: clubs?.length ?? 0,
    matched: matchedTeamIds.size,
    matched_exact: exact,
    matched_fuzzy: fuzzy,
    matched_manual: manual,
    israeli_teams: israeliTeams.length,
    israeli_matched: israeliMatched.length,
    israeli_unmatched: israeliUnmatched.slice(0, 40),
    israeli_coverage_pct:
      israeliTeams.length === 0 ? 0 : Math.round((israeliMatched.length / israeliTeams.length) * 1000) / 10,
  };

  await logJob(supabase, "clubelo_match", startedAt, "success", matchedTeamIds.size, {
    ...result,
    israeli_unmatched: undefined,
  });
  return result;
}

/** ---------- step 3: per-club rating history ---------- */

export interface HistoryResult {
  status: string;
  clubs_requested: number;
  clubs_fetched: number;
  clubs_failed: number;
  rows_inserted: number;
  failures: string[];
}

export async function runClubEloHistory(input: { limit?: number } = {}): Promise<HistoryResult> {
  const startedAt = Date.now();
  const supabase = buildClient();
  const limit = input.limit ?? 300;

  const { data: aliases, error: aliasError } = await supabase
    .from("team_aliases")
    .select("alias")
    .eq("source", "clubelo");
  if (aliasError) throw new Error(`team_aliases read failed: ${aliasError.message}`);

  const { data: haveRows } = await supabase.from("clubelo_history").select("club");
  const have = new Set((haveRows ?? []).map((r) => r.club));

  const clubs = Array.from(new Set((aliases ?? []).map((a) => a.alias))).filter((c) => !have.has(c));
  const target = clubs.slice(0, limit);

  let fetched = 0;
  let inserted = 0;
  const failures: string[] = [];

  for (const club of target) {
    let rows: string[][];
    try {
      rows = await fetchCsv(`${BASE}/${encodeURIComponent(club)}`);
    } catch (error) {
      failures.push(`${club}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const header = (rows[0] ?? []).map((h) => h.toLowerCase());
    const iClub = header.indexOf("club");
    const iCountry = header.indexOf("country");
    const iLevel = header.indexOf("level");
    const iElo = header.indexOf("elo");
    const iFrom = header.indexOf("from");
    const iTo = header.indexOf("to");
    if (iElo < 0 || iFrom < 0 || iTo < 0) {
      failures.push(`${club}: unexpected CSV header`);
      continue;
    }

    const records = rows.slice(1).flatMap((cols) => {
      const elo = cols[iElo];
      const from = cols[iFrom];
      const to = cols[iTo];
      if (!elo || !from || !to || Number.isNaN(Number(elo))) return [];
      return [
        {
          club: iClub >= 0 ? (cols[iClub] ?? club) : club,
          country: iCountry >= 0 ? (cols[iCountry] ?? null) : null,
          level: iLevel >= 0 && cols[iLevel] ? Number(cols[iLevel]) : null,
          elo: Number(elo),
          valid_from: from,
          valid_to: to,
        },
      ];
    });

    for (let i = 0; i < records.length; i += CHUNK) {
      const { error } = await supabase
        .from("clubelo_history")
        .upsert(records.slice(i, i + CHUNK), { onConflict: "club,valid_from" });
      if (error) {
        failures.push(`${club}: insert ${error.message}`);
        break;
      }
      inserted += Math.min(CHUNK, records.length - i);
    }
    fetched++;
  }

  const result: HistoryResult = {
    status: failures.length === 0 ? "success" : "partial",
    clubs_requested: target.length,
    clubs_fetched: fetched,
    clubs_failed: failures.length,
    rows_inserted: inserted,
    failures: failures.slice(0, 20),
  };
  await logJob(supabase, "clubelo_history", startedAt, result.status, inserted, {
    ...result,
    failures: failures.length,
  });
  return result;
}
