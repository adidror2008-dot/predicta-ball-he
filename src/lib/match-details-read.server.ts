import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SOURCE = "sofascore";
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

export type MatchPrediction = {
  predictedHomeScore: number | null;
  predictedAwayScore: number | null;
  probHome: number | null;
  probDraw: number | null;
  probAway: number | null;
  confidence: number | null;
  reasons: string[];
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
    .select("team_id, player_id, position, shirt_number, is_starting, formation")
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

  const toPlayer = (r: (typeof rows)[number]): LineupPlayer => ({
    player_id: r.player_id,
    name: r.player_id ? (nameById.get(r.player_id) ?? null) : null,
    position: r.position,
    shirt_number: r.shirt_number,
    is_starting: r.is_starting,
    rating: r.player_id ? (ratingById.get(r.player_id) ?? null) : null,
  });

  const bySide = (teamId: string | null) =>
    rows
      .filter((r) => r.team_id === teamId)
      .map(toPlayer)
      .sort((a, b) => {
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

  let row: Awaited<ReturnType<typeof base>>["data"] extends (infer T)[] | null ? T | null : never =
    null;

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
      "predicted_home_score, predicted_away_score, prob_home, prob_draw, prob_away, confidence, reasons_he",
    )
    .eq("match_id", match.id)
    .maybeSingle();
  if (!data) return null;

  const reasons = Array.isArray(data.reasons_he)
    ? (data.reasons_he as unknown[]).filter((r): r is string => typeof r === "string")
    : [];

  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

  return {
    predictedHomeScore: data.predicted_home_score,
    predictedAwayScore: data.predicted_away_score,
    probHome: num(data.prob_home),
    probDraw: num(data.prob_draw),
    probAway: num(data.prob_away),
    confidence: num(data.confidence),
    reasons,
  };
}
