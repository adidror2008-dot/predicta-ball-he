import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SOURCE = "sofascore";
const MODEL_VERSION = "v7.0";
const PHOTO_BUCKET = "player-photos";
const LOGO_BUCKET = "team-logos";
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export type MatchHeader = {
  id: string;
  externalId: string | null;
  status: string | null;
  isFinished: boolean;
  kickoffAt: string | null;
  venue: string | null;
  homeName: string | null;
  awayName: string | null;
  homeLogo: string | null;
  awayLogo: string | null;
  homeScore: number | null;
  awayScore: number | null;
};

export type PredictionFactor = {
  type: string;
  side: "home" | "away" | null;
  value: number | null;
};

export type MatchPrediction = {
  predictedHomeScore: number | null;
  predictedAwayScore: number | null;
  probHome: number | null;
  probDraw: number | null;
  probAway: number | null;
  probGoals01: number | null;
  probGoals23: number | null;
  probGoals4Plus: number | null;
  confidence: number | null;
  confidenceBand: string | null;
  factors: PredictionFactor[];
  reasons: string[];
  explanationHe: string | null;
  computedAt: string | null;
  nextUpdateAt: string | null;
};



export type IncidentRow = {
  type: string | null;
  minute: number | null;
  added_minute: number | null;
  team_id: string | null;
  side: "home" | "away" | null;
  player_id: string | null;
  player_name: string | null;
  related_player_name: string | null;
  detail: string | null;
  home_score: number | null;
  away_score: number | null;
};

export type LineupPlayer = {
  player_id: string | null;
  name: string | null;
  position: string | null;
  shirt_number: number | null;
  is_starting: boolean | null;
  rating: number | null;
  sort_order: number | null;
  photoUrl: string | null;
};

