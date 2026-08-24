import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/translate-team-names")({
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

        let input: { limit?: number } = {};
        try {
          const body = (await request.json()) as { limit?: number } | null;
          if (body && typeof body === "object" && typeof body.limit === "number") {
            input.limit = body.limit;
          }
        } catch {
          input = {};
        }

        const { runTranslateTeamNames } = await import("@/lib/translate-team-names.server");
        const result = await runTranslateTeamNames(input);
        return new Response(JSON.stringify(result), {
          status: result.status === "failed" ? 500 : 200,
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
      },
    },
  },
});
