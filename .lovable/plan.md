# בדיקת פער ספירה מול RapidAPI (sportapi7) — ממצאים בלבד

## 1. רשימת כל מקומות הקריאה ל-sportapi7

| קובץ | פונקציה | עובר דרך השער? | קטגוריה | הערה |
|---|---|---|---|---|
| src/lib/tick.server.ts | runTick (`call`) | כן | live | שער לפני כל קריאה; גם pause + noteProviderResponse |
| src/lib/tick.server.ts | קטע הרכבים | כן (בתוך fetch-match-lineups) | lineups | קורא לפונקציית ההרכבים שמבצעת שער בעצמה |
| src/lib/catch-up-matches.server.ts | runCatchUp | כן | bulk | תקרה של 4 קריאות לסבב |
| src/lib/sync-competition.server.ts | runSyncCompetition | כן | bulk | שער לכל עמוד בלולאת ה-pagination |
| src/lib/fetch-match-lineups.server.ts | runFetchMatchLineups | כן | lineups | קריאה בודדת |
| src/lib/fetch-match-stats.server.ts | runFetchMatchStats | כן | bulk | קריאה בודדת |
| src/lib/fetch-match-incidents.server.ts | runFetchMatchIncidents | כן | bulk | קריאה בודדת |
| src/lib/fetch-match-details.server.ts | runFetchMatchDetails | כן | lineups + bulk | שתי קריאות, כל אחת עם שער נפרד — תקין |
| src/lib/fetch-match-venues.server.ts | runFetchMatchVenues | כן | bulk | שער בתוך הלולאה, קריאה לכל קבוצה |
| src/lib/fetch-team-logos-names.server.ts | runFetchTeamLogos | כן | bulk | שער לכל קבוצה |
| src/lib/fetch-team-history.server.ts | runFetchTeamHistory | כן | bulk | שער לכל קבוצה |
| src/lib/cleanup-stuck-matches.server.ts | runCleanupStuck | כן | live | שער לכל קריאה |
| src/lib/discover-seasons.server.ts | runDiscoverSeasons | כן | bulk | כלי אבחון, שער לכל טורניר |
| src/lib/verify-endpoints.server.ts | runVerifyEndpoints | כן | bulk | כלי אבחון ותיק — עדיין קיים ופעיל |
| src/lib/fetch-player-photos.server.ts | runFetchPlayerPhotos | כן (bulk) | bulk | לא פונה ל-RapidAPI אלא ל-img.sofascore.com — צורך מכסה פנימית אך לא מכסת הספק |

לא נמצא אף מקום שמבצע fetch ל-sportapi7 בלי `api_budget_take` לפניו, ואף לולאת retry אוטומטית.

## 2. מקומות שבהם "1" לא שווה בקשה אחת

- אין. כל לולאה (עמודים, קבוצות, משחקים) לוקחת שער לכל בקשה בנפרד.
- הכיוון ההפוך קיים: `fetch-player-photos` **מגדיל** את המונה הפנימי בלי לבצע בקשה ל-RapidAPI — כלומר המונה שלנו לפעמים גבוה מהמציאות, לא נמוך.

## 3. נקודות קצה אבחוניות/נטושות שעדיין קיימות

- `/api/public/verify-endpoints` (מוגן ב-`x-cron-secret`, כן עובר שער) — עד ~10 קריאות לריצה.
- `/api/public/discover-seasons` (אותו הדבר).
- **חשוב יותר**: כל קובצי `*.functions.ts` שמריצים משיכות מהספק (tick, sync-competition, fetch-match-*, verify-endpoints, discover-seasons) הם `createServerFn` **ללא `requireSupabaseAuth`** — כלומר נקודות RPC ציבוריות באפליקציה המפורסמת. הן כן עוברות דרך השער, אז הן נספרות אצלנו, אבל כל אחת יכולה לשרוף מכסה אמיתית.

## 4. המספרים בפועל (קריאה בלבד מהמסד)

- `api_usage_daily` / sofascore: אוגוסט 7,083 · ספטמבר 4,965 · **סה"כ מ-15/8: 12,048** (bulk 5,292 · live 5,830 · lineups 926).
- התקרה הפנימית ב-`api_quotas` היא 9,500 לחודש קלנדרי, יומית 700.
- הפער מול "10,300 מ-23/8" נובע מכך שהספירה החודשית שלנו היא **לפי חודש קלנדרי UTC**, בעוד RapidAPI סופר לפי **מחזור חיוב מתאריך המנוי**. מחזור שמתחיל באמצע אוגוסט אוסף גם את שארית אוגוסט וגם את ספטמבר — קרוב מאוד ל-15,000.

## 5. הצעד הבא המומלץ (ללא שינוי קוד עכשיו)

1. לאמת בדף המנוי ב-RapidAPI את **תאריך תחילת מחזור החיוב** ואת מספר הקריאות שהספק מציג, ולהשוות לסכום שלנו לאותו טווח בדיוק.
2. אם הפער נשאר גדול גם אחרי יישור התאריכים — לבדוק האם קיים מפתח RapidAPI זהה בשימוש בסביבה נוספת.
3. רק לאחר האימות, ובאישור נפרד, לשקול שינויי קוד: ספירה לפי מחזור חיוב במקום חודש קלנדרי, הוצאת תמונות השחקנים מהמונה של הספק, והגנה על נקודות ה-RPC התפעוליות.
