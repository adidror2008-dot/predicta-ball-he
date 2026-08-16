import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/discover-seasons")({
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

        const { runDiscoverSeasons } = await import("@/lib/discover-seasons.server");
        const result = await runDiscoverSeasons();
        return new Response(JSON.stringify(result), {
          status: "error" in result ? 500 : 200,
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
      },
    },
  },
});
