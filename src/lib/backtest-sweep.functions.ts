import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";

export const backtestSweepFn = createServerFn({ method: "POST" })
  .inputValidator((input: { rounds?: number } | undefined) => input ?? {})
  .handler(async ({ data }) => {
    const expected = process.env["CRON_SECRET"];
    if (!expected || expected.trim() === "") {
      throw new Error("Missing required secret: CRON_SECRET");
    }
    if (getRequestHeader("x-cron-secret") !== expected) {
      throw new Response("unauthorized", { status: 401 });
    }
    const { runBacktestSweep } = await import("@/lib/backtest-sweep.server");
    return runBacktestSweep(data);
  });
