/**
 * Turns engine factors into short Hebrew lines.
 *
 * This is the DETERMINISTIC fallback and the source of truth for what may be said.
 * The AI phrasing layer is allowed to reword these lines only. It may never add a
 * reason, drop a number, or reorder by anything other than the engine's impact score.
 *
 * Rules enforced here:
 *   - at most 3 lines
 *   - every line contains a real number that came from the engine
 *   - no line may claim anything the factor data does not contain
 */

import type { PredictionFactor } from './types';

/** Wraps a number so it renders left-to-right inside Hebrew RTL text. */
function ltr(value: number | string): string {
  return `\u200E${value}\u200E`;
}

export function factorToHebrew(factor: PredictionFactor): string {
  const v = factor.values;

  switch (factor.type) {
    case 'elo_gap':
      return `${v.strongerTeam} חזקה יותר בדירוג — פער של ${ltr(v.gap as number)} נקודות`;

    case 'form':
      return `${v.betterTeam} בכושר טוב יותר — ${ltr(
        factor.side === 'home' ? (v.homePoints as number) : (v.awayPoints as number),
      )} נקודות מ-${ltr(3)} האחרונים מול ${ltr(
        factor.side === 'home' ? (v.awayPoints as number) : (v.homePoints as number),
      )}`;

    case 'attack':
      return `${v.team} כובשת ${ltr(v.goalsPerMatch as number)} גולים למשחק בממוצע`;

    case 'defence':
      return `${v.team} מקבלת רק ${ltr(v.concededPerMatch as number)} גולים למשחק`;

    case 'home_advantage':
      return `יתרון בית משמעותי ב${v.competition} — מקדם ${ltr(v.factor as number)}`;

    case 'rest': {
      const homeRest = v.homeRestDays as number;
      const awayRest = v.awayRestDays as number;
      const fresher = factor.side === 'home' ? homeRest : awayRest;
      const tired = factor.side === 'home' ? awayRest : homeRest;
      return `פער מנוחה — ${ltr(fresher)} ימים מול ${ltr(tired)} ימים ליריבה`;
    }

    case 'h2h':
      return `במפגשים הקודמים: ${ltr(v.homeWins as number)}-${ltr(
        v.awayWins as number,
      )} מתוך ${ltr(v.meetings as number)} משחקים`;

    case 'thin_data':
      return `בסיס נתונים דק — ${ltr(v.homeMatches as number)} ו-${ltr(
        v.awayMatches as number,
      )} משחקים בלבד. הביטחון בתחזית נמוך בהתאם`;

    default:
      return '';
  }
}

export function factorsToHebrewLines(factors: PredictionFactor[]): string[] {
  return factors.map(factorToHebrew).filter((line) => line.length > 0).slice(0, 3);
}

/**
 * The prompt handed to the AI phrasing layer.
 * Deliberately closed: the model receives ONLY these lines and may only reword them.
 */
export function buildPhrasingPrompt(lines: string[]): string {
  return [
    'נסח מחדש את השורות הבאות בעברית טבעית וקצרה.',
    'חוקים מוחלטים:',
    '1. אסור להוסיף מידע, סיבה או מספר שלא מופיע כאן.',
    '2. אסור להשמיט אף מספר.',
    '3. כל שורה עד 12 מילים.',
    '4. שמור על אותו סדר השורות.',
    '5. החזר JSON בלבד: {"lines": ["...", "..."]}',
    '',
    'השורות:',
    ...lines.map((line, i) => `${i + 1}. ${line}`),
  ].join('\n');
}
