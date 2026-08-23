import { createServerFn } from "@tanstack/react-start";

export const fetchMatchStats = createServerFn({ method: "POST" })
  .inputValidator((input: { matchExternalId?: string; limit?: number }) => input)
  .handler(async ({ data }) => {
    const { runFetchMatchStats } = await import("@/lib/fetch-match-stats.server");
    return runFetchMatchStats(data);
  });
