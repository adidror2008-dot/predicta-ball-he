import { describe, expect, it } from "vitest";
import {
  afScorePair,
  bestNameScore,
  buildAfUpdate,
  mapAfStatus,
  isQuotaError,
  nextCheckDelayMs,
  normalizeName,
  providerErrorText,
  resolveUniqueFixture,
  type AfFixture,
} from "./af-core";

const NOW = "2026-09-09T20:00:00.000Z";
const base = { status: "notstarted", home_score: null, away_score: null, minute: null };

function fx(partial: AfFixture): AfFixture {
  return partial;
}

describe("mapAfStatus", () => {
  it("treats FT/AET/PEN as finished", () => {
    for (const s of ["FT", "AET", "PEN"]) expect(mapAfStatus(s)?.status).toBe("finished");
  });
  it("keeps postponed and canceled distinct", () => {
    expect(mapAfStatus("PST")?.status).toBe("postponed");
    expect(mapAfStatus("CANC")?.status).toBe("canceled");
    expect(mapAfStatus("ABD")?.status).toBe("canceled");
  });
  it("returns null for an unknown code", () => {
    expect(mapAfStatus("WHATEVER")).toBeNull();
  });
});

describe("afScorePair", () => {
  it("uses regulation/extra-time goals, never the shootout", () => {
    const f = fx({
      goals: { home: 1, away: 1 },
      score: { fulltime: { home: 1, away: 1 }, penalty: { home: 4, away: 2 } },
    });
    expect(afScorePair(f)).toEqual({ home: 1, away: 1 });
  });
  it("falls back to extra time when goals are absent", () => {
    expect(afScorePair(fx({ score: { extratime: { home: 3, away: 2 } } }))).toEqual({
      home: 3,
      away: 2,
    });
  });
});

describe("buildAfUpdate", () => {
  it("writes a live score with the elapsed minute", () => {
    const u = buildAfUpdate(
      base,
      fx({ fixture: { status: { short: "2H", elapsed: 63 } }, goals: { home: 2, away: 0 } }),
      NOW,
    );
    expect(u).toMatchObject({ status: "inprogress", minute: 63, home_score: 2, away_score: 0 });
  });

  it("never claims finished without both scores", () => {
    const u = buildAfUpdate(base, fx({ fixture: { status: { short: "FT" } } }), NOW);
    expect(u).toBeNull();
  });

  it("stores the 90/ET score for a penalty shootout, not the shootout score", () => {
    const u = buildAfUpdate(
      base,
      fx({
        fixture: { status: { short: "PEN" } },
        goals: { home: 1, away: 1 },
        score: { penalty: { home: 5, away: 4 } },
      }),
      NOW,
    );
    expect(u).toMatchObject({ status: "finished", home_score: 1, away_score: 1, minute: null });
  });

  it("never nulls a real score already stored", () => {
    const u = buildAfUpdate(
      { status: "inprogress", home_score: 2, away_score: 1, minute: 70 },
      fx({ fixture: { status: { short: "SUSP" } }, goals: { home: null, away: null } }),
      NOW,
    );
    expect(u).toMatchObject({ home_score: 2, away_score: 1 });
  });

  it("never downgrades a final row back to a non-final status", () => {
    const u = buildAfUpdate(
      { status: "finished", home_score: 2, away_score: 1, minute: null },
      fx({ fixture: { status: { short: "NS" } } }),
      NOW,
    );
    expect(u).toBeNull();
  });

  it("writes nothing for an unknown provider status", () => {
    expect(buildAfUpdate(base, fx({ fixture: { status: { short: "???" } } }), NOW)).toBeNull();
  });

  it("writes nothing when nothing changed", () => {
    const u = buildAfUpdate(
      { status: "inprogress", home_score: 1, away_score: 0, minute: 30 },
      fx({ fixture: { status: { short: "1H", elapsed: 30 } }, goals: { home: 1, away: 0 } }),
      NOW,
    );
    expect(u).toBeNull();
  });
});

describe("strict mapping", () => {
  const candidates = [
    { fixtureId: 1, homeName: "Olympique Lyonnais", awayName: "Auxerre", kickoffIso: NOW, round: "R1" },
    { fixtureId: 2, homeName: "Napoli", awayName: "Lazio", kickoffIso: NOW, round: "R1" },
  ];

  it("accepts a unique both-name match through a stored alias", () => {
    const lyonForms = [normalizeName("Lyon"), normalizeName("Olympique Lyonnais")];
    const hit = resolveUniqueFixture(lyonForms, [normalizeName("Auxerre")], candidates);
    expect(hit?.fixture.fixtureId).toBe(1);
  });

  it("rejects a short name with no matching alias", () => {
    const hit = resolveUniqueFixture([normalizeName("Lyon")], [normalizeName("Auxerre")], candidates);
    expect(hit).toBeNull();
  });


  it("rejects a one-sided (anchor) match", () => {
    const hit = resolveUniqueFixture(
      [normalizeName("Olympique Lyonnais")],
      [normalizeName("Paris Saint Germain")],
      candidates,
    );
    expect(hit).toBeNull();
  });

  it("rejects a reversed orientation", () => {
    const hit = resolveUniqueFixture([normalizeName("Auxerre")], [normalizeName("Lyon")], candidates);
    expect(hit).toBeNull();
  });

  it("does not confuse similar but different clubs", () => {
    expect(bestNameScore([normalizeName("Wolfsburg")], "Augsburg")).toBeLessThan(0.9);
    expect(bestNameScore([normalizeName("Athletico Paranaense")], "Atletico Mineiro")).toBeLessThan(0.9);
  });
});

describe("token subsets are not identities", () => {
  it("rejects a bare 'United' against any United club", () => {
    expect(bestNameScore([normalizeName("United")], "Manchester United")).toBeLessThan(0.9);
    expect(bestNameScore([normalizeName("United")], "Newcastle United")).toBeLessThan(0.9);
  });
  it("still accepts the same club written identically", () => {
    expect(bestNameScore([normalizeName("Manchester United")], "Manchester Utd")).toBeGreaterThan(0);
    expect(bestNameScore([normalizeName("Manchester United")], "Manchester United")).toBe(1);
  });
});

describe("providerErrorText", () => {
  it("treats an errors object as a failure, not a success", () => {
    expect(providerErrorText({ errors: { requests: "quota reached" } })).toContain("quota");
    expect(providerErrorText({ errors: [] })).toBeNull();
    expect(providerErrorText({ response: [] })).toBeNull();
  });
  it("detects quota failures", () => {
    expect(isQuotaError("requests: You have reached your quota", null)).toBe(true);
    expect(isQuotaError(null, 429)).toBe(true);
    expect(isQuotaError("bad league id", 200)).toBe(false);
  });
});

describe("nextCheckDelayMs", () => {
  const now = Date.parse("2026-09-10T12:00:00Z");
  it("polls a live fixture again in two minutes", () => {
    expect(nextCheckDelayMs("1H", null, now)).toBe(2 * 60_000);
  });
  it("does not re-probe a fixture the provider says starts in a month", () => {
    const d = nextCheckDelayMs("NS", "2026-10-20T19:00:00Z", now);
    expect(d).toBeGreaterThan(20 * 24 * 60 * 60_000);
  });
  it("re-checks an overdue not-started fixture within the hour", () => {
    expect(nextCheckDelayMs("NS", "2026-09-10T09:00:00Z", now)).toBe(30 * 60_000);
  });
  it("backs off far for a final fixture", () => {
    expect(nextCheckDelayMs("FT", null, now)).toBe(24 * 60 * 60_000);
  });
});
