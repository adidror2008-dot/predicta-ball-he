import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/fetch-match-stats")({
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

        let input: { matchExternalId?: string; limit?: number } = {};
        try {
          const body = (await request.json()) as
            | { matchExternalId?: string; limit?: number }
            | null;
          if (body && typeof body === "object") {
            if (typeof body.matchExternalId === "string")
              input.matchExternalId = body.matchExternalId;
            if (typeof body.limit === "number") input.limit = body.limit;
          }
        } catch {
          input = {};
        }

        const { runFetchMatchStats } = await import("@/lib/fetch-match-stats.server");
        const result = await runFetchMatchStats(input);
        return new Response(JSON.stringify(result), {
          status: result.status === "failed" ? 500 : 200,
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
      },
    },
  },
});
