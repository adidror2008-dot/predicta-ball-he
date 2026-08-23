import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/run-predictions-once")({
  server: {
    handlers: {
      POST: async () => {
        const { runPredictions } = await import("@/lib/run-predictions.server");
        return Response.json(await runPredictions());
      },
    },
  },
});
