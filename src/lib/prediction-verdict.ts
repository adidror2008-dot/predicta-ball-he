/**
 * Correctness label for a finished match, derived from the stored predicted
 * score and the real final score — never from a generic boolean "hit" flag.
 *
 * - exact score (home AND away)      -> "צדק"
 * - only the 1X2 outcome is right    -> "צדק בזוכה" (a draw counts as an outcome)
 * - anything else                    -> "פספס"
 *
 * Returns null while the match is not finished or any of the four numbers is
 * missing, so no correctness is ever claimed before a verified final result.
 */

export type PredictionVerdict = {
  kind: "exact" | "outcome" | "miss";
  text: string;
  className: string;
};

function outcome(home: number, away: number): "home" | "draw" | "away" {
  return home > away ? "home" : home < away ? "away" : "draw";
}

export function predictionVerdict(input: {
  isFinished: boolean;
  predictedHome: number | null | undefined;
  predictedAway: number | null | undefined;
  actualHome: number | null | undefined;
  actualAway: number | null | undefined;
}): PredictionVerdict | null {
  const { isFinished, predictedHome, predictedAway, actualHome, actualAway } = input;
  if (!isFinished) return null;
  if (
    typeof predictedHome !== "number" ||
    typeof predictedAway !== "number" ||
    typeof actualHome !== "number" ||
    typeof actualAway !== "number"
  ) {
    return null;
  }

  if (predictedHome === actualHome && predictedAway === actualAway) {
    return { kind: "exact", text: "צדק", className: "bg-status-win/25 text-status-win" };
  }
  if (outcome(predictedHome, predictedAway) === outcome(actualHome, actualAway)) {
    return {
      kind: "outcome",
      text: "צדק בזוכה",
      className: "bg-status-win/15 text-status-win",
    };
  }
  return { kind: "miss", text: "פספס", className: "bg-status-loss/20 text-status-loss" };
}
