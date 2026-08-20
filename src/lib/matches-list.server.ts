import { supabaseAdmin } from "@/integrations/supabase/client.server";

const LOGO_BUCKET = "team-logos";
const LOGO_SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;
const DEFAULT_PAST_DAYS = 7;
const DEFAULT_FUTURE_DAYS = 30;
const DEFAULT_LIMIT = 600;
const MAX_LIMIT = 1000;

export type MatchesListInput = {
  from?: string;
  to?: string;
  competitionIds?: string[];
  limit?: number;
};

export type MatchListItem = {
  id: string;
  externalId: string | null;
  competitionId: string | null;
  competitionName: string | null;
  homeName: string;
  awayName: string;
  homeLogo: string | null;
  awayLogo: string | null;
  homeScore: number | null;
  awayScore: number | null;
  kickoffAt: string;
  status: string | null;
  source: string | null;
  timeConfirmed: boolean;
  venue: string | null;
  roundName: string | null;
  roundNumber: number | null;
  isQualifier: boolean;
  stage: string | null;
  leg: number | null;
  tieKey: string | null;
  seasonLabel: string | null;
  isCurrentSeason: boolean;
};

type TeamRow = { id: string; name_he: string | null; name_en: string | null; logo_url: string | null };

export async function getMatchesList(input: MatchesListInput = {}): Promise<MatchListItem[]> {
  const now = Date.now();
  const limit = Math.max(1, Math.min(Number(input.limit ?? DEFAULT_LIMIT), MAX_LIMIT));
  const singleCompetitionId =
    input.competitionIds && input.competitionIds.length === 1 ? input.competitionIds[0]! : null;
  // A single competition shows its whole season: no date bounds unless the
  // caller explicitly passed them.
  const boundless = singleCompetitionId !== null && !input.from && !input.to;
  const from = input.from ?? new Date(now - DEFAULT_PAST_DAYS * 86400000).toISOString();
  const to = input.to ?? new Date(now + DEFAULT_FUTURE_DAYS * 86400000).toISOString();

  // Season resolution for the single-competition path: prefer the current
  // season, fall back to the latest season that actually has matches.
  let forcedSeason: string | null = null;
  let forcedSeasonIsCurrent = true;
  if (singleCompetitionId) {
    const { data: comp } = await supabaseAdmin
      .from("competitions")
      .select("season_calc_method")
      .eq("id", singleCompetitionId)
      .maybeSingle();
    const { data: currentSeason } = await supabaseAdmin.rpc("compute_season", {
      kickoff: new Date().toISOString(),
      method: comp?.season_calc_method ?? "aug_may",
    });
    forcedSeason = (currentSeason as string | null) ?? null;

    if (forcedSeason) {
      const { count } = await supabaseAdmin
        .from("matches")
        .select("id", { count: "exact", head: true })
        .eq("competition_id", singleCompetitionId)
        .eq("season", forcedSeason);
      if (!count) {
        const { data: latest } = await supabaseAdmin
          .from("matches")
          .select("season")
          .eq("competition_id", singleCompetitionId)
          .not("season", "is", null)
          .order("season", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (latest?.season) {
          forcedSeason = latest.season;
          forcedSeasonIsCurrent = false;
        }
      }
    }
  }

  let query = supabaseAdmin
    .from("matches")
    .select(
      "id, external_id, competition_id, home_team_id, away_team_id, home_score, away_score, kickoff_at, status, source, season, time_confirmed, venue, round_name, round_number, is_qualifier, stage, leg, tie_key",
    )
    .not("home_team_id", "is", null)
    .not("away_team_id", "is", null)
    .not("kickoff_at", "is", null)
    .order("kickoff_at", { ascending: true })
    .limit(limit);

  if (!boundless) {
    query = query.gte("kickoff_at", from).lte("kickoff_at", to);
  }

  if (input.competitionIds && input.competitionIds.length > 0) {
    query = query.in("competition_id", input.competitionIds);
  }
  if (singleCompetitionId && forcedSeason) {
    query = query.eq("season", forcedSeason);
  }

  const { data: matches, error } = await query;
  if (error) throw new Error(error.message);
  if (!matches || matches.length === 0) return [];

  const teamIds = Array.from(
    new Set(matches.flatMap((m) => [m.home_team_id, m.away_team_id]).filter(Boolean) as string[]),
  );
  const competitionIds = Array.from(
    new Set(matches.map((m) => m.competition_id).filter(Boolean) as string[]),
  );

  const [teamsRes, compsRes] = await Promise.all([
    supabaseAdmin.from("teams").select("id, name_he, name_en, logo_url").in("id", teamIds),
    competitionIds.length
      ? supabaseAdmin
          .from("competitions")
          .select("id, name_he, name_en, season_calc_method")
          .in("id", competitionIds)
      : Promise.resolve({ data: [], error: null } as const),
  ]);

  if (teamsRes.error) throw new Error(teamsRes.error.message);
  if (compsRes.error) throw new Error(compsRes.error.message);

  const teamById = new Map<string, TeamRow>((teamsRes.data ?? []).map((t) => [t.id, t as TeamRow]));
  const compById = new Map<string, string>(
    (compsRes.data ?? []).map((c) => [c.id, (c.name_he || c.name_en) ?? ""]),
  );

  // Current season per season_calc_method, resolved by the database itself.
  const methods = Array.from(
    new Set((compsRes.data ?? []).map((c) => c.season_calc_method ?? "aug_may")),
  );
  const seasonByMethod = new Map<string, string | null>();
  for (const method of methods) {
    const { data: season } = await supabaseAdmin.rpc("compute_season", {
      kickoff: new Date().toISOString(),
      method,
    });
    seasonByMethod.set(method, (season as string | null) ?? null);
  }
  const currentSeasonByCompetition = new Map<string, string | null>(
    (compsRes.data ?? []).map((c) => [
      c.id,
      seasonByMethod.get(c.season_calc_method ?? "aug_may") ?? null,
    ]),
  );

  // The `team-logos` bucket is private: logo_url holds a storage path, so it is
  // signed at read time only. Rows already holding a full URL pass through.
  const logoPaths = Array.from(
    new Set(
      (teamsRes.data ?? [])
        .map((t) => t.logo_url)
        .filter((u): u is string => !!u && !/^https?:\/\//i.test(u)),
    ),
  );
  const signedByPath = new Map<string, string>();
  if (logoPaths.length > 0) {
    const { data: signed } = await supabaseAdmin.storage
      .from(LOGO_BUCKET)
      .createSignedUrls(logoPaths, LOGO_SIGNED_URL_TTL_SECONDS);
    for (const s of signed ?? []) {
      if (s.signedUrl && s.path) signedByPath.set(s.path, s.signedUrl);
    }
  }
  const logoUrl = (raw: string | null | undefined): string | null => {
    if (!raw) return null;
    if (/^https?:\/\//i.test(raw)) return raw;
    return signedByPath.get(raw) ?? null;
  };

  const items: MatchListItem[] = [];
  for (const m of matches) {
    const home = m.home_team_id ? teamById.get(m.home_team_id) : undefined;
    const away = m.away_team_id ? teamById.get(m.away_team_id) : undefined;
    const homeName = home?.name_he || home?.name_en;
    const awayName = away?.name_he || away?.name_en;
    // Golden rule: no real data -> not displayed.
    if (!homeName || !awayName || !m.kickoff_at) continue;

    // Only the resolved season of each competition is presented.
    const expectedSeason = singleCompetitionId
      ? forcedSeason
      : m.competition_id
        ? currentSeasonByCompetition.get(m.competition_id)
        : null;
    if (expectedSeason && m.season && m.season !== expectedSeason) continue;

    const currentSeason = m.competition_id
      ? (currentSeasonByCompetition.get(m.competition_id) ?? null)
      : null;
    const seasonLabel = m.season ?? expectedSeason ?? null;

    items.push({
      id: m.id,
      externalId: m.external_id,
      competitionId: m.competition_id,
      competitionName: m.competition_id ? (compById.get(m.competition_id) ?? null) : null,
      homeName,
      awayName,
      homeLogo: logoUrl(home?.logo_url),
      awayLogo: logoUrl(away?.logo_url),
      homeScore: m.home_score,
      awayScore: m.away_score,
      kickoffAt: m.kickoff_at,
      status: m.status,
      source: m.source,
      timeConfirmed: m.time_confirmed === true,
      venue: m.venue,
      roundName: m.round_name,
      roundNumber: m.round_number,
      isQualifier: m.is_qualifier === true,
      stage: m.stage,
      leg: m.leg,
      tieKey: m.tie_key,
      seasonLabel,
      isCurrentSeason: singleCompetitionId
        ? forcedSeasonIsCurrent
        : !seasonLabel || !currentSeason || seasonLabel === currentSeason,
    });
  }

  return items;
}
