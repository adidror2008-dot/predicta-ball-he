import { createServerFn } from "@tanstack/react-start";

export const getIncidentsFn = createServerFn({ method: "POST" })
  .inputValidator((input: { matchExternalId: string }) => input)
  .handler(async ({ data }) => {
    const { getIncidents } = await import("@/lib/match-details-read.server");
    return getIncidents(data.matchExternalId);
  });

export const getMatchLineupsFn = createServerFn({ method: "POST" })
  .inputValidator((input: { matchExternalId: string }) => input)
  .handler(async ({ data }) => {
    const { getMatchLineups } = await import("@/lib/match-details-read.server");
    return getMatchLineups(data.matchExternalId);
  });

export const getPlayerPhotoFn = createServerFn({ method: "POST" })
  .inputValidator((input: { playerExternalId: string }) => input)
  .handler(async ({ data }) => {
    const { getPlayerPhoto } = await import("@/lib/match-details-read.server");
    return { url: await getPlayerPhoto(data.playerExternalId) };
  });

export const getMatchHeaderFn = createServerFn({ method: "POST" })
  .inputValidator((input: { matchExternalId: string }) => input)
  .handler(async ({ data }) => {
    const { getMatchHeader } = await import("@/lib/match-details-read.server");
    return getMatchHeader(data.matchExternalId);
  });

export const getMatchPredictionFn = createServerFn({ method: "POST" })
  .inputValidator((input: { matchExternalId: string }) => input)
  .handler(async ({ data }) => {
    const { getMatchPrediction } = await import("@/lib/match-details-read.server");
    return getMatchPrediction(data.matchExternalId);
  });

export const getModelAccuracyFn = createServerFn({ method: "POST" }).handler(async () => {
  const { getModelAccuracy } = await import("@/lib/match-details-read.server");
  return getModelAccuracy();
});

export const getMatchStatsFn = createServerFn({ method: "POST" })
  .inputValidator((input: { matchExternalId: string }) => input)
  .handler(async ({ data }) => {
    const { getMatchStats } = await import("@/lib/match-details-read.server");
    return getMatchStats(data.matchExternalId);
  });
