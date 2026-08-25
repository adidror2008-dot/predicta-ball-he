import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/backtest-sweep")({
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

        let body: { rounds?: number } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          body = {};
        }

        try {
          const { runBacktestSweep } = await import("@/lib/backtest-sweep.server");
          const result = await runBacktestSweep(body);
          return Response.json({ status: "success", result }, { status: 200 });
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
