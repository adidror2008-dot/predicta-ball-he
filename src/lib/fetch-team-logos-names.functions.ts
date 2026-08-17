import { createServerFn } from "@tanstack/react-start";

export const fetchTeamLogosNames = createServerFn({ method: "POST" })
  .inputValidator((input: { limit?: number; teamExternalId?: string }) => input ?? {})
  .handler(async ({ data }) => {
    const { runFetchTeamLogosNames } = await import("@/lib/fetch-team-logos-names.server");
    return runFetchTeamLogosNames(data);
  });
