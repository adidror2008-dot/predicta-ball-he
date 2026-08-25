// PredictaBall — step 6: run the prediction engine over upcoming matches
// and persist the results into public.predictions.
//
// Pure server-side logic, no createServerFn wrapper here so it can be invoked
// directly. No external API calls. No invented data: a team without Elo gets
// null, a match the engine refuses to predict is skipped, never guessed.

import { createClient } from "@supabase/supabase-js";
import {
  computePrediction,
  type HistoryMatch,
  type ModelConfig,
  type TournamentType,
} from "@/lib/prediction-engine";
import type { Database } from "@/integrations/supabase/types";

const DEFAULT_HOME_ADVANTAGE = 1.1;
const HISTORY_FALLBACK_LIMIT = 10;
const MS_PER_DAY = 86_400_000;
const CONCURRENCY = 8;
const MAX_ERROR_MESSAGES = 3;

export interface RunPredictionsSummary {
  candidates: number;
  written: number;
  skipped_null: number;
  errors: number;
  error_messages: string[];
  model_version: string;
}

interface TeamData {
  history: HistoryMatch[];
  elo: number | null;
  lastPlayedAt: string | null;
}

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

function normalizeTournamentType(value: string | null): TournamentType {
  return value === "official" || value === "friendly" || value === "youth" ? value : "unknown";
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length) as R[];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await fn(items[index] as T);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function runPredictions(): Promise<RunPredictionsSummary> {
  const supabaseUrl = process.env["SUPABASE_URL"];
  const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      `Missing required secret(s): ${[
        ...(supabaseUrl ? [] : ["SUPABASE_URL"]),
        ...(serviceKey ? [] : ["SUPABASE_SERVICE_ROLE_KEY"]),
      ].join(", ")}`,
    );
  }

  const supabase = createClient<Database>(supabaseUrl, serviceKey, {
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

  // (א) model_config → ModelConfig
  const { data: configRows, error: configError } = await supabase
    .from("model_config")
    .select("key, value, value_text");
  if (configError) throw new Error(`model_config read failed: ${configError.message}`);

  const cfgRecord: Record<string, number> = {};
  let modelVersion: string | null = null;
  for (const row of configRows ?? []) {
    if (row.key === "model_version") {
      modelVersion = row.value_text;
      continue;
    }
    if (row.value === null) continue;
    cfgRecord[snakeToCamel(row.key)] = Number(row.value);
  }
  if (!modelVersion) throw new Error("model_config is missing key 'model_version'");
  const cfg = cfgRecord as unknown as ModelConfig;
  const historyLimit = Number.isFinite(cfg.historyMaxMatches)
    ? cfg.historyMaxMatches
    : HISTORY_FALLBACK_LIMIT;

  // (ב) candidate matches — paginated, PostgREST caps a single response at 1000 rows
  const nowIso = new Date().toISOString();
  const matches: Array<{
    id: string;
    competition_id: string | null;
    home_team_id: string | null;
    away_team_id: string | null;
    kickoff_at: string | null;
  }> = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("matches")
      .select("id, competition_id, home_team_id, away_team_id, kickoff_at")
      .eq("status", "notstarted")
      .gt("kickoff_at", nowIso)
      .order("kickoff_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`matches read failed: ${error.message}`);
    matches.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  const usable = matches.filter(
    (m) => m.home_team_id && m.away_team_id && m.kickoff_at,
  );

  const teamIds = Array.from(
    new Set(usable.flatMap((m) => [m.home_team_id as string, m.away_team_id as string])),
  );

  // (ג)+(ד) one history + Elo load per team, kept in memory.
  // Chunked so neither the URL length nor the 1000-row response cap truncates it.
  const eloById = new Map<string, number | null>();
  const ID_CHUNK = 500;
  for (let i = 0; i < teamIds.length; i += ID_CHUNK) {
    const { data: teamRows, error: teamsError } = await supabase
      .from("teams")
      .select("id, elo_internal")
      .in("id", teamIds.slice(i, i + ID_CHUNK));
    if (teamsError) throw new Error(`teams read failed: ${teamsError.message}`);
    for (const t of teamRows ?? []) {
      eloById.set(t.id, t.elo_internal === null ? null : Number(t.elo_internal));
    }
  }

  const teamData = new Map<string, TeamData>();
  await mapLimit(teamIds, CONCURRENCY, async (teamId) => {
    const { data, error } = await supabase
      .from("team_match_history")
      .select("goals_for, goals_against, tournament_type, opponent_elo, played_at")
      .eq("team_id", teamId)
      .neq("tournament_type", "youth")
      .order("played_at", { ascending: false })
      .limit(historyLimit);
    if (error) throw new Error(`team_match_history read failed (${teamId}): ${error.message}`);
    const rows = data ?? [];
    teamData.set(teamId, {
      history: rows.map((r) => ({
        goalsFor: r.goals_for,
        goalsAgainst: r.goals_against,
        tournamentType: normalizeTournamentType(r.tournament_type),
        opponentElo: r.opponent_elo === null ? null : Number(r.opponent_elo),
      })),
      elo: eloById.get(teamId) ?? null,
      lastPlayedAt: rows[0]?.played_at ?? null,
    });
  });

  // (ה) competition baselines
  const { data: competitions, error: competitionsError } = await supabase
    .from("competitions")
    .select("id, avg_goals_home, avg_goals_away, avg_goals_measured, home_advantage");
  if (competitionsError) throw new Error(`competitions read failed: ${competitionsError.message}`);
  const competitionById = new Map(
    (competitions ?? []).map((c) => [
      c.id,
      {
        avgTotalGoals:
          c.avg_goals_measured && c.avg_goals_home !== null && c.avg_goals_away !== null
            ? Number(c.avg_goals_home) + Number(c.avg_goals_away)
            : null,
        homeAdvantage:
          c.home_advantage === null ? DEFAULT_HOME_ADVANTAGE : Number(c.home_advantage),
      },
    ]),
  );

  const candidateMatches = usable.filter((m) => {
    const home = teamData.get(m.home_team_id as string);
    const away = teamData.get(m.away_team_id as string);
    return (home?.history.length ?? 0) >= 3 && (away?.history.length ?? 0) >= 3;
  });

  let written = 0;
  let skippedNull = 0;
  let errors = 0;
  const errorMessages: string[] = [];

  const restDays = (lastPlayedAt: string | null, kickoff: string): number | null => {
    if (!lastPlayedAt) return null;
    const diff = new Date(kickoff).getTime() - new Date(lastPlayedAt).getTime();
    return Math.floor(diff / MS_PER_DAY);
  };

  for (const match of candidateMatches) {
    try {
      const home = teamData.get(match.home_team_id as string) as TeamData;
      const away = teamData.get(match.away_team_id as string) as TeamData;
      const competition = match.competition_id
        ? competitionById.get(match.competition_id)
        : undefined;
      const kickoff = match.kickoff_at as string;

      const result = computePrediction(
        home.history,
        away.history,
        home.elo,
        away.elo,
        {
          avgTotalGoals: competition?.avgTotalGoals ?? null,
          homeAdvantage: competition?.homeAdvantage ?? DEFAULT_HOME_ADVANTAGE,
        },
        restDays(home.lastPlayedAt, kickoff),
        restDays(away.lastPlayedAt, kickoff),
        cfg,
      );

      if (result === null) {
        skippedNull++;
        continue;
      }

      const computedAt = new Date();
      const { error } = await supabase.from("predictions").upsert(
        {
          match_id: match.id,
          model_version: modelVersion,
          lambda_home: result.lambdaHome,
          lambda_away: result.lambdaAway,
          predicted_home_score: result.predictedHomeScore,
          predicted_away_score: result.predictedAwayScore,
          prob_home: result.probHome,
          prob_draw: result.probDraw,
          prob_away: result.probAway,
          expected_total_goals: result.expectedTotalGoals,
          prob_over_2_5: result.probOver25,
          prob_under_2_5: result.probUnder25,
          prob_btts: result.probBtts,
          prob_goals_0_1: result.probGoals0_1,
          prob_goals_2_3: result.probGoals2_3,
          prob_goals_4_plus: result.probGoals4Plus,
          predicted_goal_bucket: result.predictedGoalBucket,
          confidence: result.confidence,
          confidence_band: result.confidenceBand,
          factors: result.factors,
          n_eff_home: result.nEffHome,
          n_eff_away: result.nEffAway,
          history_matches_home: result.historyMatchesHome,
          history_matches_away: result.historyMatchesAway,
          estimated_share: result.estimatedShare,
          computed_at: computedAt.toISOString(),
          next_update_at: new Date(computedAt.getTime() + 24 * 60 * 60 * 1000).toISOString(),
        },
        { onConflict: "match_id,model_version" },
      );
      if (error) throw new Error(error.message);
      written++;
    } catch (e) {
      errors++;
      if (errorMessages.length < MAX_ERROR_MESSAGES) {
        errorMessages.push(`${match.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // Phrase the Hebrew explanation for freshly written predictions (AI quota-gated,
  // best effort — a phrasing failure never fails the prediction run).
  if (written > 0) {
    try {
      const { runPredictionNarratives } = await import("@/lib/prediction-narrative.server");
      await runPredictionNarratives({ limit: 100 });
    } catch {
      // reported in job_runs by the narrative job itself
    }
  }

  return {
    candidates: candidateMatches.length,
    written,
    skipped_null: skippedNull,
    errors,
    error_messages: errorMessages,
    model_version: modelVersion,
  };
}

