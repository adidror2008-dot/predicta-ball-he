import { describe, expect, it } from "vitest";
import {
  classifyProviderFailure,
  isMinuteRateReason,
  numericHeader,
  parseRetryAfter,
} from "./af-core";

const NOW = Date.parse("2026-09-11T22:00:00.000Z");
const MINUTE_TEXT =
  "rateLimit: Too many requests. You have exceeded the limit of requests per minute of your subscription.";
const DAILY_TEXT =
  "requests: You have exceeded the MONTHLY quota for Requests on your current plan, PRO.";

describe("parseRetryAfter", () => {
  it("accepts delta-seconds", () => {
    expect(parseRetryAfter("30", NOW)).toBe(30_000);
  });
  it("accepts an HTTP date in the future", () => {
    expect(parseRetryAfter(new Date(NOW + 90_000).toUTCString(), NOW)).toBeGreaterThan(60_000);
  });
  it("rejects garbage, empty, past dates and absurd deltas", () => {
    expect(parseRetryAfter("soon", NOW)).toBeNull();
    expect(parseRetryAfter("  ", NOW)).toBeNull();
    expect(parseRetryAfter(null, NOW)).toBeNull();
    expect(parseRetryAfter(new Date(NOW - 5000).toUTCString(), NOW)).toBeNull();
    expect(parseRetryAfter("999999", NOW)).toBeNull();
  });
});

describe("numericHeader", () => {
  it("never turns an absent header into zero", () => {
    expect(numericHeader(null)).toBeNull();
    expect(numericHeader("")).toBeNull();
    expect(numericHeader("n/a")).toBeNull();
    expect(numericHeader("0")).toBe(0);
  });
});

describe("classifyProviderFailure", () => {
  it("returns none for an ordinary error", () => {
    const f = classifyProviderFailure({ text: "bad league id", httpStatus: 200, nowMs: NOW });
    expect(f.kind).toBe("none");
    expect(f.cooldownMs).toBe(0);
  });

  it("classifies the real per-minute error as minute, not daily", () => {
    const f = classifyProviderFailure({ text: MINUTE_TEXT, httpStatus: 429, nowMs: NOW });
    expect(f.kind).toBe("minute");
    expect(f.cooldownMs).toBeGreaterThanOrEqual(60_000);
    expect(f.cooldownMs).toBeLessThanOrEqual(15 * 60_000);
  });

  it("honours a valid Retry-After over the fallback", () => {
    const f = classifyProviderFailure({
      text: MINUTE_TEXT,
      httpStatus: 429,
      headers: { retryAfter: "20" },
      nowMs: NOW,
    });
    expect(f.cooldownMs).toBe(20_000);
  });

  it("classifies an explicit plan/daily message as daily", () => {
    const f = classifyProviderFailure({ text: DAILY_TEXT, httpStatus: 429, nowMs: NOW });
    expect(f.kind).toBe("daily");
    expect(f.cooldownMs).toBeGreaterThan(60 * 60_000);
  });

  it("uses genuine daily counters at zero as daily evidence", () => {
    const f = classifyProviderFailure({
      text: null,
      httpStatus: 429,
      headers: { dayLimit: "7500", dayRemaining: "0" },
      nowMs: NOW,
    });
    expect(f.kind).toBe("daily");
  });

  it("treats minute counters at zero as a minute limit", () => {
    const f = classifyProviderFailure({
      text: null,
      httpStatus: 429,
      headers: { minuteLimit: "300", minuteRemaining: "0" },
      nowMs: NOW,
    });
    expect(f.kind).toBe("minute");
  });

  it("does not shut the day down on a 429 with missing or malformed headers", () => {
    const f = classifyProviderFailure({
      text: null,
      httpStatus: 429,
      headers: { dayLimit: null, dayRemaining: "", retryAfter: "later" },
      nowMs: NOW,
    });
    expect(f.kind).toBe("unknown");
    expect(f.cooldownMs).toBeLessThanOrEqual(15 * 60_000);
  });

  it("backs off exponentially but stays bounded at 15 minutes", () => {
    const a = classifyProviderFailure({
      text: MINUTE_TEXT, httpStatus: 429, nowMs: NOW, consecutiveFailures: 0,
    }).cooldownMs;
    const b = classifyProviderFailure({
      text: MINUTE_TEXT, httpStatus: 429, nowMs: NOW, consecutiveFailures: 2,
    }).cooldownMs;
    const c = classifyProviderFailure({
      text: MINUTE_TEXT, httpStatus: 429, nowMs: NOW, consecutiveFailures: 9,
    }).cooldownMs;
    expect(b).toBeGreaterThan(a);
    expect(c).toBe(15 * 60_000);
  });
});

describe("isMinuteRateReason", () => {
  it("recognises the stale persisted minute pause", () => {
    expect(isMinuteRateReason(`${MINUTE_TEXT} on /fixtures`)).toBe(true);
  });
  it("preserves daily, plan and account pauses", () => {
    expect(isMinuteRateReason(DAILY_TEXT)).toBe(false);
    expect(isMinuteRateReason("account suspended")).toBe(false);
    expect(isMinuteRateReason(null)).toBe(false);
    expect(isMinuteRateReason("network on /fixtures: fetch failed")).toBe(false);
  });
});
