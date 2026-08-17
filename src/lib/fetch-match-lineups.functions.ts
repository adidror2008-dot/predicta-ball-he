import { createServerFn } from "@tanstack/react-start";

export const fetchMatchLineups = createServerFn({ method: "POST" })
  .inputValidator((input: { matchExternalId: string }) => input)
  .handler(async ({ data }) => {
    const { runFetchMatchLineups } = await import("@/lib/fetch-match-lineups.server");
    return runFetchMatchLineups(data);
  });
