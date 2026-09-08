import { describe, expect, it } from "vitest";
import { deriveDisplayStatus, rawToDisplayStatus, STALE_AFTER_MS } from "./match-display-status";

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
