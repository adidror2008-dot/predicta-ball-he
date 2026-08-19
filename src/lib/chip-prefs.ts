import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ChipPrefs = {
  /** null = כל התחרויות מסומנות (ברירת מחדל) */
  selected: string[] | null;
  order: string[];
};

const STORAGE_KEY = "pb:chips:prefs";
const EMPTY: ChipPrefs = { selected: null, order: [] };

function parse(raw: unknown): ChipPrefs | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<ChipPrefs>;
  const order = Array.isArray(value.order) ? value.order.filter((v) => typeof v === "string") : [];
  const selected = Array.isArray(value.selected)
    ? value.selected.filter((v) => typeof v === "string")
    : null;
  return { selected, order };
}

function readLocal(): ChipPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    return parse(JSON.parse(raw)) ?? EMPTY;
  } catch {
    return EMPTY;
  }
}

function writeLocal(prefs: ChipPrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* אחסון מקומי לא זמין — ההעדפות יישארו לסשן הנוכחי בלבד */
  }
}

/**
 * העדפות תגיות התחרויות: נשמרות מקומית במכשיר, ומסונכרנות
 * ל-user_preferences.chip_order כשקיים משתמש מחובר.
 */
export function useChipPrefs() {
  const [prefs, setPrefs] = useState<ChipPrefs>(EMPTY);
  const [hydrated, setHydrated] = useState(false);
  const userId = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    setPrefs(readLocal());
    setHydrated(true);

    void (async () => {
      const { data } = await supabase.auth.getSession();
      const id = data.session?.user.id ?? null;
      if (!active || !id) return;
      userId.current = id;
      const { data: row } = await supabase
        .from("user_preferences")
        .select("chip_order")
        .eq("user_id", id)
        .maybeSingle();
      const remote = parse(row?.chip_order);
      if (active && remote) {
        setPrefs(remote);
        writeLocal(remote);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const update = useCallback((next: ChipPrefs) => {
    setPrefs(next);
    writeLocal(next);
    const id = userId.current;
    if (!id) return;
    void supabase
      .from("user_preferences")
      .upsert({ user_id: id, chip_order: next }, { onConflict: "user_id" });
  }, []);

  return { prefs, hydrated, update };
}

/** מיון רשימת מזהים לפי הסדר השמור; פריטים חדשים נשארים בסוף. */
export function applyOrder<T extends { id: string }>(items: T[], order: string[]): T[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...items].sort((a, b) => {
    const ra = rank.get(a.id);
    const rb = rank.get(b.id);
    if (ra === undefined && rb === undefined) return 0;
    if (ra === undefined) return 1;
    if (rb === undefined) return -1;
    return ra - rb;
  });
}
