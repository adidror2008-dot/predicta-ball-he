import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { EmptyState, LogoSlot } from "@/components/predictaball/ui-bits";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/match/$id")({
  head: () => ({
    meta: [
      { title: "פרטי משחק — PredictaBall" },
      {
        name: "description",
        content: "הרכבים, אירועים, סטטיסטיקות, דירוגים, טבלה ותחזית למשחק.",
      },
      { property: "og:title", content: "פרטי משחק — PredictaBall" },
      {
        property: "og:description",
        content: "הרכבים, אירועים, סטטיסטיקות, דירוגים, טבלה ותחזית למשחק.",
      },
    ],
  }),
  component: MatchPage,
});

const tabs = [
  { id: "lineups", label: "הרכבים", empty: "טרם פורסם הרכב רשמי" },
  { id: "events", label: "אירועים", empty: "אין אירועים להצגה" },
  { id: "stats", label: "סטטיסטיקות", empty: "אין סטטיסטיקות להצגה" },
  { id: "ratings", label: "דירוגים", empty: "אין דירוגים להצגה" },
  { id: "table", label: "טבלה", empty: "הטבלה תתעדכן עם תחילת העונה" },
  { id: "forecast", label: "תחזית", empty: "אין מספיק נתונים לתחזית" },
] as const;

function MatchPage() {
  const [active, setActive] = useState<(typeof tabs)[number]["id"]>("lineups");
  const activeTab = tabs.find((t) => t.id === active)!;

  return (
    <main className="px-4 pt-5">
      <header className="mb-4 flex items-center gap-2">
        <Link
          to="/"
          aria-label="חזרה"
          className="rounded-2xl bg-surface p-2 text-muted-foreground"
        >
          <ChevronRight className="size-4" aria-hidden />
        </Link>
        <h1 className="text-lg font-bold">פרטי משחק</h1>
      </header>

      <section className="rounded-2xl bg-card p-4 shadow-card">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-1 flex-col items-center gap-2">
            <LogoSlot className="size-12" />
            <span className="text-xs text-muted-foreground">—</span>
          </div>
          <span dir="ltr" className="text-2xl font-bold text-muted-foreground">
            —
          </span>
          <div className="flex flex-1 flex-col items-center gap-2">
            <LogoSlot className="size-12" />
            <span className="text-xs text-muted-foreground">—</span>
          </div>
        </div>
      </section>

      <div className="scrollbar-none -mx-4 mt-4 flex gap-2 overflow-x-auto px-4">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActive(tab.id)}
            className={cn(
              "shrink-0 rounded-2xl px-3 py-1.5 text-xs font-medium transition-colors",
              active === tab.id
                ? "bg-brand-gradient text-brand-foreground"
                : "bg-surface text-muted-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <section className="mt-4">
        <EmptyState text={activeTab.empty} />
      </section>
    </main>
  );
}
