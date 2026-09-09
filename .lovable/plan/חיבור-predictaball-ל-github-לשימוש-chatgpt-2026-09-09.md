# חיבור PredictaBall ל-GitHub לשימוש ChatGPT

## מטרה
לאפשר ל-ChatGPT (או לכל עוזר AI/מפתח אחר) לגשת לקוד המקור של PredictaBall ולעזור בפיתוח, באמצעות סנכרון GitHub דו-כיווני.

## שלבי הפעולה

### 1. חיבור GitHub דרך ממשק Lovable
```text
בעורך Lovable:
  Plus (+) menu (שמאלית למטה בשדה הצ'אט)
  → GitHub
  → Connect project
  → אשר את אפליקציית Lovable ב-GitHub
  → בחר חשבון/ארגון GitHub
  → Create Repository
```

### 2. הפרטים שיש לשתף עם ChatGPT
לאחר יצירת המאגר, שתף את ChatGPT ב:
- **Repository URL** — לדוגמה `https://github.com/<your-username>/predictaball`
- **Branch עיקרי** — בדרך כלל `main`
- **טכנולוגיות** — TanStack Start, React 19, TypeScript, Tailwind CSS v4, Supabase (Lovable Cloud)
- **נקודות קצה חשובות** — קוד נמצא תחת `src/`, נתיבים תחת `src/routes/`, לוגיקת שרת ב-`src/lib/*.server.ts` וב-`createServerFn`

### 3. איך ChatGPT יכול לעזור
- קריאת קבצים ישירות מה-repo ב-GitHub.
- הצעת שינויים בקוד דרך Pull Request או עריכה ישירה ב-branch.
- שינויים שידחפו ל-GitHub יסתנכרנו אוטומטית חזרה ל-Lovable.

### 4. הגבלות ושימו לב
- **סודות ו-API keys** לא נשמרים ב-GitHub; הם נשארים ב-Lovable Secrets. אל תעתיק אותם לתוך השיחה עם ChatGPT.
- **נתוני דאטאבייס** לא נכללים ב-repo; נדרשת גישה נפרדת ל-Lovable Cloud אם ChatGPT צריך לבדוק נתונים.
- **תלות ב-build**: שינויים ש-ChatGPT מציע צריכים לעבור `type-check` ו-`build` לפני מיזוג.

## תוצאה צפויה
PredictaBall מחובר למאגר GitHub פרטי/ציבורי, ו-ChatGPT יכול לקבל את כתובת המאגר ולעבוד על הקוד מחוץ ל-Lovable.
