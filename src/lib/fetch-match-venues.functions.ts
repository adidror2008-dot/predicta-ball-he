import { createServerFn } from "@tanstack/react-start";

export const runFetchMatchVenuesFn = createServerFn({ method: "POST" })
  .inputValidator((input: { limit?: number; matchExternalId?: string } = {}) => input)
  .handler(async ({ data }) => {
    const { runFetchMatchVenues } = await import("@/lib/fetch-match-venues.server");
    return runFetchMatchVenues(data ?? {});
  });
