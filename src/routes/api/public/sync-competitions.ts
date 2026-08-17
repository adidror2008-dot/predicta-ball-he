import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/sync-competitions")({
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

        const url = new URL(request.url);
        const full = url.searchParams.get("full") === "true";

        // Reuses the daily fixtures sync, which writes its own job_runs row
        // carrying real counters (api_calls, matches_upserted, teams_upserted).
        const { runSyncFixturesDaily } = await import("@/lib/sync-fixtures-daily.server");
        const result = await runSyncFixturesDaily({ full });
        return new Response(JSON.stringify(result), {
          status: result.status === "failed" ? 500 : 200,
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
      },
    },
  },
});
