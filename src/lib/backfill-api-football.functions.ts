import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Admin-only manual trigger for the API-Football status/score backfill.
 * There is deliberately no unauthenticated HTTP route for this operation.
 */
export const runApiFootballBackfill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { cutoffIso?: string; maxCalls?: number; dryRun?: boolean }) => input)
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("is_admin", { _user_id: context.userId });
    if (isAdmin !== true) throw new Error("Forbidden");

    const { runBackfillApiFootball } = await import("@/lib/backfill-api-football.server");
    return runBackfillApiFootball({
      cutoffIso: data.cutoffIso ?? new Date().toISOString(),
      maxCalls: typeof data.maxCalls === "number" ? data.maxCalls : 20,
      dryRun: data.dryRun === true,
    });
  });
