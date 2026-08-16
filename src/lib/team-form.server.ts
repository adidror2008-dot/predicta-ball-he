import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const RECENCY_MULTIPLIERS = [1.0, 0.7, 0.5] as const;
export const RECENCY_MULTIPLIER_TAIL = 0.35;

export type MatchTier = "friendly" | "weak_opponent" | "official";
export type SelectedVia = "same_competition" | "other_official" | "friendly_fill";

export const TIER_BASE_WEIGHT: Record<MatchTier, number> = {
  friendly: 0.2,
  weak_opponent: 0.5,
  official: 1.0,
};

export type TeamFormMatch = {
  external_id: string;
  played_at: string | null;
  is_home: boolean;
  goals_for: number | null;
  goals_against: number | null;
  result: string | null;
  competition_name: string | null;
  unique_tournament_id: string | null;
  match_tier: MatchTier;
  base_weight: number;
  recency_multiplier: number;
  final_weight: number;
  selected_via: SelectedVia;
  opponent_name: string | null;
  opponent_known: boolean;
};

export type TeamFormSummary = {
  total_selected: number;
  official_count: number;
  weak_opponent_count: number;
  friendly_count: number;
  total_weight: number;
  weighted_goals_for: number | null;
  weighted_goals_against: number | null;
  weighted_points: number | null;
};

export type TeamFormResult = {
  has_enough_data: boolean;
  low_confidence: boolean;
  confidence_reason: string | null;
  matches: TeamFormMatch[];
  summary: TeamFormSummary;
};

export type GetTeamFormInput = {
  teamExternalId: string;
  uniqueTournamentId?: string;
  source?: string;
  limit?: number;
};

const FRIENDLY_TOURNAMENT_ID = "853";

function recencyMultiplier(index: number): number {
  return RECENCY_MULTIPLIERS[index] ?? RECENCY_MULTIPLIER_TAIL;
}

function emptyResult(matches: TeamFormMatch[] = []): TeamFormResult {
  return {
    has_enough_data: false,
    low_confidence: false,
    confidence_reason: null,
    matches,
    summary: {
      total_selected: matches.length,
      official_count: 0,
      weak_opponent_count: 0,
      friendly_count: 0,
      total_weight: 0,
      weighted_goals_for: null,
      weighted_goals_against: null,
      weighted_points: null,
    },
  };
}

