import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/backfill-api-football")({
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

        let input: { cutoffIso?: string; maxCalls?: number; dryRun?: boolean } = {};
        try {
          const body = (await request.json()) as typeof input | null;
          if (body && typeof body === "object") input = body;
        } catch {
          input = {};
        }

        const { runBackfillApiFootball } = await import("@/lib/backfill-api-football.server");
        const result = await runBackfillApiFootball({
          cutoffIso: input.cutoffIso ?? "2026-09-09T11:33:00Z",
          maxCalls: typeof input.maxCalls === "number" ? input.maxCalls : 20,
          dryRun: input.dryRun === true,
        });
        return new Response(JSON.stringify(result), {
          status: result.status === "failed" ? 500 : 200,
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
      },
    },
  },
});
