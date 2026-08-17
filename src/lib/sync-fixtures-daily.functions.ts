import { createServerFn } from "@tanstack/react-start";

export const syncFixturesDaily = createServerFn({ method: "POST" })
  .inputValidator((input: { full?: boolean } | undefined) => input ?? {})
  .handler(async ({ data }) => {
    const { runSyncFixturesDaily } = await import("@/lib/sync-fixtures-daily.server");
    return runSyncFixturesDaily(data);
  });
