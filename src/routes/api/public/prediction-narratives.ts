import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/prediction-narratives")({
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

        const input: { limit?: number; force?: boolean } = {};
        try {
          const body = (await request.json()) as { limit?: number; force?: boolean } | null;
          if (body && typeof body === "object") {
            if (typeof body.limit === "number") input.limit = body.limit;
            if (typeof body.force === "boolean") input.force = body.force;
          }
        } catch {
          // no body — defaults apply
        }

        const { runPredictionNarratives } = await import("@/lib/prediction-narrative.server");
        const result = await runPredictionNarratives(input);
        return new Response(JSON.stringify(result), {
          status: result.status === "failed" ? 500 : 200,
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
      },
    },
  },
});
