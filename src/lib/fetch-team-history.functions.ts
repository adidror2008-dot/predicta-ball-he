import { createServerFn } from "@tanstack/react-start";

export const fetchTeamHistory = createServerFn({ method: "POST" })
  .inputValidator((input: { teamExternalId?: string; limit?: number } | undefined) => input ?? {})
  .handler(async ({ data }) => {
    const { runFetchTeamHistory } = await import("@/lib/fetch-team-history.server");
    return runFetchTeamHistory(data);
  });
