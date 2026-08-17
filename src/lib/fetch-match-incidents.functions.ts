import { createServerFn } from "@tanstack/react-start";

export const fetchMatchIncidents = createServerFn({ method: "POST" })
  .inputValidator((input: { matchExternalId: string }) => input)
  .handler(async ({ data }) => {
    const { runFetchMatchIncidents } = await import("@/lib/fetch-match-incidents.server");
    return runFetchMatchIncidents(data);
  });
