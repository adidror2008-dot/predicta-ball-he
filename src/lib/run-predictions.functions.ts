import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";

export const runPredictionsFn = createServerFn({ method: "POST" }).handler(async () => {
  const expected = process.env["CRON_SECRET"];
  if (!expected || expected.trim() === "") {
    throw new Error("Missing required secret: CRON_SECRET");
  }
  const provided = getRequestHeader("x-cron-secret");
  if (provided !== expected) {
    throw new Response("unauthorized", { status: 401 });
  }

  const { runPredictions } = await import("@/lib/run-predictions.server");
  return runPredictions();
});
