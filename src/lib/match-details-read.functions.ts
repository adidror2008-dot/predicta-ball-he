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