export type MatchLineupsResult = {
  homeTeam: LineupPlayer[];
  awayTeam: LineupPlayer[];
  formation: string | null;
  homeFormation: string | null;
  awayFormation: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Accepts either the internal matches.id (uuid) or the provider external_id.
async function resolveMatch(matchRef: string) {
  const base = () => supabaseAdmin.from("matches").select("id, home_team_id, away_team_id");

  if (UUID_RE.test(matchRef)) {
    const { data, error } = await base().eq("id", matchRef).maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data;
  }

  const { data, error } = await base()
    .eq("external_id", matchRef)
    .eq("source", SOURCE)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function getIncidents(matchExternalId: string): Promise<IncidentRow[]> {
  const match = await resolveMatch(matchExternalId);
  if (!match) return [];

  const { data, error } = await supabaseAdmin
    .from("events")
    .select(
      "type, minute, added_minute, team_id, player_id, related_player_id, detail, home_score, away_score",
    )
    .eq("match_id", match.id);
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const playerIds = [
    ...new Set(
      rows
        .flatMap((r) => [r.player_id, r.related_player_id])
        .filter((v): v is string => typeof v === "string"),
    ),
  ];

  const nameById = new Map<string, string | null>();
  if (playerIds.length > 0) {
    const { data: players, error: playersError } = await supabaseAdmin
      .from("players")
      .select("id, name_en, name_he")
      .in("id", playerIds);
    if (playersError) throw new Error(playersError.message);
    for (const p of players ?? []) nameById.set(p.id, p.name_en ?? p.name_he ?? null);
  }

  return rows
    .map((r) => ({
      type: r.type,
      minute: r.minute,
      added_minute: r.added_minute,
      team_id: r.team_id,
      side:
        r.team_id && r.team_id === match.home_team_id
          ? ("home" as const)
          : r.team_id && r.team_id === match.away_team_id
            ? ("away" as const)
            : null,
      player_id: r.player_id,
      player_name: r.player_id ? (nameById.get(r.player_id) ?? null) : null,
      related_player_name: r.related_player_id
        ? (nameById.get(r.related_player_id) ?? null)
        : null,
      detail: r.detail,
      home_score: r.home_score,
      away_score: r.away_score,
    }))
    .sort((a, b) => {
      const am = a.minute ?? Number.MAX_SAFE_INTEGER;
      const bm = b.minute ?? Number.MAX_SAFE_INTEGER;
      if (am !== bm) return am - bm;
      return (a.added_minute ?? 0) - (b.added_minute ?? 0);
    });
}

export async function getMatchLineups(
  matchExternalId: string,
): Promise<MatchLineupsResult> {
  const empty: MatchLineupsResult = {
    homeTeam: [],
    awayTeam: [],
    formation: null,
    homeFormation: null,
    awayFormation: null,
  };
  const match = await resolveMatch(matchExternalId);
  if (!match) return empty;

  const { data, error } = await supabaseAdmin
    .from("lineups")
    .select("team_id, player_id, position, shirt_number, is_starting, formation, sort_order")
    .eq("match_id", match.id);
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  if (rows.length === 0) return empty;

  const playerIds = [
    ...new Set(rows.map((r) => r.player_id).filter((v): v is string => typeof v === "string")),
  ];
  const nameById = new Map<string, string | null>();
  if (playerIds.length > 0) {
    const { data: players, error: playersError } = await supabaseAdmin
      .from("players")
      .select("id, name_en, name_he")
      .in("id", playerIds);
    if (playersError) throw new Error(playersError.message);
    for (const p of players ?? []) nameById.set(p.id, p.name_en ?? p.name_he ?? null);
  }

  const ratingById = new Map<string, number | null>();
  if (playerIds.length > 0) {
    const { data: ratings } = await supabaseAdmin
      .from("player_ratings")
      .select("player_id, rating")
      .eq("match_id", match.id)
      .in("player_id", playerIds);
    for (const r of ratings ?? []) {
      if (r.player_id) ratingById.set(r.player_id, r.rating === null ? null : Number(r.rating));
    }
  }

  const photoById = new Map<string, string | null>();
  if (playerIds.length > 0) {
    const { data: photoRows } = await supabaseAdmin
      .from("players")
      .select("id, photo_url")
      .in("id", playerIds)
      .not("photo_url", "is", null);
    const paths = (photoRows ?? [])
      .map((p) => p.photo_url)
      .filter((v): v is string => typeof v === "string" && !/^https?:\/\//i.test(v));
    if (paths.length > 0) {
      const { data: signed } = await supabaseAdmin.storage
        .from(PHOTO_BUCKET)
        .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
      const urlByPath = new Map<string, string>();
      for (const s of signed ?? []) {
        if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
      }
      for (const p of photoRows ?? []) {
        if (typeof p.photo_url !== "string") continue;
        photoById.set(
          p.id,
          /^https?:\/\//i.test(p.photo_url)
            ? p.photo_url
            : (urlByPath.get(p.photo_url) ?? null),
        );
      }
    } else {
      for (const p of photoRows ?? []) {
        if (typeof p.photo_url === "string") photoById.set(p.id, p.photo_url);
      }
    }
  }

  const toPlayer = (r: (typeof rows)[number]): LineupPlayer => ({
    player_id: r.player_id,
    name: r.player_id ? (nameById.get(r.player_id) ?? null) : null,
    position: r.position,
    shirt_number: r.shirt_number,
    is_starting: r.is_starting,
    rating: r.player_id ? (ratingById.get(r.player_id) ?? null) : null,
    sort_order: r.sort_order,
    photoUrl: r.player_id ? (photoById.get(r.player_id) ?? null) : null,
  });

  const bySide = (teamId: string | null) =>
    rows
      .filter((r) => r.team_id === teamId)
      .map(toPlayer)
      .sort((a, b) => {
        const ao = a.sort_order ?? Number.MAX_SAFE_INTEGER;
        const bo = b.sort_order ?? Number.MAX_SAFE_INTEGER;
        if (ao !== bo) return ao - bo;
        if (a.is_starting !== b.is_starting) return a.is_starting ? -1 : 1;
        return (a.shirt_number ?? 999) - (b.shirt_number ?? 999);
      });

  const formationOf = (teamId: string | null) =>
    rows.find((r) => r.team_id === teamId && r.formation != null)?.formation ?? null;

  const homeFormation = formationOf(match.home_team_id);
  const awayFormation = formationOf(match.away_team_id);

  return {
    homeTeam: bySide(match.home_team_id),
    awayTeam: bySide(match.away_team_id),
    formation: homeFormation ?? awayFormation,
    homeFormation,
    awayFormation,
  };
}

export async function getPlayerPhoto(playerExternalId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("player_photos")
    .select("storage_path")
    .eq("player_external_id", playerExternalId)
    .eq("source", SOURCE)
    .maybeSingle();
  if (error || !data?.storage_path) return null;

  const { data: signed, error: signError } = await supabaseAdmin.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(data.storage_path, SIGNED_URL_TTL_SECONDS);
  if (signError || !signed?.signedUrl) return null;
  return signed.signedUrl;
}

async function signLogo(raw: string | null | undefined): Promise<string | null> {
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  const { data } = await supabaseAdmin.storage
    .from(LOGO_BUCKET)
    .createSignedUrl(raw, SIGNED_URL_TTL_SECONDS);
  return data?.signedUrl ?? null;
}

export async function getMatchHeader(matchRef: string): Promise<MatchHeader | null> {
  const base = () =>
    supabaseAdmin
      .from("matches")
      .select(
        "id, external_id, status, kickoff_at, venue, home_team_id, away_team_id, home_score, away_score",
      );

  type MatchRow = {
    id: string;
    external_id: string | null;
    status: string | null;
    kickoff_at: string | null;
    venue: string | null;
    home_team_id: string | null;
    away_team_id: string | null;
    home_score: number | null;
    away_score: number | null;
  };
  let row: MatchRow | null = null;

  if (UUID_RE.test(matchRef)) {
    const { data } = await base().eq("id", matchRef).maybeSingle();
    row = data;
  }
  if (!row) {
    const { data } = await base().eq("external_id", matchRef).eq("source", SOURCE).maybeSingle();
    row = data;
  }
  if (!row) return null;

  const teamIds = [row.home_team_id, row.away_team_id].filter((v): v is string => !!v);
  const { data: teams } = teamIds.length
    ? await supabaseAdmin.from("teams").select("id, name_he, name_en, logo_url").in("id", teamIds)
    : { data: [] };

  const byId = new Map((teams ?? []).map((t) => [t.id, t]));
  const home = row.home_team_id ? byId.get(row.home_team_id) : undefined;
  const away = row.away_team_id ? byId.get(row.away_team_id) : undefined;

  const [homeLogo, awayLogo] = await Promise.all([
    signLogo(home?.logo_url),
    signLogo(away?.logo_url),
  ]);

  return {
    id: row.id,
    externalId: row.external_id,
    status: row.status,
    isFinished: row.status === "finished",
    kickoffAt: row.kickoff_at,
    venue: row.venue,
    homeName: home?.name_he || home?.name_en || null,
    awayName: away?.name_he || away?.name_en || null,
    homeLogo,
    awayLogo,
    homeScore: row.home_score,
    awayScore: row.away_score,
  };
}

export async function getMatchPrediction(matchRef: string): Promise<MatchPrediction | null> {
  const match = await resolveMatch(matchRef);
  if (!match) return null;

  const { data } = await supabaseAdmin
    .from("predictions")
    .select(
      "predicted_home_score, predicted_away_score, prob_home, prob_draw, prob_away, prob_goals_0_1, prob_goals_2_3, prob_goals_4_plus, confidence, confidence_band, factors, reason_lines_he, explanation_he, computed_at, next_update_at",
    )
    .eq("match_id", match.id)
    .eq("model_version", MODEL_VERSION)
    .maybeSingle();
  if (!data) return null;

  const reasons = Array.isArray(data.reason_lines_he)
    ? (data.reason_lines_he as unknown[]).filter((r): r is string => typeof r === "string")
    : [];

  const rawFactors = Array.isArray(data.factors) ? (data.factors as unknown[]) : [];
  const factors: PredictionFactor[] = rawFactors.flatMap((f) => {
    if (!f || typeof f !== "object") return [];
    const o = f as Record<string, unknown>;
    const type = typeof o["type"] === "string" ? (o["type"] as string) : null;
    if (!type) return [];
    const side = o["side"] === "home" || o["side"] === "away" ? (o["side"] as "home" | "away") : null;
    const value = o["value"] === null || o["value"] === undefined ? null : Number(o["value"]);
    return [{ type, side, value }];
  });

  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

  return {
    predictedHomeScore: data.predicted_home_score,
    predictedAwayScore: data.predicted_away_score,
    probHome: num(data.prob_home),
    probDraw: num(data.prob_draw),
    probAway: num(data.prob_away),
    probGoals01: num(data.prob_goals_0_1),
    probGoals23: num(data.prob_goals_2_3),
    probGoals4Plus: num(data.prob_goals_4_plus),
    confidence: num(data.confidence),
    confidenceBand: data.confidence_band ?? null,
    factors,
    reasons,
    explanationHe:
      typeof data.explanation_he === "string" && data.explanation_he.trim() !== ""
        ? data.explanation_he.trim()
        : null,
    computedAt: data.computed_at ?? null,
    nextUpdateAt: data.next_update_at ?? null,
  };
}

export type ModelAccuracy = {
  n: number;
  pctWinner: number | null;
  pctExact: number | null;
  pctGoalBucket: number | null;
  pctOu25: number | null;
  pctGoalsWithin1: number | null;
  avgRps: number | null;
  avgBrier: number | null;
  naivePctWinner: number | null;
  naivePctBucket: number | null;
  minSample: number;
};

export async function getModelAccuracy(): Promise<ModelAccuracy | null> {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

  const { data: cfg } = await supabaseAdmin
    .from("model_config")
    .select("value")
    .eq("key", "accuracy_min_sample")
    .maybeSingle();
  const minSample = cfg?.value === null || cfg?.value === undefined ? 30 : Number(cfg.value);

  const { data, error } = await supabaseAdmin
    .from("model_accuracy_summary" as never)
    .select("*")
    .eq("model_version", MODEL_VERSION)
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;

  const row = data as Record<string, unknown>;
  return {
    n: Number(row["n"] ?? 0),
    pctWinner: num(row["pct_winner"]),
    pctExact: num(row["pct_exact"]),
    pctGoalBucket: num(row["pct_goal_bucket"]),
    pctOu25: num(row["pct_ou25"]),
    pctGoalsWithin1: num(row["pct_goals_within_1"]),
    avgRps: num(row["avg_rps"]),
    avgBrier: num(row["avg_brier"]),
    naivePctWinner: num(row["naive_pct_winner"]),
    naivePctBucket: num(row["naive_pct_bucket"]),
    minSample,
  };
}


export type MatchStatRow = {
  key: string;
  label_he: string;
  home: number;
  away: number;
  is_percent: boolean;
};

export async function getMatchStats(matchRef: string): Promise<MatchStatRow[]> {
  const { STAT_DISPLAY, PERCENT_KEYS } = await import("@/lib/match-stats-keys");
  const match = await resolveMatch(matchRef);
  if (!match) return [];

  const { data, error } = await supabaseAdmin
    .from("match_stats")
    .select("team_id, stat_key, stat_value")
    .eq("match_id", match.id)
    .eq("period", "ALL");
  if (error) throw new Error(error.message);

  const homeByKey = new Map<string, number>();
  const awayByKey = new Map<string, number>();
  for (const r of data ?? []) {
    if (!r.stat_key || r.stat_value === null) continue;
    const value = Number(r.stat_value);
    if (!Number.isFinite(value)) continue;
    if (r.team_id === match.home_team_id) homeByKey.set(r.stat_key, value);
    else if (r.team_id === match.away_team_id) awayByKey.set(r.stat_key, value);
  }

  return STAT_DISPLAY.flatMap(({ key, labelHe }) => {
    const home = homeByKey.get(key);
    const away = awayByKey.get(key);
    if (home === undefined || away === undefined) return [];
    return [{ key, label_he: labelHe, home, away, is_percent: PERCENT_KEYS.has(key) }];
  });
}
