// PredictaBall — natural-language Hebrew phrasing for existing predictions.
//
// Reads ONLY numbers already stored in public.predictions. No football API call,
// no engine recomputation. One Lovable AI Gateway call per batch, gated by
// api_budget_take('lovable-ai', 'bulk', 1). No automatic retries.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const AI_MODEL = "google/gemini-2.5-flash";
const PROVIDER = "lovable-ai";
const MODEL_VERSION = "v7.0";
const BATCH_SIZE = 10;

export type PredictionNarrativeResult = {
  status: "success" | "partial" | "failed" | "skipped";
  candidates: number;
  updated: number;
  ai_calls: number;
  skipped: number;
  budget_exhausted: boolean;
  message?: string;
};

type PredictionNarrativeInput = {
  limit?: number;
  force?: boolean;
  rephraseBefore?: string;
};

type Row = {
  id: string;
  match_id: string;
  predicted_home_score: number | null;
  predicted_away_score: number | null;
  prob_home: number | null;
  prob_draw: number | null;
  prob_away: number | null;
  prob_over_2_5: number | null;
  prob_btts: number | null;
  expected_total_goals: number | null;
  confidence: number | null;
  confidence_band: string | null;
  reason_lines_he: string[] | null;
};

const pct = (v: number | null) =>
  v === null || v === undefined ? null : Math.round(Number(v) <= 1 ? Number(v) * 100 : Number(v));

/**
 * The prompt every prediction explanation is phrased with — kept in one place so
 * the backfill and future predictions always use identical wording rules.
 */
export function buildNarrativePrompt(items: unknown[]): string {
  return [
    "אתה פרשן כדורגל ישראלי שמסביר תחזית בעל פה, בעברית טבעית וזורמת.",
    "לכל תחזית כתוב הסבר של 1-2 משפטים מלאים וזורמים — קצת יותר ממשפט יבש אחד, אבל לא פסקה.",
    "כתוב כמו שבן אדם מסביר לחבר: משפט שמחבר בין הסיבה לתוצאה, עם מילות קישור טבעיות",
    "כמו 'בגלל ש', 'ולכן', 'אם כי', 'למרות ש' — ולא רשימת עובדות זו אחר זו.",
    "אסור: bullets, כותרות, נקודתיים באמצע כרשימה, מילים כמו 'מודל', 'אלגוריתם', 'נתונים', 'סטטיסטיקה'.",
    "מותר לשלב מספר אחד או שניים בתוך המשפט כשהם באמת מחזקים את ההסבר, לא יותר.",
    "אסור להמציא נתון שלא נמצא ברשומה — אין נתון, פשוט לא מזכירים אותו.",
    "אל תשתמש בשמות קבוצות אם הם לא מופיעים ברשומה.",
    "טון: ענייני ובטוח, בלי הבטחות, בלי סימני קריאה, בלי קלישאות של 'קרב צמוד ומרתק'.",
    "החזר JSON בלבד, מערך בפורמט:",
    '[{"id":"...","text":"..."}]',
    "בלי טקסט חופשי, בלי code fences.",
    JSON.stringify(items),
  ].join("\n");
}

function toItem(row: Row, names: { home: string | null; away: string | null }) {
  const item: Record<string, unknown> = { id: row.id };
  if (names.home) item["home_team"] = names.home;
  if (names.away) item["away_team"] = names.away;
  if (row.predicted_home_score !== null && row.predicted_away_score !== null) {
    item["predicted_score"] = `${row.predicted_home_score}-${row.predicted_away_score}`;
  }
  const ph = pct(row.prob_home);
  const pd = pct(row.prob_draw);
  const pa = pct(row.prob_away);
  if (ph !== null) item["home_win_pct"] = ph;
  if (pd !== null) item["draw_pct"] = pd;
  if (pa !== null) item["away_win_pct"] = pa;
  const over = pct(row.prob_over_2_5);
  if (over !== null) item["over_2_5_pct"] = over;
  const btts = pct(row.prob_btts);
  if (btts !== null) item["both_teams_score_pct"] = btts;
  if (row.expected_total_goals !== null) {
    item["expected_goals"] = Number(row.expected_total_goals).toFixed(1);
  }
  if (row.confidence !== null) item["confidence_pct"] = pct(row.confidence);
  if (row.confidence_band) item["confidence_band"] = row.confidence_band;
  const reasons = (row.reason_lines_he ?? []).filter((r) => typeof r === "string" && r.trim());
  if (reasons.length > 0) item["engine_facts_he"] = reasons;
  return item;
}

