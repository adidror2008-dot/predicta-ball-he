# בק-טסט למנוע התחזיות v7.0 — תוכנית

עבודת מסד פנימית בלבד. אפס קריאות API יוצאות. TanStack Start + `createServerFn`.

## 1. אימות עובדות מול המסד (בוצע עכשיו)

| עובדה | תוצאה |
|---|---|
| משחקים `finished` עם שתי תוצאות | **552** (28/10/2025 → 23/08/2026) — תואם |
| שורות ב-`prediction_outcomes` | **59**, מ-18/08/2026 — תואם |
| `team_match_history` / `team_history` | 6,807 / 6,808 — תואם |
| `team_aliases` | 0 שורות (ClubElo אכן מנותק) — תואם |
| `model_config` | 30 מפתחות, `model_version = v7.0` — תואם |
| **בני-בק-טסט אחרי כלל 3+** | **430** מתוך 552 (לפחות 3 משחקי היסטוריה קודמים לכל צד לפני ה-kickoff) |

**מי מחשב תחזית v7 היום:** `runPredictions()` ב-`src/lib/run-predictions.server.ts` (מופעל מ-`runPredictionsFn` וגם מ-`/api/cron/refresh`). הוא קורא `model_config` → `ModelConfig`, ומריץ את הפונקציה הטהורה `computePrediction()` מ-`src/lib/prediction-engine.ts`.

**מאיפה מגיעים ה-Elo והכושר:**
- Elo פנימי של כל קבוצה: עמודה `teams.elo_internal`.
- Elo של היריב בכל משחק היסטורי: עמודה `team_match_history.opponent_elo`.
- כושר: 10 המשחקים האחרונים מ-`team_match_history` (`goals_for/goals_against/tournament_type/opponent_elo`, ללא `youth`), עם דעיכת recency ומשקלי יריב.
- שתי עמודות ה-Elo נכתבות ע"י `recompute_internal_elo()` — ריצה של **6 מעברים** על *כל* ההיסטוריה (BASE 1500, K=20, HFA 65, מכפיל הפרש שערים).

## 2. מניעת דליפת נתונים (data leakage)

זו הנקודה הקריטית: ה-Elo שבמסד היום הוא תוצר של 6 מעברים על כל ההיסטוריה, כולל משחקים **אחרי** ה-kickoff של כל משחק שנרצה לבק-טסט. שימוש בו = דליפה מוחלטת. לכן הבק-טסט לא ייגע בעמודות האלה כלל.

השחזור נכון-לתאריך:
1. בונים "לוח משחקים" ייחודי מ-`team_match_history` (dedupe לפי `external_match_id`, כמו ב-`recompute_internal_elo`) וממיינים כרונולוגית עולה.
2. מעבר **יחיד קדימה** בזיכרון (בלי 6 מעברים — 6 מעברים הם עצמם דליפה): מחזיקים `Map<external_id, {rating, played, results[]}>`.
3. לכל משחק בתור, **לפני** העדכון: זו נקודת ההערכה. אם המשחק הוא אחד מ-430 המועמדים — מחשבים תחזית עם המצב הנוכחי של המפה בלבד:
   - `homeElo/awayElo` = הדירוג הנוכחי במפה (או `null` אם `played < 3`, בדיוק כמו הכלל הקיים).
   - היסטוריה של כל צד = עד 10 המשחקים האחרונים שכבר עברו במפה, כשה-`opponentElo` של כל אחד מהם הוא הדירוג של אותו יריב **כפי שהיה באותו רגע** (נשמר יחד עם הרשומה בזמן המעבר).
   - `restDays` = מהמשחק הקודם של אותה קבוצה במעבר.
   - `avgTotalGoals` / `homeAdvantage` של התחרות: נלקחים מ-`competitions`. אלה ערכים מדודים על כל העונה ולכן דליפה חלשה — התוכנית מחשבת אותם גם הם מצטברים-לתאריך (ממוצע שערים של אותה תחרות עד אותו יום, ורק אם יש ≥30 משחקים; אחרת fallback ל-`global_avg_goals_*` שב-config). `home_advantage` נשאר כפי שהוא במסד ומתועד כהנחה.
4. אחרי ההערכה — מעדכנים את ה-Elo באותה נוסחה בדיוק של `recompute_internal_elo` ועוברים למשחק הבא.

`computePrediction()` עצמה נשארת ללא שינוי: אותה פונקציה טהורה, אותם פרמטרים.

## 3. אכיפת 3+ משחקי היסטוריה