export async function getTeamForm(input: GetTeamFormInput): Promise<TeamFormResult> {
  const source = input.source ?? "sofascore";
  const limit = input.limit ?? 3;

  const { data: history, error: historyError } = await supabaseAdmin
    .from("team_history")
    .select(
      "external_id, played_at, is_home, goals_for, goals_against, result, competition_name, category_name, unique_tournament_id, opponent_external_id, opponent_name",
    )
    .eq("team_external_id", input.teamExternalId)
    .eq("source", source)
    .order("played_at", { ascending: false, nullsFirst: false });

  if (historyError || !history || history.length === 0) {
    return emptyResult();
  }

  const { data: teams } = await supabaseAdmin
    .from("teams")
    .select("external_id")
    .eq("source", "sofascore")
    .not("external_id", "is", null);

  const knownTeams = new Set((teams ?? []).map((t) => String(t.external_id)));

  type Row = (typeof history)[number];

  const classify = (row: Row): { tier: MatchTier; opponentKnown: boolean } => {
    const opponentKnown =
      row.opponent_external_id != null && knownTeams.has(String(row.opponent_external_id));
    const compName = (row.competition_name ?? "").toLowerCase();
    const isFriendly =
      row.unique_tournament_id === FRIENDLY_TOURNAMENT_ID || compName.includes("friendl");
    if (isFriendly) return { tier: "friendly", opponentKnown };
    if (row.category_name === "Israel" && !opponentKnown) {
      return { tier: "weak_opponent", opponentKnown };
    }
    return { tier: "official", opponentKnown };
  };

  const classified = history.map((row) => ({ row, ...classify(row) }));

  const selected: Array<{ row: Row; tier: MatchTier; opponentKnown: boolean; via: SelectedVia }> =
    [];
  const used = new Set<string>();

  const take = (
    predicate: (c: (typeof classified)[number]) => boolean,
    via: SelectedVia,
  ) => {
    for (const c of classified) {
      if (selected.length >= limit) return;
      const key = String(c.row.external_id);
      if (used.has(key)) continue;
      if (!predicate(c)) continue;
      used.add(key);
      selected.push({ row: c.row, tier: c.tier, opponentKnown: c.opponentKnown, via });
    }
  };

  if (input.uniqueTournamentId) {
    take(
      (c) =>
        c.row.unique_tournament_id === input.uniqueTournamentId && c.tier !== "friendly",
      "same_competition",
    );
  }
  take((c) => c.tier !== "friendly", "other_official");
  take((c) => c.tier === "friendly", "friendly_fill");

  if (selected.length === 0) return emptyResult();

  const matches: TeamFormMatch[] = selected.map((s, i) => {
    const baseWeight = TIER_BASE_WEIGHT[s.tier];
    const mult = recencyMultiplier(i);
    return {
      external_id: String(s.row.external_id),
      played_at: s.row.played_at,
      is_home: s.row.is_home,
      goals_for: s.row.goals_for,
      goals_against: s.row.goals_against,
      result: s.row.result,
      competition_name: s.row.competition_name,
      unique_tournament_id: s.row.unique_tournament_id,
      match_tier: s.tier,
      base_weight: baseWeight,
      recency_multiplier: mult,
      final_weight: baseWeight * mult,
      selected_via: s.via,
      opponent_name: s.row.opponent_name,
      opponent_known: s.opponentKnown,
    };
  });

  const totalWeight = matches.reduce((acc, m) => acc + m.final_weight, 0);
  const officialCount = matches.filter((m) => m.match_tier === "official").length;
  const weakCount = matches.filter((m) => m.match_tier === "weak_opponent").length;
  const friendlyCount = matches.filter((m) => m.match_tier === "friendly").length;

  let weightedGoalsFor: number | null = null;
  let weightedGoalsAgainst: number | null = null;
  let weightedPoints: number | null = null;

  if (totalWeight > 0) {
    let gf = 0;
    let ga = 0;
    let pts = 0;
    for (const m of matches) {
      gf += (m.goals_for ?? 0) * m.final_weight;
      ga += (m.goals_against ?? 0) * m.final_weight;
      const p = m.result === "W" ? 3 : m.result === "D" ? 1 : 0;
      pts += p * m.final_weight;
    }
    weightedGoalsFor = gf / totalWeight;
    weightedGoalsAgainst = ga / totalWeight;
    weightedPoints = pts / totalWeight;
  }

  const hasEnoughData = matches.length >= 3;
  let lowConfidence = false;
  let confidenceReason: string | null = null;

  if (hasEnoughData) {
    if (officialCount === 0) {
      lowConfidence = true;
      confidenceReason = "all_friendly";
    } else if (totalWeight < 1.0) {
      lowConfidence = true;
      confidenceReason = "low_total_weight";
    } else if (!matches.some((m) => m.selected_via === "same_competition")) {
      lowConfidence = true;
      confidenceReason = "no_same_competition";
    }
  }

  return {
    has_enough_data: hasEnoughData,
    low_confidence: lowConfidence,
    confidence_reason: confidenceReason,
    matches,
    summary: {
      total_selected: matches.length,
      official_count: officialCount,
      weak_opponent_count: weakCount,
      friendly_count: friendlyCount,
      total_weight: totalWeight,
      weighted_goals_for: weightedGoalsFor,
      weighted_goals_against: weightedGoalsAgainst,
      weighted_points: weightedPoints,
    },
  };
}
