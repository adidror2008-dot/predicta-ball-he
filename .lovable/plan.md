# תיאום התוצאה המדויקת עם המנצח החזוי (1X2)

## דיווח Pre-flight (נבדק בפועל)

1. **איפה נבחרת התוצאה המדויקת**: בקובץ `src/lib/prediction-engine.ts`, בתוך `computePrediction`, בלולאה שסורקת את מטריצת הפואסון (`if (p > bestP) { bestP = p; bestI = i; bestJ = j; }`) והתוצאה נכתבת כ-`predictedHomeScore: bestI` / `predictedAwayScore: bestJ`. אין בחירה ב-SQL ואין argmax בשכבת התצוגה — הקומפוננטה `match-prediction-section.tsx` רק מציגה את מה שנשמר ב-`predictions`.
2. **זמינות המטריצה**: המטריצה המלאה זמינה בדיוק בנקודת הבחירה (נבנית שם באותה פונקציה). התיקון אפשרי במקום הנכון. (קיים גם מנוע שני, `src/lib/prediction/engine.ts`, אך הוא לא בשימוש בצינור ההרצה — `run-predictions.server.ts` מייבא מ-`prediction-engine.ts` בלבד.)
3. **היקף הבעיה במסד**: מתוך 1,394 תחזיות `v7.0`, ב-**823** התוצאה המדויקת סותרת את המנצח לפי 1X2.

## מה ישתנה

בקובץ `src/lib/prediction-engine.ts` בלבד:
- לאחר חישוב `probHome / probDraw / probAway` (ללא שינוי בערכיהם), נקבע התוצאה הסבירה ביותר **בתוך** התוצאה שתואמת את המקסימום מבין השלושה:
  - `probHome` הגבוה → התא הכי סביר עם `i > j`
  - `probAway` הגבוה → התא הכי סביר עם `i < j`
  - `probDraw` הגבוה → התא הכי סביר עם `i === j`
- שובר שוויון: אותה הסתברות → פחות שערים כולל, ואז יתרון לצד הבית.
- כל השאר נשאר בדיוק כפי שהוא: מטריצה, `lambdaHome/lambdaAway`, `probHome/probDraw/probAway`, `expectedTotalGoals`, `probOver25`, `probUnder25`, `probBtts`, דליי השערים, confidence, factors.

## מילוי מחדש של הנתונים

הרצה אחת של `runPredictions()` (ללא שום קריאה חיצונית — קורא מהמסד בלבד) כדי לעדכן `predicted_home_score` / `predicted_away_score` בכל התחזיות של משחקים עתידיים. אחריה שאילתת אימות שמראה שמספר הסתירות הוא 0.

## אימות לפני סיום

`bunx tsgo --noEmit` · `bun run build` · הרצת `src/lib/prediction-engine.test.ts` · דיווח מספרי לפני/אחרי.
