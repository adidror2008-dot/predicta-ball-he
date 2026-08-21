import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendPush, type PushPayload, type PushSubscriptionRow } from "@/lib/push.server";

/** status.type values that mean the match will not change any more. */
const FINAL_STATUS_TYPES = ["finished", "canceled", "postponed", "awarded", "removed"];

function isLiveStatus(status: string | null): boolean {
  if (!status) return false;
  if (status === "notstarted") return false;
  return !FINAL_STATUS_TYPES.includes(status);
}

export type MatchSnapshot = {
  match_id: string;
  external_id: string;
  competition_id: string | null;
  status: string | null;
  prev_status: string | null;
  home_score: number | null;
  away_score: number | null;
  prev_home_score: number | null;
  prev_away_score: number | null;
};

export type NotificationsResult = {
  candidate_matches: number;
  followed_matches: number;
  lineup_sent: number;
  kickoff_sent: number;
  goal_sent: number;
  notifications_sent: number;
  pushes_delivered: number;
  subscriptions_removed: number;
  scorer_lookups: number;
  errors: string[];
};

type PrefRow = {
  user_id: string;
  notifications_enabled: boolean | null;
  notify_lineups: boolean | null;
  notify_kickoff: boolean | null;
  notify_goals: boolean | null;
};

const emptyResult = (): NotificationsResult => ({
  candidate_matches: 0,
  followed_matches: 0,
  lineup_sent: 0,
  kickoff_sent: 0,
  goal_sent: 0,
  notifications_sent: 0,
  pushes_delivered: 0,
  subscriptions_removed: 0,
  scorer_lookups: 0,
  errors: [],
});

/**
 * Notification engine. Runs inside the existing tick — never adds live API calls.
 * The only outgoing call it may make is a single incidents fetch per goal, and only
 * when the 'bulk' budget gate allows it (the incidents fetcher owns that gate).
 */
