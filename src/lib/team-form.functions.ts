import { createServerFn } from "@tanstack/react-start";

export const getTeamFormFn = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      teamExternalId: string;
      uniqueTournamentId?: string;
      source?: string;
      limit?: number;
    }) => input,
  )
  .handler(async ({ data }) => {
    const { getTeamForm } = await import("@/lib/team-form.server");
    return getTeamForm(data);
  });
