import { createFileRoute } from "@tanstack/react-router";

/**
 * Manual / scheduled entry for the bounded stuck-match catch-up.
 * Guarded by the same x-cron-secret gate as every other job route.
 * Body: { maxCalls?: number (1-40), stage?: "scores" | "details" | "all" }
 */
export const Route = createFileRoute("/api/public/catch-up-matches")({
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

        let maxCalls = 10;
        let stage: "scores" | "details" | "all" = "all";
        try {
          const body = (await request.json()) as { maxCalls?: unknown; stage?: unknown } | null;
          if (body && typeof body === "object") {
            if (typeof body.maxCalls === "number" && Number.isFinite(body.maxCalls)) {
              maxCalls = Math.max(1, Math.min(40, Math.floor(body.maxCalls)));
            }
            if (body.stage === "scores" || body.stage === "details" || body.stage === "all") {
              stage = body.stage;
            }
          }
        } catch {
          // empty body -> defaults
        }

        const { runCatchUpMatches } = await import("@/lib/catch-up-matches.server");
        const result = await runCatchUpMatches({ maxCalls, stage });
        return new Response(JSON.stringify(result), {
          status: result.status === "failed" ? 500 : 200,
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
      },
    },
  },
});
