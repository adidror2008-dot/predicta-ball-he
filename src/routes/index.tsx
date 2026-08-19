import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import {
  CompetitionChips,
  type Competition,
} from "@/components/predictaball/competition-chips";
import {
  CompetitionPickerSheet,
  type PickerCompetition,
} from "@/components/predictaball/competition-picker-sheet";
import { MatchCard, type MatchCardData, type MatchStatus } from "@/components/predictaball/match-card";
import { EmptyState, SkeletonBlock } from "@/components/predictaball/ui-bits";
import { getMatchesListFn } from "@/lib/matches-list.functions";
import { getCompetitionsListFn } from "@/lib/competitions-list.functions";
import { applyOrder, useChipPrefs } from "@/lib/chip-prefs";


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
const OTHER = "__other__";

function toStatus(status: string | null): MatchStatus {
  if (status === "finished" || status === "ended" || status === "afterET" || status === "ap") {
    return "finished";
  }
  if (status === "inprogress" || status === "live" || status === "halftime") return "live";
  return "scheduled";
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function MatchesScreen() {
  const fetchMatches = useServerFn(getMatchesListFn);
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["matches-list"],
    queryFn: () => fetchMatches(),
  });

  const [activeId, setActiveId] = useState<string | null>(null);
  const restored = useRef(false);

  const matches = useMemo(() => data ?? [], [data]);

  const competitions = useMemo<Competition[]>(() => {
    const map = new Map<string, string>();
    for (const m of matches) {
      const id = m.competitionId ?? OTHER;
      const name = m.competitionName ?? "משחקים נוספים";
      if (!map.has(id)) map.set(id, name);
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name, hasMatches: true }));
  }, [matches]);

  useEffect(() => {
    const saved = sessionStorage.getItem(TAB_KEY);
    if (saved) setActiveId(saved);
  }, []);

  useEffect(() => {
    if (isLoading || restored.current) return;
    restored.current = true;
    const y = Number(sessionStorage.getItem(SCROLL_KEY) ?? 0);
    if (y > 0) window.scrollTo(0, y);
  }, [isLoading]);

  useEffect(() => {
    const onScroll = () => sessionStorage.setItem(SCROLL_KEY, String(window.scrollY));
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const selectCompetition = (id: string) => {
    const next = activeId === id ? null : id;
    setActiveId(next);
    if (next) sessionStorage.setItem(TAB_KEY, next);
    else sessionStorage.removeItem(TAB_KEY);
  };

  const groups = useMemo(() => {
    const filtered = activeId
      ? matches.filter((m) => (m.competitionId ?? OTHER) === activeId)
      : matches;

    const byComp = new Map<string, { name: string; matches: MatchCardData[] }>();
    for (const m of filtered) {
      const key = m.competitionId ?? OTHER;
      const name = m.competitionName ?? "משחקים נוספים";
      if (!byComp.has(key)) byComp.set(key, { name, matches: [] });
      byComp.get(key)!.matches.push({
        id: m.id,
        homeName: m.homeName,
        awayName: m.awayName,
        homeLogo: m.homeLogo,
        awayLogo: m.awayLogo,
        homeScore: m.homeScore,
        awayScore: m.awayScore,
        kickoffTime: formatTime(m.kickoffAt),
        date: formatDate(m.kickoffAt),
        status: toStatus(m.status),
      });
    }
    return Array.from(byComp.entries()).map(([id, g]) => ({ id, ...g }));
  }, [matches, activeId]);

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
          onClick={() => refetch()}
          className="rounded-2xl bg-surface p-2.5 text-muted-foreground transition-colors active:bg-surface-2"
        >
          <RotateCw className={isFetching ? "size-4 animate-spin" : "size-4"} aria-hidden />
        </button>
      </header>

      <CompetitionChips
        competitions={competitions}
        activeId={activeId}
        onSelect={selectCompetition}
      />

      <section className="mt-4 space-y-5">
        {isLoading ? (
          <>
            <SkeletonBlock className="h-24" />
            <SkeletonBlock className="h-24" />
            <SkeletonBlock className="h-24" />
          </>
        ) : groups.length === 0 ? (
          <EmptyState text="אין משחקים להצגה כרגע" />
        ) : (
          groups.map((group) => (
            <div key={group.id}>
              <h2 className="mb-2 text-xs font-medium text-muted-foreground">{group.name}</h2>
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
