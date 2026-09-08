/**
 * Shared, pure display-status derivation for a match. Never mutates or
 * reinterprets the raw provider status — it only decides how to *present* it.
 *
 * A non-final provider status (notstarted / inprogress / …) whose kickoff is
 * at least STALE_AFTER_MS old has not received a verified update; presenting
 * it as "live" or "upcoming" would be misleading, and presenting it as
 * "finished" would invent a result. Such matches are shown as `pending`
 * ("ממתין לעדכון") with whatever real data we already hold, and grouped in
 * their own past section — never under "upcoming".
 */

export type MatchDisplayStatus = "scheduled" | "live" | "finished" | "postponed" | "pending";

export const STALE_AFTER_MS = 4 * 60 * 60 * 1000;

const FINISHED = new Set(["finished", "ended", "afterET", "ap", "awarded"]);
const LIVE = new Set(["inprogress", "live", "halftime"]);
const POSTPONED = new Set(["postponed", "canceled", "cancelled", "removed"]);

export function rawToDisplayStatus(status: string | null | undefined): Exclude<MatchDisplayStatus, "pending"> {
  if (status && POSTPONED.has(status)) return "postponed";
  if (status && FINISHED.has(status)) return "finished";
  if (status && LIVE.has(status)) return "live";
  return "scheduled";
}

/**
 * `pending` when the raw status is non-final and kickoff is >= 4h in the past.
 * Final statuses (finished / postponed) are never downgraded.
 */
export function deriveDisplayStatus(
  status: string | null | undefined,
  kickoffAt: string | null | undefined,
  nowMs: number = Date.now(),
): MatchDisplayStatus {
  const base = rawToDisplayStatus(status);
  if (base === "finished" || base === "postponed") return base;
  if (!kickoffAt) return base;
  const kickoff = Date.parse(kickoffAt);
  if (!Number.isFinite(kickoff)) return base;
  return nowMs - kickoff >= STALE_AFTER_MS ? "pending" : base;
}

export const DISPLAY_STATUS_LABEL_HE: Record<MatchDisplayStatus, string> = {
  scheduled: "טרם החל",
  live: "משחק חי",
  finished: "הסתיים",
  postponed: "נדחה",
  pending: "ממתין לעדכון",
};

/** Caption for a score that is the last one received, not a verified final. */
export const PENDING_SCORE_LABEL_HE = "תוצאה אחרונה שנקלטה";

/** List sections, in display order. */
export type MatchSection = "finished" | "pending" | "live" | "upcoming" | "postponed";

export const SECTION_ORDER: readonly MatchSection[] = ["finished", "pending", "live", "upcoming", "postponed"];

export const SECTION_TITLE_HE: Record<MatchSection, string | null> = {
  finished: null,
  pending: "משחקי עבר — ממתינים לעדכון",
  live: "משחקים חיים",
  upcoming: "משחקים קרובים",
  postponed: "משחקים שנדחו",
};

export function sectionFor(display: MatchDisplayStatus): MatchSection {
  switch (display) {
    case "finished":
      return "finished";
    case "pending":
      return "pending";
    case "live":
      return "live";
    case "postponed":
      return "postponed";
    default:
      return "upcoming";
  }
}

/**
 * One classification for grouping and for the card/header badge. `nowMs` is a
 * parameter so callers re-evaluate on a clock, not only when data changes.
 */
export function groupMatches<T extends { status: string | null; kickoffAt: string }>(
  matches: readonly T[],
  nowMs: number,
): Record<MatchSection, Array<T & { display: MatchDisplayStatus }>> {
  const out: Record<MatchSection, Array<T & { display: MatchDisplayStatus }>> = {
    finished: [],
    pending: [],
    live: [],
    upcoming: [],
    postponed: [],
  };
  const sorted = [...matches].sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt));
  for (const m of sorted) {
    const display = deriveDisplayStatus(m.status, m.kickoffAt, nowMs);
    out[sectionFor(display)].push({ ...m, display });
  }
  return out;
}
