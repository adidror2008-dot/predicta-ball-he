import { createServerFn } from "@tanstack/react-start";
import type { MatchesListInput } from "@/lib/matches-list.server";

export const getMatchesListFn = createServerFn({ method: "POST" })
  .inputValidator((input: MatchesListInput | undefined) => input ?? {})
  .handler(async ({ data }) => {
    const { getMatchesList } = await import("@/lib/matches-list.server");
    return getMatchesList(data);
  });
