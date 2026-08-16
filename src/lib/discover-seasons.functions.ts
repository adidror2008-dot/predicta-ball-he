import { createServerFn } from "@tanstack/react-start";

export const discoverSeasons = createServerFn({ method: "POST" }).handler(async () => {
  const { runDiscoverSeasons } = await import("@/lib/discover-seasons.server");
  return runDiscoverSeasons();
});
