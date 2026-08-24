import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/fetch-player-photos")({
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
        let backfill = false;
        try {
          const body = (await request.json()) as { limit?: number; backfill?: boolean } | null;
          if (body && typeof body.limit === "number") limit = body.limit;
          if (body && body.backfill === true) backfill = true;
        } catch {
          limit = undefined;
        }

        const mod = await import("@/lib/fetch-player-photos.server");
        const args = limit === undefined ? {} : { limit };
        const result = backfill
          ? await mod.runBackfillPlayerPhotos(args)
          : await mod.runFetchPlayerPhotos(args);
        return new Response(JSON.stringify(result), {
          status: result.status === "failed" ? 500 : 200,
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
      },
    },
  },
});
