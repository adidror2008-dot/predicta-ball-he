import { createServerFn } from "@tanstack/react-start";

export const getCompetitionsListFn = createServerFn({ method: "POST" }).handler(async () => {
  const { getCompetitionsList } = await import("@/lib/competitions-list.server");
  return getCompetitionsList();
});
