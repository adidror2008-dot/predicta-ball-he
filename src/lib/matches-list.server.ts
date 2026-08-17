import { supabaseAdmin } from "@/integrations/supabase/client.server";

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
};

type TeamRow = { id: string; name_he: string | null; name_en: string | null; logo_url: string | null };

export async function getMatchesList(): Promise<MatchListItem[]> {
  const { data: matches, error } = await supabaseAdmin
    .from("matches")
    .select(
      "id, external_id, competition_id, home_team_id, away_team_id, home_score, away_score, kickoff_at, status, source",
    )
    .not("home_team_id", "is", null)
    .not("away_team_id", "is", null)
    .not("kickoff_at", "is", null)
    .order("kickoff_at", { ascending: true })
    .limit(200);

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
      ? supabaseAdmin.from("competitions").select("id, name_he, name_en").in("id", competitionIds)
      : Promise.resolve({ data: [], error: null } as const),
  ]);

  if (teamsRes.error) throw new Error(teamsRes.error.message);
  if (compsRes.error) throw new Error(compsRes.error.message);

  const teamById = new Map<string, TeamRow>((teamsRes.data ?? []).map((t) => [t.id, t as TeamRow]));
  const compById = new Map<string, string>(
    (compsRes.data ?? []).map((c) => [c.id, (c.name_he || c.name_en) ?? ""]),
  );

  const items: MatchListItem[] = [];
  for (const m of matches) {
    const home = m.home_team_id ? teamById.get(m.home_team_id) : undefined;
    const away = m.away_team_id ? teamById.get(m.away_team_id) : undefined;
    const homeName = home?.name_he || home?.name_en;
    const awayName = away?.name_he || away?.name_en;
    // Golden rule: no real data -> not displayed.
    if (!homeName || !awayName || !m.kickoff_at) continue;

    items.push({
      id: m.id,
      externalId: m.external_id,
      competitionId: m.competition_id,
      competitionName: m.competition_id ? (compById.get(m.competition_id) ?? null) : null,
      homeName,
      awayName,
      homeLogo: home?.logo_url ?? null,
      awayLogo: away?.logo_url ?? null,
      homeScore: m.home_score,
      awayScore: m.away_score,
      kickoffAt: m.kickoff_at,
      status: m.status,
      source: m.source,
    });
  }

  return items;
}
