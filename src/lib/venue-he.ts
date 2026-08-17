/**
 * Display-only translation layer for venue strings (stadium · city).
 * The raw provider value stays untouched in the database; this maps
 * English names to Hebrew for rendering. Unknown values are returned
 * as-is (never guessed).
 */

const STADIUM_HE: Record<string, string> = {
  "sammy ofer stadium": "אצטדיון סמי עופר",
  bloomfield: "בלומפילד",
  "bloomfield stadium": "אצטדיון בלומפילד",
  "hamoshava stadium": "אצטדיון המושבה",
  "teddy stadium": "אצטדיון טדי",
  "doha stadium": "אצטדיון דוחא",
  "toto turner stadium": "אצטדיון טוטו טרנר",
  "netanya stadium": "אצטדיון נתניה",
  "kiryat shmona municipal stadium": "האצטדיון העירוני קרית שמונה",
  "ramat gan stadium": "אצטדיון רמת גן",
  "tiberias municipal stadium": "האצטדיון העירוני טבריה",
};

const CITY_HE: Record<string, string> = {
  haifa: "חיפה",
  "tel aviv": "תל אביב",
  "petah tikva": "פתח תקווה",
  jerusalem: "ירושלים",
  sakhnin: "סחנין",
  beersheba: "באר שבע",
  netanya: "נתניה",
  "kiryat shmona": "קרית שמונה",
  "ramat gan": "רמת גן",
  tiberias: "טבריה",
};

export type VenuePart = { text: string; isHebrew: boolean };

const norm = (s: string) => s.trim().toLowerCase();

export function translateStadium(name: string): VenuePart {
  const he = STADIUM_HE[norm(name)];
  return he ? { text: he, isHebrew: true } : { text: name.trim(), isHebrew: false };
}

export function translateCity(name: string): VenuePart {
  const he = CITY_HE[norm(name)];
  return he ? { text: he, isHebrew: true } : { text: name.trim(), isHebrew: false };
}

/**
 * Splits a stored venue string ("Stadium · City") and translates each part.
 */
export function translateVenue(venue: string): VenuePart[] {
  const parts = venue.split("·").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return [];
  return parts.map((part, i) => (i === 0 ? translateStadium(part) : translateCity(part)));
}
