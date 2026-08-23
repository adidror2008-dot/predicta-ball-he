// Canonical stat keys shared between the fetcher and the read layer.

/** Provider key -> canonical snake_case key. Unmapped provider keys are skipped. */
export const PROVIDER_KEY_MAP: Record<string, string> = {
  ballPossession: "ball_possession",
  totalShotsOnGoal: "total_shots",
  shotsOnGoal: "shots_on_target",
  shotsOffGoal: "shots_off_target",
  blockedScoringAttempt: "blocked_shots",
  bigChanceCreated: "big_chances",
  bigChanceScored: "big_chances_scored",
  bigChanceMissed: "big_chances_missed",
  expectedGoals: "expected_goals",
  cornerKicks: "corner_kicks",
  fouls: "fouls",
  offsides: "offsides",
  yellowCards: "yellow_cards",
  passes: "passes",
  accuratePasses: "accurate_passes",
  goalkeeperSaves: "goalkeeper_saves",
  totalTackle: "tackles",
  duelWonPercent: "duels_won",
  throwIns: "throw_ins",
  freeKicks: "free_kicks",
};

/** Keys whose value is a percentage (stored as the bare number). */
export const PERCENT_KEYS = new Set(["ball_possession", "duels_won"]);

/** Display order + Hebrew labels. Keys absent here are not displayed. */
export const STAT_DISPLAY: { key: string; labelHe: string }[] = [
  { key: "ball_possession", labelHe: "החזקת כדור" },
  { key: "total_shots", labelHe: "בעיטות סה״כ" },
  { key: "shots_on_target", labelHe: "בעיטות למסגרת" },
  { key: "shots_off_target", labelHe: "בעיטות מחוץ למסגרת" },
  { key: "blocked_shots", labelHe: "בעיטות שנחסמו" },
  { key: "big_chances", labelHe: "הזדמנויות גדולות" },
  { key: "big_chances_scored", labelHe: "הזדמנויות שנוצלו" },
  { key: "big_chances_missed", labelHe: "הזדמנויות שהוחמצו" },
  { key: "expected_goals", labelHe: "שערים צפויים" },
  { key: "corner_kicks", labelHe: "קרנות" },
  { key: "passes", labelHe: "מסירות" },
  { key: "accurate_passes", labelHe: "מסירות מדויקות" },
  { key: "duels_won", labelHe: "הכרעות שנוצחו" },
  { key: "tackles", labelHe: "חטיפות" },
  { key: "goalkeeper_saves", labelHe: "הצלות שוער" },
  { key: "fouls", labelHe: "עבירות" },
  { key: "offsides", labelHe: "נבדלים" },
  { key: "yellow_cards", labelHe: "כרטיסים צהובים" },
  { key: "free_kicks", labelHe: "בעיטות חופשיות" },
  { key: "throw_ins", labelHe: "זריקות חוץ" },
];

/** Parses a provider display value: "39%" -> 39, "241/292 (83%)" -> 241, "1.43" -> 1.43. */
export function parseStatValue(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw !== "string") return null;
  const match = raw.trim().match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}