export async function runPredictionNarratives(
  data: PredictionNarrativeInput = {},
): Promise<PredictionNarrativeResult> {
  const MAX_CONSECUTIVE_FAILURES = 3;
  let consecutiveFailures = 0;
  let skippedBatches = 0;
  const startedAt = new Date().toISOString();
  const cap = Math.min(800, Math.max(1, data.limit ?? 100));

  let candidates = 0;
  let updated = 0;
  let aiCalls = 0;
  let budgetExhausted = false;
  let parseFailures = 0;

  const finish = async (
    status: PredictionNarrativeResult["status"],
    message?: string,
  ): Promise<PredictionNarrativeResult> => {
    await supabaseAdmin.from("job_runs").insert({
      job_name: "prediction-narratives",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status,
      result_metric: updated,
      result_detail: { candidates, updated, ai_calls: aiCalls, skipped: skippedBatches, parse_failures: parseFailures, budget_exhausted: budgetExhausted, message },
    });
    return {
      status,
      candidates,
      updated,
      ai_calls: aiCalls,
      skipped: skippedBatches,
      budget_exhausted: budgetExhausted,
      ...(message ? { message } : {}),
    };
  };

  const selection =
    data.rephraseBefore && !Number.isNaN(Date.parse(data.rephraseBefore))
      ? `explanation_he.is.null,explanation_at.lt.${new Date(data.rephraseBefore).toISOString()}`
      : null;
  let query = supabaseAdmin
    .from("predictions")
    .select(
      "id, match_id, predicted_home_score, predicted_away_score, prob_home, prob_draw, prob_away, prob_over_2_5, prob_btts, expected_total_goals, confidence, confidence_band, reason_lines_he",
    )
    .eq("model_version", MODEL_VERSION)
    .order("explanation_he", { ascending: true, nullsFirst: true })
    .order("computed_at", { ascending: false })
    .limit(cap);
  if (selection) query = query.or(selection);
  else if (!data.force) query = query.is("explanation_he", null);

  const { data: rows, error } = await query;
  if (error) return await finish("failed", error.message);

  const pending = (rows ?? []) as Row[];
  candidates = pending.length;
  if (candidates === 0) return await finish("success", "no predictions need phrasing");

  // Team names come from data already stored locally — no external call.
  // Ids are chunked so the PostgREST URL never grows past what the runtime accepts.
  const ID_CHUNK = 100;
  const matchIds = Array.from(new Set(pending.map((p) => p.match_id)));
  const matches: Array<{ id: string; home_team_id: string | null; away_team_id: string | null }> = [];
  for (let i = 0; i < matchIds.length; i += ID_CHUNK) {
    const { data: chunk, error: matchError } = await supabaseAdmin
      .from("matches")
      .select("id, home_team_id, away_team_id")
      .in("id", matchIds.slice(i, i + ID_CHUNK));
    if (matchError) return await finish("failed", matchError.message);
    matches.push(...(chunk ?? []));
  }

  const teamIds = Array.from(
    new Set(matches.flatMap((m) => [m.home_team_id, m.away_team_id]).filter(Boolean)),
  ) as string[];
  const teams: Array<{ id: string; name_he: string | null; name_en: string | null }> = [];
  for (let i = 0; i < teamIds.length; i += ID_CHUNK) {
    const { data: chunk, error: teamError } = await supabaseAdmin
      .from("teams")
      .select("id, name_he, name_en")
      .in("id", teamIds.slice(i, i + ID_CHUNK));
    if (teamError) return await finish("failed", teamError.message);
    teams.push(...(chunk ?? []));
  }

  const teamName = new Map(
    teams.map((t) => [t.id, (t.name_he || t.name_en || null) as string | null]),
  );
  const matchTeams = new Map(
    matches.map((m) => [
      m.id,
      {
        home: m.home_team_id ? (teamName.get(m.home_team_id) ?? null) : null,
        away: m.away_team_id ? (teamName.get(m.away_team_id) ?? null) : null,
      },
    ]),
  );

  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return await finish("failed", "missing LOVABLE_API_KEY");

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);

    const { data: allowed, error: budgetError } = await supabaseAdmin.rpc("api_budget_take", {
      p_provider: PROVIDER,
      p_category: "bulk",
      p_count: 1,
    });
    if (budgetError) return await finish(updated > 0 ? "partial" : "failed", budgetError.message);
    if (allowed !== true) {
      budgetExhausted = true;
      return await finish(updated > 0 ? "partial" : "skipped", "budget exhausted for lovable-ai");
    }

    const items = batch.map((row) =>
      toItem(row, matchTeams.get(row.match_id) ?? { home: null, away: null }),
    );

    let content = "";
    try {
      const res = await fetch(AI_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: AI_MODEL,
          messages: [{ role: "user", content: buildNarrativePrompt(items) }],
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        aiCalls += 1;
        consecutiveFailures += 1;
        skippedBatches += 1;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          return await finish(
            updated > 0 ? "partial" : "failed",
            `stopped after ${consecutiveFailures} consecutive batch failures; ai gateway ${res.status}: ${body.slice(0, 200)}`,
          );
        }
        continue;
      }
      aiCalls += 1;
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      content = String(json.choices?.[0]?.message?.content ?? "");
    } catch (e) {
      consecutiveFailures += 1;
      skippedBatches += 1;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        return await finish(
          updated > 0 ? "partial" : "failed",
          `stopped after ${consecutiveFailures} consecutive batch failures; ai gateway error: ${(e as Error).message}`,
        );
      }
      continue;
    }

    let pairs: Array<{ id: string; text: string }> = [];
    try {
      const cleaned = content.replace(/```json/gi, "").replace(/```/g, "").trim();
      const start = cleaned.indexOf("[");
      const end = cleaned.lastIndexOf("]");
      const slice = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
      const parsed = JSON.parse(slice) as unknown;
      if (Array.isArray(parsed)) {
        pairs = parsed
          .map((p) => {
            const o = (p ?? {}) as Record<string, unknown>;
            return { id: String(o["id"] ?? ""), text: String(o["text"] ?? "").trim() };
          })
          .filter((p) => p.id !== "" && p.text !== "");
      }
    } catch {
      parseFailures += 1;
      consecutiveFailures += 1;
      skippedBatches += 1;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        return await finish(
          updated > 0 ? "partial" : "failed",
          `stopped after ${consecutiveFailures} consecutive batch failures; ai returned invalid JSON`,
        );
      }
      continue;
    }

    const known = new Set(batch.map((b) => b.id));
    const seen = new Set<string>();
    // Per-item validation: a bad item is dropped, the rest of the batch still lands.
    const validPairs = pairs.filter((pair) => {
      if (!known.has(pair.id) || seen.has(pair.id)) return false;
      const ok =
        pair.text.length >= 10 && pair.text.length <= 700 && /[\u0590-\u05FF]/u.test(pair.text);
      if (ok) seen.add(pair.id);
      return ok;
    });

    if (validPairs.length === 0) {
      parseFailures += 1;
      skippedBatches += 1;
      continue;
    }
    if (validPairs.length < batch.length) parseFailures += 1;

    // Safety invariant: no existing explanation is cleared up front. Each row is
    // written only after its own new text has been validated as non-empty Hebrew.
    const stamp = new Date().toISOString();
    for (const pair of validPairs) {
      const { error: updateError, count } = await supabaseAdmin
        .from("predictions")
        .update({ explanation_he: pair.text, explanation_at: stamp }, { count: "exact" })
        .eq("id", pair.id);
      if (!updateError && (count ?? 0) > 0) updated += 1;
    }

  }

  return await finish(updated === candidates ? "success" : "partial");
}
