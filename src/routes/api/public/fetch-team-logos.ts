import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/fetch-team-logos")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env["CRON_SECRET"];
        const provided = request.headers.get("x-cron-secret");
        if (!expected || !provided || provided !== expected) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }

        let limit: number | undefined;
        let teamExternalId: string | undefined;
        try {
          const body = (await request.json()) as
            | { limit?: number; teamExternalId?: string }
            | null;
          if (body && typeof body.limit === "number") limit = body.limit;
          if (body && typeof body.teamExternalId === "string") teamExternalId = body.teamExternalId;
        } catch {
          limit = undefined;
        }

        const { runFetchTeamLogosNames } = await import("@/lib/fetch-team-logos-names.server");
        const result = await runFetchTeamLogosNames({
          ...(limit === undefined ? {} : { limit }),
          ...(teamExternalId === undefined ? {} : { teamExternalId }),
        });
        return new Response(JSON.stringify(result), {
          status: result.status === "failed" ? 500 : 200,
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
      },
    },
  },
});
