import { createServerFn } from "@tanstack/react-start";

export const fetchMatchDetails = createServerFn({ method: "POST" })
  .inputValidator((input: { matchExternalId: string }) => input)
  .handler(async ({ data }) => {
    const { runFetchMatchDetails } = await import("@/lib/fetch-match-details.server");
    return runFetchMatchDetails(data);
  });
