import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/fetch-team-history")({
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
        const rawLimit = Number(url.searchParams.get("limit") ?? "25");
        const limit = Number.isFinite(rawLimit)
          ? Math.max(1, Math.min(Math.trunc(rawLimit), 200))
          : 25;

        // Reuses the history fetcher, which gates every call through
        // api_budget_take and writes one job_runs row with real row counts.
        const { runFetchTeamHistory } = await import("@/lib/fetch-team-history.server");
        const result = await runFetchTeamHistory({ limit });
        return new Response(JSON.stringify(result), {
          status: result.status === "failed" ? 500 : 200,
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
      },
    },
  },
});
