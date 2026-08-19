import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { SkeletonBlock } from "@/components/predictaball/ui-bits";
import { cn } from "@/lib/utils";

export type PickerCompetition = {
  id: string;
  name: string;
  nameEn: string | null;
  country: string | null;
  hasMatches: boolean;
};

const COUNTRY_HE: Record<string, string> = {
  Israel: "ישראל",
  England: "אנגליה",
  Spain: "ספרד",
  Italy: "איטליה",
  Germany: "גרמניה",
  France: "צרפת",
  Portugal: "פורטוגל",
  Netherlands: "הולנד",
  Brazil: "ברזיל",
  Argentina: "ארגנטינה",
  Europe: "אירופה",
  World: "עולמי",
};

function countryLabel(country: string | null) {
  if (!country) return null;
  return COUNTRY_HE[country] ?? country;
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

export function CompetitionPickerSheet({
  open,
  onOpenChange,
  competitions,
  isLoading,
  selectedIds,
  onToggle,
  onSelectAll,
  onClearAll,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  competitions: PickerCompetition[];
  isLoading: boolean;
  selectedIds: string[];
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}) {
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = normalize(query);
    if (!q) return competitions;
    return competitions.filter((c) => {
      const country = countryLabel(c.country);
      return [c.name, c.nameEn ?? "", c.country ?? "", country ?? ""]
        .map(normalize)
        .some((v) => v.includes(q));
    });
  }, [competitions, query]);

  const selected = new Set(selectedIds);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85svh] rounded-t-3xl border-border bg-card">
        <SheetHeader className="text-start">
          <SheetTitle className="text-base">תחרויות להצגה</SheetTitle>
        </SheetHeader>

        <div className="relative mt-3">
          <Search
            className="pointer-events-none absolute top-1/2 start-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="חיפוש לפי תחרות או מדינה"
            aria-label="חיפוש תחרות"
            className="bg-surface-2 ps-9 text-sm"
          />
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={onSelectAll}
            className="rounded-2xl bg-surface-2 px-3 py-1.5 text-xs font-medium text-foreground"
          >
            בחירת הכול
          </button>
          <button
            type="button"
            onClick={onClearAll}
            className="rounded-2xl bg-surface-2 px-3 py-1.5 text-xs font-medium text-muted-foreground"
          >
            ניקוי הכול
          </button>
        </div>

        <div className="mt-3 max-h-[52svh] space-y-2 overflow-y-auto pb-6">
          {isLoading ? (
            <>
              <SkeletonBlock className="h-14" />
              <SkeletonBlock className="h-14" />
              <SkeletonBlock className="h-14" />
            </>
          ) : results.length === 0 ? (
            <p className="rounded-2xl bg-surface-2 px-4 py-8 text-center text-sm text-muted-foreground">
              לא נמצאו תחרויות מתאימות
            </p>
          ) : (
            results.map((c) => {
              const isSelected = selected.has(c.id);
              const country = countryLabel(c.country);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onToggle(c.id)}
                  aria-pressed={isSelected}
                  className="flex w-full items-center justify-between gap-3 rounded-2xl bg-surface-2 px-4 py-3 text-start"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{c.name}</span>
                    {country || !c.hasMatches ? (
                      <span className="block text-xs text-muted-foreground">
                        {[country, c.hasMatches ? null : "אין משחקים כרגע"]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    ) : null}
                  </span>
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full border transition-colors",
                      isSelected
                        ? "border-transparent bg-brand-gradient text-brand-foreground"
                        : "border-border text-transparent",
                    )}
                  >
                    <Check className="size-3.5" aria-hidden />
                  </span>
                </button>
              );
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
