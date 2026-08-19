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
const OTHER = "__other__";
const SCROLL_OFFSET = 12;
const PAST_MATCHES_ABOVE = 2;

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
  const fetchCompetitions = useServerFn(getCompetitionsListFn);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["matches-list"],
    queryFn: () => fetchMatches(),
  });
  const { data: allCompetitions, isLoading: isLoadingCompetitions } = useQuery({
    queryKey: ["competitions-list"],
    queryFn: () => fetchCompetitions(),
  });

  const [activeId, setActiveId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const restored = useRef(false);
  const { prefs, hydrated, update } = useChipPrefs();

  const matches = useMemo(() => data ?? [], [data]);

  const withMatches = useMemo(
    () => new Set(matches.map((m) => m.competitionId ?? OTHER)),
    [matches],
  );

  const pickerCompetitions = useMemo<PickerCompetition[]>(() => {
    const base = (allCompetitions ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      nameEn: c.nameEn,
      country: c.country,
      hasMatches: withMatches.has(c.id),
    }));
    if (withMatches.has(OTHER)) {
      base.push({
        id: OTHER,
        name: "משחקים נוספים",
        nameEn: null,
        country: null,
        hasMatches: true,
      });
    }
    return base;
  }, [allCompetitions, withMatches]);

  const allIds = useMemo(() => pickerCompetitions.map((c) => c.id), [pickerCompetitions]);
  const selectedIds = useMemo(
    () => (prefs.selected === null ? allIds : prefs.selected.filter((id) => allIds.includes(id))),
    [prefs.selected, allIds],
  );
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const competitions = useMemo<Competition[]>(
    () =>
      applyOrder(
        pickerCompetitions.filter((c) => selectedSet.has(c.id)),
        prefs.order,
      ).map((c) => ({ id: c.id, name: c.name, hasMatches: c.hasMatches })),
    [pickerCompetitions, selectedSet, prefs.order],
  );

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

  const toggleCompetition = (id: string) => {
    const next = selectedSet.has(id)
      ? selectedIds.filter((v) => v !== id)
      : [...selectedIds, id];
    update({ ...prefs, selected: next });
    if (activeId === id && !next.includes(id)) setActiveId(null);
  };

  const groups = useMemo(() => {
    const visible = matches.filter((m) => selectedSet.has(m.competitionId ?? OTHER));
    const filtered = activeId
      ? visible.filter((m) => (m.competitionId ?? OTHER) === activeId)
      : visible;

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
    const ordered = applyOrder(
      Array.from(byComp.entries()).map(([id, g]) => ({ id, ...g })),
      prefs.order,
    );
    return ordered;
  }, [matches, activeId, selectedSet, prefs.order]);

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
        onReorder={(ids) => update({ ...prefs, order: ids })}
        onOpenPicker={() => setPickerOpen(true)}
      />

      <CompetitionPickerSheet
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        competitions={pickerCompetitions}
        isLoading={isLoadingCompetitions}
        selectedIds={selectedIds}
        onToggle={toggleCompetition}
        onSelectAll={() => update({ ...prefs, selected: null })}
        onClearAll={() => {
          update({ ...prefs, selected: [] });
          setActiveId(null);
        }}
      />

      <section className="mt-4 space-y-5">
        {isLoading || !hydrated ? (
          <>
            <SkeletonBlock className="h-24" />
            <SkeletonBlock className="h-24" />
            <SkeletonBlock className="h-24" />
          </>
        ) : selectedIds.length === 0 ? (
          <EmptyState text="לא נבחרו תחרויות להצגה. פתחו את תפריט התחרויות ובחרו אילו יופיעו." />
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