לא סינון מקדים ידני — נשענים על אותה נקודת אמת: `computePrediction` מחזירה `null` כשלצד כלשהו יש פחות מ-`history_min_matches` (=3) משחקים שמישים. משחק כזה נספר כ-`skipped_insufficient_history` ולא נכנס לאף מדד. לפי המסד ההערכה היא ~430 בתוך המדגם.

## 4. שמירת תוצאות — טבלאות חדשות ונפרדות

לא נוגעים ב-`predictions`, `prediction_outcomes`, ובאף view דיוק קיים.

מיגרציה חדשה (עם `GRANT` ו-RLS, קריאה לאדמין בלבד):

- `backtest_runs` — `id`, `label`, `model_version`, `config_overrides jsonb`, `params_effective jsonb` (כל 30 המפתחות בפועל), `n_matches`, `n_skipped`, `avg_rps`, `avg_brier`, `pct_winner`, `pct_exact`, `pct_goal_bucket`, `pct_ou25`, `naive_pct_winner`, `avg_goals_abs_error`, `date_from`, `date_to`, `created_at`, `duration_ms`.
- `backtest_results` — שורה למשחק: `run_id` (FK, `on delete cascade`), `match_id`, `kickoff_at`, `competition_id`, `pred_home/pred_away`, `actual_home/actual_away`, `prob_home/draw/away`, `lambda_home/away`, `rps`, `brier`, `hit_winner`, `hit_exact`, `hit_goal_bucket`, `hit_ou25`, `confidence`, `confidence_band`, `elo_home_at_kickoff`, `elo_away_at_kickoff`. אינדקס על `run_id`.

RPS ו-Brier מחושבים בדיוק באותן נוסחאות שבהן משתמש `pb_settle_finished_matches` כיום, כדי שהמספרים יהיו בני-השוואה ל-59 החיים.

## 5. Parameter sweep בלי לשנות קוד

`runBacktest(input)` (ב-`src/lib/backtest.server.ts`, נקרא דרך `createServerFn` מוגן ב-`CRON_SECRET`) מקבל:

```
{ label?: string,
  overrides?: Record<string, number>,   // למשל { recency_decay: 0.9, shrinkage_k: 2 }
  dateFrom?: string, dateTo?: string,
  competitionIds?: string[] }
```

הבסיס תמיד נקרא מ-`model_config`; `overrides` ממוזג עליו **בזיכרון בלבד** — הטבלה החיה לא משתנה אף פעם. כל ריצה שומרת את `params_effective` המלא, כך שכל שורה ב-`backtest_runs` ניתנת לשחזור מדויק.

בנוסף `runBacktestSweep({ grid, ... })` שמקבל רשת ערכים, למשל:

```
{ recency_decay: [0.80, 0.85, 0.90],
  shrinkage_k:   [2, 4, 6],
  history_max_matches: [8, 10, 15] }
```

מריץ מכפלה קרטזית (27 ריצות בדוגמה), שומר `backtest_runs` לכל שילוב, ומחזיר טבלה ממוינת לפי `avg_rps` עולה. אופטימיזציה: מעבר ה-Elo הכרונולוגי מחושב **פעם אחת** ונשמר בזיכרון (הוא לא תלוי בפרמטרי המנוע, רק ב-K/HFA הקבועים), וכל שילוב פרמטרים מריץ מחדש רק את `computePrediction` — 430 חישובים למילישניות ספורות.

אימוץ הגדרה מנצחת נשאר פעולה ידנית ומפורשת שלך (UPDATE ל-`model_config`) — הבק-טסט לעולם לא כותב לשם.

## מה ייבנה בפועל

1. מיגרציה: `backtest_runs` + `backtest_results` (+ GRANT + RLS).
2. `src/lib/backtest.server.ts` — בונה לוח כרונולוגי, מעבר Elo נקודת-זמן, קריאה ל-`computePrediction`, ניקוד, כתיבה.
3. `src/lib/backtest.functions.ts` — `runBacktestFn` / `runBacktestSweepFn` מוגנות ב-`x-cron-secret`.
4. הרצת בסיס אחת (פרמטרים נוכחיים) + sweep ראשוני, ודיווח מספרי מלא: n, RPS, Brier, מנצח, מדויקת, מול הבסיס הנאיבי ומול 59 המשחקים החיים.
5. `tsgo --noEmit` · `build` · בלי `console.log`, בלי הקסים גולמיים.

לא נדרשת שום קריאה חיצונית לאורך כל המשימה.
