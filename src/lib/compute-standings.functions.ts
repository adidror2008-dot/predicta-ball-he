import { createServerFn } from "@tanstack/react-start";

export const computeStandings = createServerFn({ method: "POST" }).handler(async () => {
  const { runComputeStandings } = await import("@/lib/compute-standings.server");
  return runComputeStandings();
});
