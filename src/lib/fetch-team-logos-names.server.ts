import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SOFASCORE_HOST = "sportapi7.p.rapidapi.com";
const SOURCE = "sofascore";
const BUCKET = "team-logos";

export type JobRunStatus = "success" | "partial" | "failed" | "skipped";

export type TeamLogoOutcome = {
  team_id: string;
  external_id: string;
  http_status: number | null;
  updated: boolean;
  error?: string;
};

export type FetchTeamLogosNamesResult = {
  status: JobRunStatus;
  teams_considered: number;
  teams_updated: number;
  names_updated: number;
  budget_exhausted: boolean;
  outcomes: TeamLogoOutcome[];
  message?: string;
  job_run_error?: string;
};

/**
 * Fills logo_url (Supabase Storage path in bucket `team-logos`) for existing teams.
 * Never creates a team row. name_he is left untouched: the provider returns no
 * Hebrew translation, and names are never invented.
 */
export async function runFetchTeamLogosNames(
  data: { limit?: number; teamExternalId?: string } = {},
): Promise<FetchTeamLogosNamesResult> {
  const startedAt = new Date().toISOString();
  const apiKey = process.env["SPORTAPI_API_KEY"];
  const limit = Math.max(1, Math.min(Number(data.limit ?? 20), 50));

  let teamsConsidered = 0;
  let teamsUpdated = 0;
  const namesUpdated = 0;
  let budgetExhausted = false;
  const outcomes: TeamLogoOutcome[] = [];

  const finish = async (
    status: JobRunStatus,
    message?: string,
  ): Promise<FetchTeamLogosNamesResult> => {
    const { error: jobError } = await supabaseAdmin.from("job_runs").insert({
      job_name: "fetch-team-logos-names",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status,
      result_metric: teamsUpdated,
      result_detail: {
        teams_considered: teamsConsidered,
        teams_updated: teamsUpdated,
        names_updated: namesUpdated,
        budget_exhausted: budgetExhausted,
        outcomes,
      } as never,
      error: message ?? null,
    });
    if (jobError) {
      console.error(`[fetch-team-logos-names] job_runs insert failed: ${jobError.message}`);
    }
    return {
      status,
      teams_considered: teamsConsidered,
      teams_updated: teamsUpdated,
      names_updated: namesUpdated,
      budget_exhausted: budgetExhausted,
      outcomes,
      ...(message ? { message } : {}),
      ...(jobError ? { job_run_error: jobError.message } : {}),
    };
  };

  if (!apiKey || apiKey.trim() === "") {
    return finish("failed", "missing SPORTAPI_API_KEY");
  }

  let query = supabaseAdmin
    .from("teams")
    .select("id, external_id, name_en, name_he, logo_url")
    .eq("source", SOURCE)
    .not("external_id", "is", null)
    .is("logo_url", null)
    .limit(limit);
  if (data.teamExternalId) query = query.eq("external_id", String(data.teamExternalId));

  const { data: teams, error: teamsError } = await query;
  if (teamsError) return finish("failed", teamsError.message);
  teamsConsidered = teams?.length ?? 0;
  if (teamsConsidered === 0) return finish("skipped", "no teams missing logo_url");

  for (const team of teams ?? []) {
    const externalId = String(team.external_id);

    const { data: allowed, error: budgetError } = await supabaseAdmin.rpc("api_budget_take", {
      p_provider: SOURCE,
      p_category: "bulk",
      p_count: 1,
    });
    if (budgetError) {
      outcomes.push({
        team_id: team.id,
        external_id: externalId,
        http_status: null,
        updated: false,
        error: `budget: ${budgetError.message}`,
      });
      break;
    }
    if (allowed !== true) {
      budgetExhausted = true;
      break;
    }

    // Exactly one outgoing call per team.
    const res = await fetch(`https://${SOFASCORE_HOST}/api/v1/team/${externalId}/image`, {
      headers: { "x-rapidapi-key": apiKey, "x-rapidapi-host": SOFASCORE_HOST },
    });
    if (!res.ok) {
      outcomes.push({
        team_id: team.id,
        external_id: externalId,
        http_status: res.status,
        updated: false,
        error: `image http ${res.status}`,
      });
      continue;
    }

    const contentType = res.headers.get("content-type") ?? "image/png";
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0) {
      outcomes.push({
        team_id: team.id,
        external_id: externalId,
        http_status: res.status,
        updated: false,
        error: "empty image body",
      });
      continue;
    }

    const ext = contentType.includes("svg") ? "svg" : contentType.includes("jpeg") ? "jpg" : "png";
    const storagePath = `${SOURCE}/${externalId}.${ext}`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(storagePath, bytes, { contentType, upsert: true });
    if (uploadError) {
      outcomes.push({
        team_id: team.id,
        external_id: externalId,
        http_status: res.status,
        updated: false,
        error: `upload: ${uploadError.message}`,
      });
      continue;
    }

    // Update only — never insert a team row. name_he is intentionally not written.
    const { error: updateError } = await supabaseAdmin
      .from("teams")
      .update({ logo_url: storagePath, logo_checked_at: new Date().toISOString() })
      .eq("id", team.id);
    if (updateError) {
      outcomes.push({
        team_id: team.id,
        external_id: externalId,
        http_status: res.status,
        updated: false,
        error: `update: ${updateError.message}`,
      });
      continue;
    }

    teamsUpdated += 1;
    outcomes.push({
      team_id: team.id,
      external_id: externalId,
      http_status: res.status,
      updated: true,
    });
  }

  if (teamsUpdated === 0) return finish("failed", "no team was updated");
  if (teamsUpdated < teamsConsidered) {
    return finish("partial", budgetExhausted ? "budget exhausted mid-run" : "some teams failed");
  }
  return finish("success");
}