export async function runNotifications(
  snapshots: MatchSnapshot[],
): Promise<NotificationsResult> {
  const result = emptyResult();
  result.candidate_matches = snapshots.length;
  if (snapshots.length === 0) return result;

  const matchIds = snapshots.map((s) => s.match_id);
  const competitionIds = [
    ...new Set(snapshots.map((s) => s.competition_id).filter((c): c is string => !!c)),
  ];

  // ---- recipients: direct match follows + competition follows
  const followersByMatch = new Map<string, Set<string>>();
  const addFollower = (matchId: string, userId: string) => {
    const set = followersByMatch.get(matchId) ?? new Set<string>();
    set.add(userId);
    followersByMatch.set(matchId, set);
  };

  const { data: matchFollows, error: mfError } = await supabaseAdmin
    .from("match_follows")
    .select("user_id, match_id")
    .in("match_id", matchIds);
  if (mfError) result.errors.push(`match_follows: ${mfError.message}`);
  for (const row of matchFollows ?? []) addFollower(row.match_id, row.user_id);

  if (competitionIds.length > 0) {
    const { data: compFollows, error: cfError } = await supabaseAdmin
      .from("competition_follows")
      .select("user_id, competition_id")
      .in("competition_id", competitionIds);
    if (cfError) result.errors.push(`competition_follows: ${cfError.message}`);
    const byCompetition = new Map<string, string[]>();
    for (const row of compFollows ?? []) {
      const list = byCompetition.get(row.competition_id) ?? [];
      list.push(row.user_id);
      byCompetition.set(row.competition_id, list);
    }
    for (const s of snapshots) {
      if (!s.competition_id) continue;
      for (const userId of byCompetition.get(s.competition_id) ?? []) {
        addFollower(s.match_id, userId);
      }
    }
  }

  const followed = snapshots.filter((s) => (followersByMatch.get(s.match_id)?.size ?? 0) > 0);
  result.followed_matches = followed.length;
  if (followed.length === 0) return result;

  const userIds = [...new Set([...followersByMatch.values()].flatMap((s) => [...s]))];

  // ---- preferences (a missing row means the user never opted in)
  const { data: prefRows, error: prefError } = await supabaseAdmin
    .from("user_preferences")
    .select("user_id, notifications_enabled, notify_lineups, notify_kickoff, notify_goals")
    .in("user_id", userIds);
  if (prefError) result.errors.push(`user_preferences: ${prefError.message}`);
  const prefs = new Map<string, PrefRow>();
  for (const row of (prefRows ?? []) as PrefRow[]) prefs.set(row.user_id, row);

  const allows = (userId: string, kind: "lineup" | "kickoff" | "goal"): boolean => {
    const p = prefs.get(userId);
    if (!p || p.notifications_enabled !== true) return false;
    if (kind === "lineup") return p.notify_lineups !== false;
    if (kind === "kickoff") return p.notify_kickoff !== false;
    return p.notify_goals !== false;
  };

  // ---- push subscriptions
  const { data: subRows, error: subError } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .in("user_id", userIds);
  if (subError) result.errors.push(`push_subscriptions: ${subError.message}`);
  const subsByUser = new Map<string, PushSubscriptionRow[]>();
  for (const row of subRows ?? []) {
    const list = subsByUser.get(row.user_id) ?? [];
    list.push({ id: row.id, endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth });
    subsByUser.set(row.user_id, list);
  }

  // ---- dedup ledger
  const sentKeys = new Set<string>();
  const { data: sentRows, error: sentError } = await supabaseAdmin
    .from("notifications_sent")
    .select("user_id, match_id, kind")
    .in("match_id", matchIds);
  if (sentError) result.errors.push(`notifications_sent: ${sentError.message}`);
  for (const row of sentRows ?? []) sentKeys.add(`${row.user_id}|${row.match_id}|${row.kind}`);

  // ---- team names for message text
  const teamIds = new Set<string>();
  const { data: matchRows, error: matchError } = await supabaseAdmin
    .from("matches")
    .select("id, home_team_id, away_team_id, kickoff_at")
    .in("id", matchIds);
  if (matchError) result.errors.push(`matches: ${matchError.message}`);
  const matchTeams = new Map<string, { home: string | null; away: string | null; kickoff: string | null }>();
  for (const row of matchRows ?? []) {
    matchTeams.set(row.id, { home: row.home_team_id, away: row.away_team_id, kickoff: row.kickoff_at });
    if (row.home_team_id) teamIds.add(row.home_team_id);
    if (row.away_team_id) teamIds.add(row.away_team_id);
  }
  const teamNames = new Map<string, string>();
  if (teamIds.size > 0) {
    const { data: teams } = await supabaseAdmin
      .from("teams")
      .select("id, name_he, name_en, short_name")
      .in("id", [...teamIds]);
    for (const t of teams ?? []) {
      teamNames.set(
        t.id,
        (t.name_he?.trim() || t.short_name?.trim() || t.name_en?.trim() || "קבוצה") as string,
      );
    }
  }
  const nameOf = (teamId: string | null | undefined) =>
    teamId ? (teamNames.get(teamId) ?? "קבוצה") : "קבוצה";
  const titleOf = (matchId: string) => {
    const t = matchTeams.get(matchId);
    return `${nameOf(t?.home)} מול ${nameOf(t?.away)}`;
  };

  // ---- lineups published
  const lineupMatchIds = new Set<string>();
  {
    const { data: lineupRows } = await supabaseAdmin
      .from("lineups")
      .select("match_id")
      .in("match_id", matchIds);
    for (const row of lineupRows ?? []) lineupMatchIds.add(row.match_id);
  }

  const deliver = async (
    userId: string,
    matchId: string,
    kind: string,
    payload: PushPayload,
  ): Promise<boolean> => {
    const subs = subsByUser.get(userId) ?? [];
    if (subs.length === 0) return false;
    let delivered = 0;
    for (const sub of subs) {
      const r = await sendPush(sub, payload);
      if (r.removed) result.subscriptions_removed += 1;
      if (r.ok) delivered += 1;
      if (r.error && !r.removed) result.errors.push(`push ${userId}: ${r.error}`);
    }
    result.pushes_delivered += delivered;
    const { error } = await supabaseAdmin
      .from("notifications_sent")
      .insert({ user_id: userId, match_id: matchId, kind });
    if (error) result.errors.push(`notifications_sent insert: ${error.message}`);
    sentKeys.add(`${userId}|${matchId}|${kind}`);
    return delivered > 0;
  };

  // =========== a) lineups ===========
  for (const s of followed) {
    if (!lineupMatchIds.has(s.match_id)) continue;
    for (const userId of followersByMatch.get(s.match_id) ?? []) {
      if (sentKeys.has(`${userId}|${s.match_id}|lineups`)) continue;
      if (!allows(userId, "lineup")) continue;
      await deliver(userId, s.match_id, "lineups", {
        title: "פורסם הרכב רשמי",
        body: titleOf(s.match_id),
        url: `/match/${s.match_id}`,
        tag: `lineup-${s.match_id}`,
      });
      result.lineup_sent += 1;
      result.notifications_sent += 1;
    }
  }

  // =========== b) kickoff (grouped per user) ===========
  const kickoffByUser = new Map<string, string[]>();
  const kickoffSlot = (matchId: string) => matchTeams.get(matchId)?.kickoff ?? "unknown";
  for (const s of followed) {
    const started = isLiveStatus(s.status) && !isLiveStatus(s.prev_status);
    if (!started) continue;
    for (const userId of followersByMatch.get(s.match_id) ?? []) {
      if (sentKeys.has(`${userId}|${s.match_id}|kickoff`)) continue;
      if (!allows(userId, "kickoff")) continue;
      const key = `${userId}|${kickoffSlot(s.match_id)}`;
      const list = kickoffByUser.get(key) ?? [];
      list.push(s.match_id);
      kickoffByUser.set(key, list);
    }
  }

  for (const [groupKey, ids] of kickoffByUser) {
    const userId = groupKey.split("|")[0] as string;
    const subs = subsByUser.get(userId) ?? [];
    const payload: PushPayload =
      ids.length >= 2
        ? {
            title: `${ids.length} משחקים התחילו`,
            body: ids.map((id) => titleOf(id)).join(" · "),
            url: "/",
            tag: "kickoff-group",
          }
        : {
            title: "שריקת פתיחה",
            body: titleOf(ids[0] as string),
            url: `/match/${ids[0]}`,
            tag: `kickoff-${ids[0]}`,
          };

    let delivered = 0;
    for (const sub of subs) {
      const r = await sendPush(sub, payload);
      if (r.removed) result.subscriptions_removed += 1;
      if (r.ok) delivered += 1;
      if (r.error && !r.removed) result.errors.push(`push ${userId}: ${r.error}`);
    }
    result.pushes_delivered += delivered;

    for (const matchId of ids) {
      const { error } = await supabaseAdmin
        .from("notifications_sent")
        .insert({ user_id: userId, match_id: matchId, kind: "kickoff" });
      if (error) result.errors.push(`notifications_sent insert: ${error.message}`);
      sentKeys.add(`${userId}|${matchId}|kickoff`);
      result.kickoff_sent += 1;
      result.notifications_sent += 1;
    }
  }

  // =========== c) goals ===========
  for (const s of followed) {
    if (!isLiveStatus(s.status)) continue;
    const home = s.home_score;
    const away = s.away_score;
    if (home == null || away == null) continue;
    const prevHome = s.prev_home_score ?? 0;
    const prevAway = s.prev_away_score ?? 0;
    const homeScored = home > prevHome;
    const awayScored = away > prevAway;
    if (!homeScored && !awayScored) continue;

    const kind = `goal_${home}_${away}`;
    const recipients = [...(followersByMatch.get(s.match_id) ?? [])].filter(
      (u) => allows(u, "goal") && !sentKeys.has(`${u}|${s.match_id}|${kind}`),
    );
    if (recipients.length === 0) continue;

    const teams = matchTeams.get(s.match_id);
    const scoringTeam = homeScored ? nameOf(teams?.home) : nameOf(teams?.away);

    // Scorer name is a bonus, never a blocker. The incidents fetcher owns the 'bulk' gate.
    let scorer: string | null = null;
    try {
      const { runFetchMatchIncidents } = await import("@/lib/fetch-match-incidents.server");
      const r = await runFetchMatchIncidents({ matchExternalId: s.external_id });
      result.scorer_lookups += 1;
      if (r.status === "success" && r.events_saved > 0) {
        const { data: goals } = await supabaseAdmin
          .from("events")
          .select("minute, player_id, type")
          .eq("match_id", s.match_id)
          .in("type", ["goal", "penalty_goal", "own_goal"])
          .order("minute", { ascending: false })
          .limit(1);
        const playerId = goals?.[0]?.player_id ?? null;
        if (playerId) {
          const { data: player } = await supabaseAdmin
            .from("players")
            .select("name_he, name_en")
            .eq("id", playerId)
            .maybeSingle();
          scorer = player?.name_he?.trim() || player?.name_en?.trim() || null;
        }
      }
    } catch (e) {
      result.errors.push(`scorer: ${e instanceof Error ? e.message : "unknown"}`);
    }

    const payload: PushPayload = {
      title: scorer ? `גול! ${scoringTeam} — ${scorer}` : `גול! ${scoringTeam}`,
      body: `${titleOf(s.match_id)} ${away}:${home}`,
      url: `/match/${s.match_id}`,
      tag: `goal-${s.match_id}`,
    };

    for (const userId of recipients) {
      await deliver(userId, s.match_id, kind, payload);
      result.goal_sent += 1;
      result.notifications_sent += 1;
    }
  }

  return result;
}
