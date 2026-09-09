import { describe, expect, it } from "vitest";
import { predictionVerdict } from "./prediction-verdict";

const finished = { isFinished: true };

describe("predictionVerdict", () => {
  it("labels an exact score צדק", () => {
    const v = predictionVerdict({ ...finished, predictedHome: 2, predictedAway: 1, actualHome: 2, actualAway: 1 });
    expect(v).toMatchObject({ kind: "exact", text: "צדק" });
  });

  it("labels a right winner with a wrong score צדק בזוכה", () => {
    const v = predictionVerdict({ ...finished, predictedHome: 3, predictedAway: 1, actualHome: 1, actualAway: 0 });
    expect(v).toMatchObject({ kind: "outcome", text: "צדק בזוכה" });
  });

  it("treats a predicted draw that ended in a different draw as outcome-only", () => {
    const v = predictionVerdict({ ...finished, predictedHome: 1, predictedAway: 1, actualHome: 2, actualAway: 2 });
    expect(v).toMatchObject({ kind: "outcome", text: "צדק בזוכה" });
  });

  it("labels a wrong outcome פספס", () => {
    const v = predictionVerdict({ ...finished, predictedHome: 2, predictedAway: 0, actualHome: 0, actualAway: 1 });
    expect(v).toMatchObject({ kind: "miss", text: "פספס" });
  });

  it("labels a predicted win that ended in a draw פספס", () => {
    const v = predictionVerdict({ ...finished, predictedHome: 2, predictedAway: 1, actualHome: 1, actualAway: 1 });
    expect(v).toMatchObject({ kind: "miss", text: "פספס" });
  });

  it("claims nothing before the match is finished", () => {
    expect(
      predictionVerdict({ isFinished: false, predictedHome: 2, predictedAway: 1, actualHome: 2, actualAway: 1 }),
    ).toBeNull();
  });

  it("claims nothing when a real score is missing", () => {
    expect(
      predictionVerdict({ ...finished, predictedHome: 2, predictedAway: 1, actualHome: null, actualAway: null }),
    ).toBeNull();
    expect(
      predictionVerdict({ ...finished, predictedHome: null, predictedAway: null, actualHome: 1, actualAway: 0 }),
    ).toBeNull();
  });
});
