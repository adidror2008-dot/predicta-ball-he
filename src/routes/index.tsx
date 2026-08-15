import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import {
  CompetitionChips,
  type Competition,
} from "@/components/predictaball/competition-chips";
import { MatchCard, type MatchCardData } from "@/components/predictaball/match-card";
import { NowMarker } from "@/components/predictaball/now-marker";
import { EmptyState, SkeletonBlock } from "@/components/predictaball/ui-bits";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "PredictaBall — משחקי כדורגל ותחזיות" },
      {
        name: "description",
        content: "לוח משחקי כדורגל, תוצאות ותחזית סטטיסטית מוסברת לכל משחק.",
      },
      { property: "og:title", content: "PredictaBall — משחקי כדורגל ותחזיות" },
      {
        property: "og:description",
        content: "לוח משחקי כדורגל, תוצאות ותחזית סטטיסטית מוסברת לכל משחק.",
      },
    ],
  }),
  component: MatchesScreen,
});

const TAB_KEY = "pb:matches:activeCompetition";
const SCROLL_KEY = "pb:matches:scrollY";

type MatchGroup = { date: string; showNowMarker: boolean; matches: MatchCardData[] };

function MatchesScreen() {
  const competitions: Competition[] = [];
  const groups: MatchGroup[] = [];
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const restored = useRef(false);

  useEffect(() => {
    const saved = sessionStorage.getItem(TAB_KEY);
    if (saved) setActiveId(saved);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (loading || restored.current) return;
    restored.current = true;
    const y = Number(sessionStorage.getItem(SCROLL_KEY) ?? 0);
    if (y > 0) window.scrollTo(0, y);
  }, [loading]);

  useEffect(() => {
    const onScroll = () => sessionStorage.setItem(SCROLL_KEY, String(window.scrollY));
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const selectCompetition = (id: string) => {
    setActiveId(id);
    sessionStorage.setItem(TAB_KEY, id);
  };

  return (
    <main className="px-4 pt-5">
      <header className="mb-4 flex items-center justify-between gap-3">
        <h1 className="font-brand text-2xl font-extrabold">
          <span className="text-foreground">Predicta</span>
          <span className="text-brand-gradient">Ball</span>
        </h1>
        <button
          type="button"
          aria-label="רענון"
          className="rounded-2xl bg-surface p-2.5 text-muted-foreground transition-colors active:bg-surface-2"
        >
          <RotateCw className="size-4" aria-hidden />
        </button>
      </header>

      <CompetitionChips
        competitions={competitions}
        activeId={activeId}
        onSelect={selectCompetition}
      />

      <section className="mt-4 space-y-3">
        {loading ? (
          <>
            <SkeletonBlock className="h-24" />
            <SkeletonBlock className="h-24" />
            <SkeletonBlock className="h-24" />
          </>
        ) : groups.length === 0 ? (
          <EmptyState text="אין משחקים להצגה כרגע" />
        ) : (
          groups.map((group) => (
            <div key={group.date}>
              <h2 className="mb-2 text-xs font-medium text-muted-foreground">
                <span dir="ltr">{group.date}</span>
              </h2>
              {group.showNowMarker ? <NowMarker /> : null}
              <div className="space-y-3">
                {group.matches.map((m) => (
                  <MatchCard key={m.id} match={m} />
                ))}
              </div>
            </div>
          ))
        )}
      </section>
    </main>
  );
}
