import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import {
  CompetitionChips,
  type Competition,
} from "@/components/predictaball/competition-chips";
import { CompetitionFollowBell } from "@/components/predictaball/follow-bell";
import {
  CompetitionPickerSheet,
  type PickerCompetition,
} from "@/components/predictaball/competition-picker-sheet";
import { MatchCard, type MatchCardData } from "@/components/predictaball/match-card";
import { EmptyState, SkeletonBlock } from "@/components/predictaball/ui-bits";
import { SwipeDeck } from "@/components/predictaball/swipe-deck";
import { StandingsButton, StandingsSheet } from "@/components/predictaball/standings-sheet";

import { getMatchesListFn } from "@/lib/matches-list.functions";
import { getCompetitionsListFn } from "@/lib/competitions-list.functions";
import { applyOrder, useChipPrefs } from "@/lib/chip-prefs";
import {
  groupMatches,
  SECTION_ORDER,
  SECTION_NOTE_HE,
  SECTION_TITLE_HE,
  type MatchDisplayStatus,
} from "@/lib/match-display-status";

export const Route = createFileRoute("/_authenticated/")({
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
const SCROLL_OFFSET = 12;
const PAST_MATCHES_ABOVE = 2;
const CLOCK_MS = 60_000;

/** Wall clock that ticks every minute so time-based classification is
 *  re-evaluated even when polling returns structurally identical rows. */
function useNowMs(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(id);
  }, []);
  return now;
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

function MatchesPanel({
  competitionId,
  active,
  hydrated,
  onFetchingChange,
  refreshToken,
}: {
  competitionId: string;
  active: boolean;
  hydrated: boolean;
  onFetchingChange?: (fetching: boolean) => void;
  refreshToken?: number;
}) {
  const fetchMatches = useServerFn(getMatchesListFn);
  const lastScrollTarget = useRef<string | null>(null);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["matches-list", competitionId],
    queryFn: () => fetchMatches({ data: { competitionIds: [competitionId] } }),
    // Re-read the database while the screen is open (scores settle in the
    // background); the active tab refreshes every minute, others only on focus.
    refetchInterval: active ? 60_000 : false,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (active && refreshToken) refetch();
  }, [refreshToken, active, refetch]);

  useEffect(() => {
    if (active) onFetchingChange?.(isFetching);
  }, [isFetching, active, onFetchingChange]);

  const matches = useMemo(() => data ?? [], [data]);
  const nowMs = useNowMs();

  const toCard = (
    m: (typeof matches)[number] & { display: MatchDisplayStatus },
  ): MatchCardData => ({
    id: m.id,
    homeName: m.homeName,
    awayName: m.awayName,
    homeLogo: m.homeLogo,
    awayLogo: m.awayLogo,
    homeScore: m.homeScore,
    awayScore: m.awayScore,
    kickoffTime: formatTime(m.kickoffAt),
    date: formatDate(m.kickoffAt),
    status: m.display,
    minute: m.minute ?? null,
  });

  // One shared classification (grouping + badge), re-evaluated on the clock.
  const sections = useMemo(() => {
    const g = groupMatches(matches, nowMs);
    return {
      finished: g.finished.map(toCard),
      pending: g.pending.map(toCard),
      live: g.live.map(toCard),
      upcoming: g.upcoming.map(toCard),
      unverified: g.unverified.map(toCard),
      postponed: g.postponed.map(toCard),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches, nowMs]);

  const seasonNotice = useMemo(() => {
    const first = matches.find((m) => !m.isCurrentSeason && m.seasonLabel);
    return first?.seasonLabel ?? null;
  }, [matches]);

  // The list opens on the first live/upcoming match, keeping two past matches visible above.
  const scrollTargetId = useMemo(() => {
    const past = [...sections.finished, ...sections.pending];
    const next = sections.live[0] ?? sections.upcoming[0] ?? null;
    if (past.length === 0) return next?.id ?? null;
    const index = Math.max(0, past.length - PAST_MATCHES_ABOVE);
    return past[index]?.id ?? past[past.length - 1]!.id;
  }, [sections]);

  useEffect(() => {
    if (!active || isLoading || !hydrated || !scrollTargetId) return;
    const behavior: ScrollBehavior = lastScrollTarget.current === null ? "auto" : "smooth";
    lastScrollTarget.current = scrollTargetId;
    const raf = requestAnimationFrame(() => {
      const el = document.getElementById(`match-${scrollTargetId}`);
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY - SCROLL_OFFSET;
      window.scrollTo({ top: Math.max(0, top), behavior });
    });
    return () => cancelAnimationFrame(raf);
  }, [scrollTargetId, isLoading, hydrated, active]);

  if (!hydrated || isLoading) {
    return (
      <div className="space-y-3">
        <SkeletonBlock className="h-24" />
        <SkeletonBlock className="h-24" />
        <SkeletonBlock className="h-24" />
      </div>
    );
  }

  if (SECTION_ORDER.every((s) => sections[s].length === 0)) {
    return <EmptyState text="אין משחקים להצגה כרגע" />;
  }

  return (
    <div className="space-y-3">
      {seasonNotice ? (
        <p className="text-xs text-muted-foreground">
          עונת <span dir="ltr">{seasonNotice}</span>
        </p>
      ) : null}

      {SECTION_ORDER.map((section) => {
        const list = sections[section];
        if (list.length === 0) return null;
        const title = SECTION_TITLE_HE[section];
        const note = SECTION_NOTE_HE[section];
        return (
          <div key={section} className="space-y-3" data-section={section}>
            {title ? (
              <div className="flex items-center gap-3 py-1">
                <span className="h-px flex-1 bg-border" aria-hidden />
                <span className="text-xs font-medium text-muted-foreground">{title}</span>
                <span className="h-px flex-1 bg-border" aria-hidden />
              </div>
            ) : null}
            {note ? (
              <p className="text-center text-[11px] leading-tight text-muted-foreground">{note}</p>
            ) : null}
            {list.map((m) => (
              <MatchCard key={m.id} match={m} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function MatchesScreen() {
  const fetchCompetitions = useServerFn(getCompetitionsListFn);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [standingsOpen, setStandingsOpen] = useState(false);

  const [isFetching, setIsFetching] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const { prefs, hydrated, update } = useChipPrefs();

  const { data: allCompetitions, isLoading: isLoadingCompetitions } = useQuery({
    queryKey: ["competitions-list"],
    queryFn: () => fetchCompetitions(),
  });

  const pickerCompetitions = useMemo<PickerCompetition[]>(
    () =>
      (allCompetitions ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        nameEn: c.nameEn,
        country: c.country,
        hasMatches: true,
      })),
    [allCompetitions],
  );

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

  // There is always exactly one active competition: the saved one when it is
  // still selected, otherwise the first chip.
  useEffect(() => {
    if (competitions.length === 0) {
      if (activeId !== null) setActiveId(null);
      return;
    }
    const ids = competitions.map((c) => c.id);
    if (activeId && ids.includes(activeId)) return;
    const saved = sessionStorage.getItem(TAB_KEY);
    const next = saved && ids.includes(saved) ? saved : ids[0]!;
    setActiveId(next);
    sessionStorage.setItem(TAB_KEY, next);
  }, [competitions, activeId]);

  const selectCompetition = (id: string) => {
    if (id === activeId) return;
    setActiveId(id);
    sessionStorage.setItem(TAB_KEY, id);
  };

  const toggleCompetition = (id: string) => {
    const next = selectedSet.has(id)
      ? selectedIds.filter((v) => v !== id)
      : [...selectedIds, id];
    update({ ...prefs, selected: next });
  };

  const activeIndex = Math.max(
    0,
    competitions.findIndex((c) => c.id === activeId),
  );

  const activeCompetition = competitions.find((c) => c.id === activeId) ?? null;


  const showSkeleton = !hydrated || isLoadingCompetitions;

  return (
    <main className="px-4 pt-5">
      <header className="mb-4 flex items-center justify-between gap-3">
        <h1 className="font-brand text-2xl font-extrabold">
          <span className="text-foreground">Predicta</span>
          <span className="text-brand-gradient">Ball</span>
        </h1>
        <div className="flex items-center gap-2">
          {activeId ? <CompetitionFollowBell competitionId={activeId} /> : null}
          <button
            type="button"
            aria-label="רענון"
            onClick={() => setRefreshToken((v) => v + 1)}
            className="rounded-2xl bg-surface p-2.5 text-muted-foreground transition-colors active:bg-surface-2"
          >
            <RotateCw className={isFetching ? "size-4 animate-spin" : "size-4"} aria-hidden />
          </button>
        </div>
      </header>

      <div className="sticky top-0 z-30 -mx-4 bg-background px-4 py-2 border-b border-border">
        <CompetitionChips
          competitions={competitions}
          activeId={activeId}
          onSelect={selectCompetition}
          onReorder={(ids) => update({ ...prefs, order: ids })}
          onOpenPicker={() => setPickerOpen(true)}
        />
      </div>

      {activeCompetition ? (
        <div className="mt-2 flex">
          <StandingsButton onClick={() => setStandingsOpen(true)} />
        </div>
      ) : null}

      {activeCompetition ? (
        <StandingsSheet
          open={standingsOpen}
          onOpenChange={setStandingsOpen}
          competitionId={activeCompetition.id}
          competitionName={activeCompetition.name}
        />
      ) : null}


      <CompetitionPickerSheet
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        competitions={pickerCompetitions}
        isLoading={isLoadingCompetitions}
        selectedIds={selectedIds}
        onToggle={toggleCompetition}
        onSelectAll={() => update({ ...prefs, selected: null })}
        onClearAll={() => update({ ...prefs, selected: [] })}
      />

      <section className="mt-4">
        {showSkeleton ? (
          <div className="space-y-3">
            <SkeletonBlock className="h-24" />
            <SkeletonBlock className="h-24" />
            <SkeletonBlock className="h-24" />
          </div>
        ) : selectedIds.length === 0 || !activeId ? (
          <EmptyState text="לא נבחרו תחרויות להצגה. פתחו את תפריט התחרויות ובחרו אילו יופיעו." />
        ) : (
          <SwipeDeck
            index={activeIndex}
            count={competitions.length}
            onIndexChange={(next) => {
              const target = competitions[next];
              if (target) selectCompetition(target.id);
            }}
          >
            {(i) => {
              const comp = competitions[i];
              if (!comp) return null;
              return (
                <MatchesPanel
                  competitionId={comp.id}
                  active={comp.id === activeId}
                  hydrated={hydrated}
                  onFetchingChange={setIsFetching}
                  refreshToken={refreshToken}
                />
              );
            }}
          </SwipeDeck>
        )}
      </section>
    </main>
  );
}

