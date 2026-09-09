import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Admin-only manual trigger for the live tick.
 *
 * A server function is a directly callable RPC endpoint: without this gate
 * anyone could burn the provider budget. The scheduled path stays the
 * secret-gated raw route /api/public/tick.
 */
export const tick = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("is_admin", { _user_id: context.userId });
    if (isAdmin !== true) throw new Error("Forbidden");

    const { runTick } = await import("@/lib/tick.server");
    return runTick();
  });
