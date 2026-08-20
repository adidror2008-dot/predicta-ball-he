import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SOURCE = "sofascore";
const PHOTO_PROVIDER = "sofascore-cdn";
const PHOTO_BUCKET = "player-photos";
const CDN_BASE = "https://img.sofascore.com/api/v1/player";

export type JobRunStatus = "success" | "partial" | "failed" | "skipped";

export type FetchPlayerPhotosResult = {
  status: JobRunStatus;
  candidates: number;
  stored: number;
  failed: number;
  budget_exhausted: boolean;
  failures: Array<{ player_external_id: string; reason: string }>;
  message?: string;
  job_run_error?: string;
};

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const DAY_MS = 24 * 60 * 60 * 1000;

export async function runFetchPlayerPhotos(
  input: { limit?: number } = {},
): Promise<FetchPlayerPhotosResult> {
  const startedAt = new Date().toISOString();
  const limit = Math.min(300, Math.max(1, Math.floor(input.limit ?? 60)));

  let candidates = 0;
  let stored = 0;
  let failed = 0;
  let budgetExhausted = false;
  const failures: Array<{ player_external_id: string; reason: string }> = [];

  const finish = async (
    status: JobRunStatus,
    message?: string,
  ): Promise<FetchPlayerPhotosResult> => {
    const { error: jobError } = await supabaseAdmin.from("job_runs").insert({
      job_name: "fetch-player-photos",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status,
      result_metric: stored,
      result_detail: {
        limit,
        candidates,
        stored,
        failed,
        budget_exhausted: budgetExhausted,
        failures: failures.slice(0, 20),
      } as never,
      error: message ?? null,
    });
    return {
      status,
      candidates,
      stored,
      failed,
      budget_exhausted: budgetExhausted,
      failures,
      ...(message ? { message } : {}),
      ...(jobError ? { job_run_error: jobError.message } : {}),
    };
  };

  const now = Date.now();
  const from = new Date(now - 3 * DAY_MS).toISOString();
  const to = new Date(now + 7 * DAY_MS).toISOString();
  const staleBefore = new Date(now - 30 * DAY_MS).toISOString();

  // Matches inside the window.
  const { data: matches, error: matchesError } = await supabaseAdmin
    .from("matches")
    .select("id")
    .gte("kickoff_at", from)
    .lte("kickoff_at", to);
  if (matchesError) return finish("failed", matchesError.message);
  const matchIds = (matches ?? []).map((m) => m.id);
  if (matchIds.length === 0) return finish("skipped", "no matches in window");

  // Lineup entries for those matches — starters first.
  const { data: lineupRows, error: lineupsError } = await supabaseAdmin
    .from("lineups")
    .select("player_id, is_starting")
    .in("match_id", matchIds)
    .not("player_id", "is", null);
  if (lineupsError) return finish("failed", lineupsError.message);

  const startingById = new Map<string, boolean>();
  for (const r of lineupRows ?? []) {
    if (!r.player_id) continue;
    startingById.set(r.player_id, (startingById.get(r.player_id) ?? false) || r.is_starting === true);
  }
  if (startingById.size === 0) return finish("skipped", "no lineup players in window");

  const playerIds = [...startingById.keys()];
  const { data: players, error: playersError } = await supabaseAdmin
    .from("players")
    .select("id, external_id, photo_checked_at")
    .in("id", playerIds)
    .eq("source", SOURCE)
    .is("photo_url", null)
    .not("external_id", "is", null)
    .or(`photo_checked_at.is.null,photo_checked_at.lt.${staleBefore}`);
  if (playersError) return finish("failed", playersError.message);

  const queue = (players ?? [])
    .sort((a, b) => {
      const as = startingById.get(a.id) === true ? 0 : 1;
      const bs = startingById.get(b.id) === true ? 0 : 1;
      return as - bs;
    })
    .slice(0, limit);
  candidates = queue.length;
  if (candidates === 0) return finish("success", "no players need a photo");

  for (const player of queue) {
    const externalId = String(player.external_id);

    const { data: allowed, error: budgetError } = await supabaseAdmin.rpc("api_budget_take", {
      p_provider: PHOTO_PROVIDER,
      p_category: "bulk",
      p_count: 1,
    });
    if (budgetError) {
      failed += 1;
      failures.push({ player_external_id: externalId, reason: `budget: ${budgetError.message}` });
      break;
    }
    if (allowed !== true) {
      budgetExhausted = true;
      break;
    }

    const stamp = async (patch: Record<string, unknown> = {}) => {
      await supabaseAdmin
        .from("players")
        .update({ photo_checked_at: new Date().toISOString(), ...patch })
        .eq("id", player.id);
    };

    // Single outgoing call per player. No retry.
    let res: Response;
    try {
      res = await fetch(`${CDN_BASE}/${externalId}/image`);
    } catch (e) {
      failed += 1;
      failures.push({ player_external_id: externalId, reason: `network: ${String(e)}` });
      await stamp();
      continue;
    }

    const contentType = (res.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
    if (!res.ok || !EXT_BY_MIME[contentType]) {
      failed += 1;
      failures.push({
        player_external_id: externalId,
        reason: `http ${res.status} content-type ${contentType || "none"}`,
      });
      await stamp();
      continue;
    }

    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0) {
      failed += 1;
      failures.push({ player_external_id: externalId, reason: "empty body" });
      await stamp();
      continue;
    }

    const storagePath = `${SOURCE}/${externalId}.${EXT_BY_MIME[contentType]}`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from(PHOTO_BUCKET)
      .upload(storagePath, bytes, { contentType, upsert: true });
    if (uploadError) {
      failed += 1;
      failures.push({ player_external_id: externalId, reason: `upload: ${uploadError.message}` });
      await stamp();
      continue;
    }

    const cachedAt = new Date().toISOString();
    const { error: photoError } = await supabaseAdmin.from("player_photos").upsert(
      {
        player_external_id: externalId,
        source: SOURCE,
        storage_path: storagePath,
        cached_at: cachedAt,
      },
      { onConflict: "player_external_id,source" },
    );
    if (photoError) {
      failed += 1;
      failures.push({ player_external_id: externalId, reason: `photos: ${photoError.message}` });
      await stamp();
      continue;
    }

    await stamp({ photo_url: storagePath });
    stored += 1;
  }

  if (stored === 0 && failed > 0) return finish("failed", "no photos stored");
  if (failed > 0 || budgetExhausted) {
    return finish("partial", budgetExhausted ? "budget exhausted for sofascore-cdn" : undefined);
  }
  return finish("success");
}
