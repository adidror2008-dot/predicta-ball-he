import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { pauseForResponse } from "@/lib/catch-up/plan";

export { pauseForResponse };

/**
 * Shared Sofascore (sportapi7) gate.
 *
 * 1. A persistent pause marker in cron_config: when the provider reports that
 *    its plan quota is exhausted (HTTP 429), every job stops calling it for a
 *    bounded cooldown instead of burning the internal daily budget against a
 *    wall. The pause is time-limited — never a permanent suppression — and is
 *    cleared on the first successful response.
 * 2. api_budget_take is still taken for every call after the pause check.
 */
export const SOFASCORE_PROVIDER = "sofascore";
export const PAUSE_KEY = "sofascore_paused_until";
export const PAUSE_REASON_KEY = "sofascore_paused_reason";


export type BudgetCategory = "live" | "lineups" | "bulk";

export type GateResult =
  | { allowed: true }
  | { allowed: false; reason: "provider_paused" | "budget_exhausted"; until?: string };

export async function readPause(): Promise<{ until: string; reason: string } | null> {
  const { data } = await supabaseAdmin
    .from("cron_config")
    .select("key, value")
    .in("key", [PAUSE_KEY, PAUSE_REASON_KEY]);
  const until = data?.find((r) => r.key === PAUSE_KEY)?.value ?? null;
  if (!until) return null;
  const ts = Date.parse(until);
  if (!Number.isFinite(ts) || ts <= Date.now()) return null;
  return { until, reason: data?.find((r) => r.key === PAUSE_REASON_KEY)?.value ?? "" };
}

export async function sofascoreGate(category: BudgetCategory, count = 1): Promise<GateResult> {
  const pause = await readPause();
  if (pause) return { allowed: false, reason: "provider_paused", until: pause.until };
  const { data: ok } = await supabaseAdmin.rpc("api_budget_take", {
    p_provider: SOFASCORE_PROVIDER,
    p_category: category,
    p_count: count,
  });
  if (ok !== true) return { allowed: false, reason: "budget_exhausted" };
  return { allowed: true };
}


/**
 * Record what the provider answered. 429 -> bounded pause; 2xx -> clear pause.
 * Never throws — telemetry must not break the calling job.
 */
export async function noteProviderResponse(status: number, body: string): Promise<void> {
  try {
    const pauseMs = pauseForResponse(status, body);
    if (pauseMs != null) {
      const until = new Date(Date.now() + pauseMs).toISOString();
      await supabaseAdmin.from("cron_config").upsert(
        [
          { key: PAUSE_KEY, value: until },
          { key: PAUSE_REASON_KEY, value: `http ${status}: ${body.slice(0, 160)}` },
        ],
        { onConflict: "key" },
      );
      return;
    }
    if (status >= 200 && status < 300) {
      await supabaseAdmin.from("cron_config").delete().in("key", [PAUSE_KEY, PAUSE_REASON_KEY]);
    }
  } catch {
    // telemetry only
  }
}
