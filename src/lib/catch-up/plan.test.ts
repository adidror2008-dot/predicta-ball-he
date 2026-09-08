import { describe, expect, it } from "vitest";
import {
  buildScoreUpdate,
  detailNeeds,
  effectiveCallCeiling,
  groupByCompetitionOldestFirst,
  isProviderFailure,
  isUnavailableStatus,
  isUnresolvedPast,
  nextPageAfter,
  pauseForResponse,
  stuckBucket,
  type MatchLite,
} from "./plan";

const NOW = Date.parse("2026-09-08T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();

const base = (over: Partial<MatchLite>): MatchLite => ({
  id: "m1",
  external_id: "100",
  competition_id: "c1",
  kickoff_at: hoursAgo(5),
  status: "notstarted",
  ...over,
});

describe("selection of stuck matches", () => {
  it("selects notstarted matches older than 4h and 24h, not live-window ones", () => {
    expect(isUnresolvedPast(base({ kickoff_at: hoursAgo(5) }), NOW)).toBe(true);
    expect(isUnresolvedPast(base({ kickoff_at: hoursAgo(30), status: "inprogress" }), NOW)).toBe(true);
    expect(isUnresolvedPast(base({ kickoff_at: hoursAgo(2) }), NOW)).toBe(false);
    expect(stuckBucket(base({ kickoff_at: hoursAgo(5) }), NOW)).toBe("stale_4h");
    expect(stuckBucket(base({ kickoff_at: hoursAgo(30) }), NOW)).toBe("stale_24h");
    expect(stuckBucket(base({ kickoff_at: hoursAgo(1) }), NOW)).toBe("live_window");
  });

  it("never selects final statuses or rows without provider identity", () => {
    for (const status of ["finished", "postponed", "canceled", "awarded", "removed"]) {
      expect(isUnresolvedPast(base({ status, kickoff_at: hoursAgo(50) }), NOW)).toBe(false);
    }
    expect(isUnresolvedPast(base({ external_id: null }), NOW)).toBe(false);
    expect(isUnresolvedPast(base({ kickoff_at: null }), NOW)).toBe(false);
  });

  it("orders competitions by their oldest unresolved match", () => {
    const groups = groupByCompetitionOldestFirst([
      base({ id: "a", competition_id: "late", kickoff_at: hoursAgo(6) }),
      base({ id: "b", competition_id: "early", kickoff_at: hoursAgo(200) }),
      base({ id: "c", competition_id: "late", kickoff_at: hoursAgo(300) }),
    ]);
    expect(groups.map(([id]) => id)).toEqual(["late", "early"]);
  });
});

describe("no false finalization", () => {
  const now = new Date(NOW).toISOString();

  it("writes finished with both scores and resolves", () => {
    const r = buildScoreUpdate(base({}), {
      status: { type: "finished" },
      homeScore: { current: 2 },
      awayScore: { current: 1 },
    }, now);
    expect(r?.resolved).toBe(true);
    expect(r?.update).toMatchObject({ status: "finished", home_score: 2, away_score: 1, needs_review: false, minute: null });
  });

  it("refuses finished without scores and refuses events without a status", () => {
    expect(buildScoreUpdate(base({}), { status: { type: "finished" } }, now)).toBeNull();
    expect(buildScoreUpdate(base({}), { homeScore: { current: 1 } }, now)).toBeNull();
    expect(buildScoreUpdate(base({}), { status: { type: "" } }, now)).toBeNull();
  });

  it("keeps true provider states such as postponed, without inventing scores", () => {
    const r = buildScoreUpdate(base({}), { status: { type: "postponed" }, homeScore: {}, awayScore: {} }, now);
    expect(r?.resolved).toBe(true);
    expect(r?.update.status).toBe("postponed");
    expect(r?.update.home_score).toBeUndefined();
  });

  it("writes a still-open provider state truthfully but keeps it on the retry list", () => {
    const r = buildScoreUpdate(base({}), { status: { type: "inprogress" }, homeScore: { current: 1 }, awayScore: { current: 0 } }, now);
    expect(r?.resolved).toBe(false);
    expect(r?.update.needs_review).toBe(true);
  });

  it("corrects kickoff only when the provider time differs by more than a minute", () => {
    const ts = Math.floor(Date.parse(hoursAgo(5)) / 1000);
    const same = buildScoreUpdate(base({}), { status: { type: "finished" }, homeScore: { current: 0 }, awayScore: { current: 0 }, startTimestamp: ts }, now);
    expect(same?.update.kickoff_at).toBeUndefined();
    const moved = buildScoreUpdate(base({}), { status: { type: "finished" }, homeScore: { current: 0 }, awayScore: { current: 0 }, startTimestamp: ts + 3600 }, now);
    expect(moved?.update.kickoff_at).toBeDefined();
  });
});

describe("bounded pagination with progress", () => {
  const ev = (h: number) => ({ startTimestamp: Math.floor((NOW - h * 3600_000) / 1000) });

  it("goes one page deeper only when an older unresolved match remains", () => {
    const remaining = [base({ kickoff_at: hoursAgo(400) })];
    expect(nextPageAfter(remaining, [ev(10), ev(100)], 0, true)).toBe(1);
    expect(nextPageAfter(remaining, [ev(10), ev(500)], 0, true)).toBeNull();
    expect(nextPageAfter(remaining, [ev(10), ev(100)], 0, false)).toBeNull();
    expect(nextPageAfter([], [ev(10)], 0, true)).toBeNull();
  });
});

describe("quota and failure handling", () => {
  it("lowers the request ceiling to the remaining non-live budget", () => {
    expect(effectiveCallCeiling(40, 107)).toBe(40);
    expect(effectiveCallCeiling(40, 12)).toBe(12);
    expect(effectiveCallCeiling(40, -5)).toBe(0);
    expect(effectiveCallCeiling(40, null)).toBe(40);
  });

  it("treats 404 as unavailable data and every other non-2xx / network error as a stop", () => {
    expect(isUnavailableStatus(404)).toBe(true);
    expect(isProviderFailure(404)).toBe(false);
    expect(isProviderFailure(200)).toBe(false);
    expect(isProviderFailure(429)).toBe(true);
    expect(isProviderFailure(500)).toBe(true);
    expect(isProviderFailure(null)).toBe(true);
  });

  it("pauses the provider for a bounded time on 429, longer for a monthly quota", () => {
    const monthly = pauseForResponse(429, '{"message":"You have exceeded the MONTHLY quota"}');
    const burst = pauseForResponse(429, "too many requests");
    expect(monthly).toBe(2 * 3600_000);
    expect(burst).toBe(10 * 60_000);
    expect(pauseForResponse(200, "ok")).toBeNull();
    expect(pauseForResponse(500, "err")).toBeNull();
  });
});

describe("missing-detail recovery is idempotent", () => {
  const finished = {
    status: "finished",
    home_score: 1,
    away_score: 1,
    has_lineups: false,
    has_stats: false,
    has_events: false,
    ratings_checked_at: null,
    stats_checked_at: null,
    incidents_checked_at: null,
  };

  it("requests every missing detail once for a finished match", () => {
    expect(detailNeeds(finished)).toEqual(["lineups", "stats", "incidents"]);
  });

  it("does not refetch details that exist or were already checked", () => {
    expect(detailNeeds({ ...finished, has_lineups: true, stats_checked_at: "x", has_events: true })).toEqual([]);
    expect(detailNeeds({ ...finished, ratings_checked_at: "x" })).toEqual(["stats", "incidents"]);
  });

  it("never asks for incidents without a known final score and never for unfinished matches", () => {
    expect(detailNeeds({ ...finished, home_score: null })).toEqual(["lineups", "stats"]);
    expect(detailNeeds({ ...finished, status: "notstarted" })).toEqual([]);
  });
});
