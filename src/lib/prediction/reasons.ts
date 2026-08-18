/**
 * Deterministic Hebrew phrasing for engine factors.
 * No AI, no randomness. One line per factor, every line carries a number.
 * LTR wrapping of the numbers is the UI's job — here they are plain strings.
 */

import type { Factor } from './types';

function num(value: number | string | undefined): string {
  return value === undefined ? '' : String(value);
}

export function factorToHebrew(factor: Factor): string {
  const v = factor.values;

  switch (factor.key) {
    case 'elo_gap':
      return `${num(v['strongerTeam'])} חזקה יותר בדירוג — פער של ${num(v['gap'])} נקודות`;

    case 'form':
      return `${num(v['teamA'])} אספה ${num(v['pointsA'])} נקודות מ-3 האחרונים מול ${num(
        v['pointsB'],
      )} של ${num(v['teamB'])}`;

    case 'attack_defence':
      return `תוחלת גולים: ${num(v['lambdaHome'])} למארחת מול ${num(v['lambdaAway'])} לאורחת`;

    case 'home_advantage':
      return `יתרון בית ב${num(v['competition'])} — מקדם ${num(v['factor'])}`;

    case 'rest':
      return `ל${num(v['team'])} ${num(v['restLow'])} ימי מנוחה בלבד מול ${num(v['restHigh'])}`;

    case 'estimated_history':
      return `חלק מההיסטוריה מול יריבים שרמתם לא ידועה`;

    case 'low_sample':
      return `מבוסס על ${num(v['matches'])} משחקים בלבד`;

    default:
      return '';
  }
}

export function factorsToHebrew(factors: Factor[]): string[] {
  return factors.map(factorToHebrew).filter((line) => line.length > 0);
}
