import { supabaseAdmin } from "@/integrations/supabase/client.server";

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const AI_MODEL = "google/gemini-2.5-flash";
const PROVIDER = "lovable-ai";

export type TranslateTeamNamesResult = {
  status: "success" | "partial" | "failed" | "skipped";
  candidates: number;
  translated: number;
  budget_exhausted: boolean;
  message?: string;
};

type Pair = { external_id: string; name_he: string };

/**
 * Fills teams.name_he for teams that have none. One AI call for the whole batch,
 * gated by api_budget_take. Never overwrites an existing Hebrew name.
 */
export async function runTranslateTeamNames(
  data: { limit?: number } = {},
): Promise<TranslateTeamNamesResult> {
  const startedAt = new Date().toISOString();
  const cap = Math.min(100, Math.max(1, data.limit ?? 50));

  let candidates = 0;
  let translated = 0;
  let budgetExhausted = false;

  const finish = async (
    status: TranslateTeamNamesResult["status"],
    message?: string,
  ): Promise<TranslateTeamNamesResult> => {
    await supabaseAdmin.from("job_runs").insert({
      job_name: "translate-team-names",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status,
      result_metric: translated,
      result_detail: { candidates, translated, budget_exhausted: budgetExhausted, message },
    });
    return { status, candidates, translated, budget_exhausted: budgetExhausted, ...(message ? { message } : {}) };
  };

  const { data: rows, error } = await supabaseAdmin
    .from("teams")
    .select("id, external_id, name_en, name_he")
    .is("name_he", null)
    .not("name_en", "is", null)
    .limit(cap);

  if (error) return await finish("failed", error.message);

  const pending = (rows ?? []).filter(
    (t) => (t.name_he ?? "").trim() === "" && (t.name_en ?? "").trim() !== "",
  );
  candidates = pending.length;
  if (candidates === 0) return await finish("success", "no teams need translation");

  const { data: allowed, error: budgetError } = await supabaseAdmin.rpc("api_budget_take", {
    p_provider: PROVIDER,
    p_category: "bulk",
    p_count: 1,
  });
  if (budgetError) return await finish("failed", budgetError.message);
  if (allowed !== true) {
    budgetExhausted = true;
    return await finish("skipped", "budget exhausted for lovable-ai");
  }

  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return await finish("failed", "missing LOVABLE_API_KEY");

  const input = pending.map((t) => ({
    external_id: String(t.external_id ?? t.id),
    name_en: t.name_en,
  }));

  const prompt = [
    "תעתק/תרגם שמות מועדוני כדורגל לעברית תקנית ומקובלת בתקשורת הישראלית.",
    'דוגמאות: "Real Betis" -> "ריאל בטיס", "Sporting CP" -> "ספורטינג ליסבון".',
    "החזר JSON בלבד, מערך בפורמט:",
    '[{"external_id":"...","name_he":"..."}]',
    "בלי טקסט חופשי, בלי הסברים, בלי code fences.",
    JSON.stringify(input),
  ].join("\n");

  let content = "";
  try {
    const res = await fetch(AI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      return await finish("failed", `ai gateway ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as any;
    content = String(json?.choices?.[0]?.message?.content ?? "");
  } catch (e) {
    return await finish("failed", `ai gateway error: ${(e as Error).message}`);
  }

  let pairs: Pair[] = [];
  try {
    const cleaned = content.replace(/```json/gi, "").replace(/```/g, "").trim();
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    const slice = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
    const parsed = JSON.parse(slice) as unknown;
    if (Array.isArray(parsed)) {
      pairs = parsed
        .map((p: any) => ({
          external_id: String(p?.external_id ?? ""),
          name_he: String(p?.name_he ?? "").trim(),
        }))
        .filter((p) => p.external_id !== "" && p.name_he !== "");
    }
  } catch {
    return await finish("failed", "ai returned non-JSON output");
  }

  if (pairs.length === 0) return await finish("failed", "ai returned no usable translations");

  const byExternal = new Map(pending.map((t) => [String(t.external_id ?? t.id), t.id]));

  for (const pair of pairs) {
    const id = byExternal.get(pair.external_id);
    if (!id) continue;
    // Guard: only ever fills an empty value, never overwrites.
    const { error: updateError, count } = await supabaseAdmin
      .from("teams")
      .update({ name_he: pair.name_he }, { count: "exact" })
      .eq("id", id)
      .is("name_he", null);
    if (!updateError && (count ?? 0) > 0) translated += 1;
  }

  return await finish(translated === pairs.length ? "success" : "partial");
}
