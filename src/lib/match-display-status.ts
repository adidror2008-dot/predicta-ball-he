/**
 * Shared, pure display-status derivation for a match. Never mutates or
 * reinterprets the raw provider status — it only decides how to *present* it.
 *
 * A non-final provider status (notstarted / inprogress / …) whose kickoff is
 * at least STALE_AFTER_MS old has not received a verified update; presenting
 * it as "live" or "upcoming" would be misleading, and presenting it as
 * "finished" would invent a result. Such matches are shown as `pending`
 * ("ממתין לעדכון") with whatever real data we already hold.
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
