import { createServerFn } from "@tanstack/react-start";

export const getMatchesListFn = createServerFn({ method: "POST" }).handler(async () => {
  const { getMatchesList } = await import("@/lib/matches-list.server");
  return getMatchesList();
});
