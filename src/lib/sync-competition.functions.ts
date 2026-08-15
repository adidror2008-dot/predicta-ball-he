import { createServerFn } from "@tanstack/react-start";

export const syncCompetition = createServerFn({ method: "POST" })
  .inputValidator((data: { tournamentId: number }) => {
    if (!data || typeof data.tournamentId !== "number") {
      throw new Error("tournamentId is required");
    }
    return data;
  })
  .handler(async ({ data }) => {
    const { runSyncCompetition } = await import("@/lib/sync-competition.server");
    return runSyncCompetition(data);
  });
