import { describe, expect, it } from "vitest";
import {
  deriveDisplayStatus,
  groupMatches,
  rawToDisplayStatus,
  SECTION_ORDER,
  sectionFor,
  STALE_AFTER_MS,
} from "./match-display-status";

const NOW = Date.parse("2026-09-08T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const H = 60 * 60 * 1000;

describe("deriveDisplayStatus", () => {
  it("keeps a fresh inprogress match live", () => {
    expect(deriveDisplayStatus("inprogress", ago(1 * H), NOW)).toBe("live");
  });

  it("keeps a future notstarted match scheduled", () => {
    expect(deriveDisplayStatus("notstarted", ago(-2 * H), NOW)).toBe("scheduled");
  });

  it("marks a stale inprogress match (>= 4h) as pending, never finished", () => {
    // Paris FC – Nice / Freiburg – Bremen shape: inprogress since 30/08.
    expect(deriveDisplayStatus("inprogress", "2026-08-30T13:00:00Z", NOW)).toBe("pending");
    expect(deriveDisplayStatus("inprogress", ago(STALE_AFTER_MS), NOW)).toBe("pending");
    expect(deriveDisplayStatus("inprogress", ago(STALE_AFTER_MS - 1), NOW)).toBe("live");
  });

  it("marks a past notstarted match as pending, not scheduled", () => {
    expect(deriveDisplayStatus("notstarted", ago(9 * 24 * H), NOW)).toBe("pending");
    expect(deriveDisplayStatus(null, ago(5 * H), NOW)).toBe("pending");
  });

  it("never downgrades final statuses", () => {
    expect(deriveDisplayStatus("finished", ago(30 * 24 * H), NOW)).toBe("finished");
    expect(deriveDisplayStatus("postponed", ago(30 * 24 * H), NOW)).toBe("postponed");
  });

  it("falls back to the raw mapping without a kickoff", () => {
    expect(deriveDisplayStatus("inprogress", null, NOW)).toBe("live");
    expect(rawToDisplayStatus("halftime")).toBe("live");
    expect(rawToDisplayStatus("ended")).toBe("finished");
  });
});

describe("groupMatches — list sections", () => {
  const row = (id: string, status: string | null, kickoffAt: string, home: number | null = null, away: number | null = null) => ({
    id,
    status,
    kickoffAt,
    homeScore: home,
    awayScore: away,
  });

  it("puts pending matches (with or without a stale score) in their own section, never upcoming", () => {
    const g = groupMatches(
      [
        row("paris-nice", "inprogress", "2026-08-30T13:00:00Z", 2, 0),
        row("flamengo-botafogo", "notstarted", "2026-08-30T19:30:00Z"),
        row("future", "notstarted", ago(-3 * H)),
      ],
      NOW,
    );
    expect(g.pending.map((m) => m.id)).toEqual(["paris-nice", "flamengo-botafogo"]);
    expect(g.upcoming.map((m) => m.id)).toEqual(["future"]);
    expect(g.pending.every((m) => m.display === "pending")).toBe(true);
  });

  it("separates real live matches from upcoming and from finished/postponed", () => {
    const g = groupMatches(
      [
        row("live", "inprogress", ago(1 * H), 1, 1),
        row("soon", "notstarted", ago(-1 * H)),
        row("done", "finished", ago(30 * H), 3, 1),
        row("off", "postponed", ago(30 * H)),
      ],
      NOW,
    );
    expect(g.live.map((m) => m.id)).toEqual(["live"]);
    expect(g.upcoming.map((m) => m.id)).toEqual(["soon"]);
    expect(g.finished.map((m) => m.id)).toEqual(["done"]);
    expect(g.postponed.map((m) => m.id)).toEqual(["off"]);
  });

  it("re-classifies the same rows when only the clock moves", () => {
    // Same data object; within 4h of kickoff it stays under upcoming (the live
    // tick owns that window), after 4h without a provider update it is pending.
    const rows = [row("m", "notstarted", ago(1 * H))];
    expect(groupMatches(rows, NOW).upcoming).toHaveLength(1);
    expect(groupMatches(rows, NOW).pending).toHaveLength(0);
    expect(groupMatches(rows, NOW + 3 * H).pending).toHaveLength(1);
    expect(groupMatches(rows, NOW + 3 * H).upcoming).toHaveLength(0);
  });

  it("uses the same mapping for the badge and the section, in a fixed order", () => {
    expect(sectionFor("pending")).toBe("pending");
    expect(sectionFor("scheduled")).toBe("upcoming");
    expect(SECTION_ORDER).toEqual(["finished", "pending", "live", "upcoming", "postponed"]);
  });
});

describe("unconfirmed kickoff placeholders", () => {
  const longAgo = "2026-09-08T19:00:00Z";
  const now = Date.parse("2026-09-09T12:00:00Z");

  it("never marks an unconfirmed-date fixture as pending", () => {
    expect(deriveDisplayStatus("notstarted", longAgo, now, false)).toBe("unscheduled");
  });

  it("still marks a confirmed-date fixture as pending", () => {
    expect(deriveDisplayStatus("notstarted", longAgo, now, true)).toBe("pending");
  });

  it("groups unconfirmed fixtures away from upcoming and pending", () => {
    const g = groupMatches(
      [{ status: "notstarted", kickoffAt: longAgo, timeConfirmed: false }],
      now,
    );
    expect(g.unscheduled).toHaveLength(1);
    expect(g.upcoming).toHaveLength(0);
    expect(g.pending).toHaveLength(0);
  });

  it("does not invent a result for an unconfirmed fixture", () => {
    expect(deriveDisplayStatus("notstarted", longAgo, now, false)).not.toBe("finished");
  });
});
