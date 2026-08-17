import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SOURCE = "sofascore";
const PHOTO_BUCKET = "player-photos";
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

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

  const toPlayer = (r: (typeof rows)[number]): LineupPlayer => ({
    player_id: r.player_id,
    name: r.player_id ? (nameById.get(r.player_id) ?? null) : null,
    position: r.position,
    shirt_number: r.shirt_number,
    is_starting: r.is_starting,
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
