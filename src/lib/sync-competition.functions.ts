import { createServerFn } from "@tanstack/react-start";

export const syncCompetition = createServerFn({ method: "POST" })
  .inputValidator((data: { tournamentId: number; mode?: "next" | "last" | "both" }) => {
    if (!data || typeof data.tournamentId !== "number") {
      throw new Error("tournamentId is required");
    }
    if (data.mode && !["next", "last", "both"].includes(data.mode)) {
      throw new Error("mode must be next | last | both");
    }
    return data;
  })
  .handler(async ({ data }) => {
    const { runSyncCompetition } = await import("@/lib/sync-competition.server");
    return runSyncCompetition(data);
  });
