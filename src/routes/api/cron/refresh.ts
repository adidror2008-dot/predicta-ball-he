import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/cron/refresh")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const errors: string[] = [];

        const expected = process.env["CRON_SECRET"];
        if (!expected || expected.trim() === "") {
          return Response.json(
            { error: "CRON_SECRET not configured" },
            { status: 500 },
          );
        }

        const provided = request.headers.get("x-cron-secret");
        if (!provided || provided !== expected) {
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }

        let fetchResult: unknown = null;
        let refreshResult: unknown = null;
        let predictionsResult: unknown = null;

        try {
          const { runFetchTeamHistory } = await import("@/lib/fetch-team-history.server");
          fetchResult = await runFetchTeamHistory({ limit: 15 });
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data, error } = await supabaseAdmin.rpc("pb_refresh_match_history");
          if (error) throw error;
          refreshResult = data;
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }

        try {
          const { runPredictions } = await import("@/lib/run-predictions.server");
          predictionsResult = await runPredictions();
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }

        return Response.json(
          {
            fetch: fetchResult,
            refresh: refreshResult,
            predictions: predictionsResult,
            errors,
          },
          { status: 200 },
        );
      },
    },
  },
});
