import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";

export const backtestV7Fn = createServerFn({ method: "POST" })
  .inputValidator((input: { label?: string; overrides?: Record<string, number> } | undefined) => input ?? {})
  .handler(async ({ data }) => {
    const expected = process.env["CRON_SECRET"];
    if (!expected || expected.trim() === "") {
      throw new Error("Missing required secret: CRON_SECRET");
    }
    if (getRequestHeader("x-cron-secret") !== expected) {
      throw new Response("unauthorized", { status: 401 });
    }
    const { runBacktestV7 } = await import("@/lib/backtest-v7.server");
    return runBacktestV7(data);
  });
