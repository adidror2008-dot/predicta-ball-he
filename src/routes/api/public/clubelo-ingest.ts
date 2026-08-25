import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/clubelo-ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env["CRON_SECRET"];
        if (!expected || expected.trim() === "") {
          return Response.json({ error: "CRON_SECRET not configured" }, { status: 500 });
        }
        if (request.headers.get("x-cron-secret") !== expected) {
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }

        let body: { step?: string; limit?: number } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          body = {};
        }

        try {
          const mod = await import("@/lib/clubelo-ingest.server");
          if (body.step === "match") {
            return Response.json({ status: "ok", result: await mod.runClubEloMatch() });
          }
          if (body.step === "history") {
            const limit = body.limit;
            return Response.json({
              status: "ok",
              result: await mod.runClubEloHistory(limit === undefined ? {} : { limit }),
            });
          }
          return Response.json({ status: "ok", result: await mod.runClubEloSnapshot() });
        } catch (error) {
          return Response.json(
            { status: "error", error: error instanceof Error ? error.message : String(error) },
            { status: 500 },
          );
        }
      },
    },
  },
});
