import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Star } from "lucide-react";
import { EmptyState, LtrNum, SkeletonBlock } from "./ui-bits";
import { getMatchLineupsFn } from "@/lib/match-details-read.functions";
import type { LineupPlayer } from "@/lib/match-details-read.server";
import { cn } from "@/lib/utils";

const ROW_DEPTH: Record<string, number> = { G: 6, D: 22, M: 46, F: 70 };

function lastName(name: string | null) {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : parts[0];
}

function PlayerChip({ player }: { player: LineupPlayer }) {
  return (
    <div className="flex w-16 flex-col items-center gap-1">
      <div className="relative">
        <div className="flex size-11 items-center justify-center overflow-hidden rounded-full border border-border bg-surface-2 text-sm font-bold">
          <LtrNum>{player.shirt_number ?? "—"}</LtrNum>
        </div>
        {player.rating !== null ? (
          <span className="absolute -top-1 -right-1 flex items-center gap-0.5 rounded-full bg-brand px-1.5 py-px text-[9px] font-bold text-brand-foreground">
            <Star className="size-2.5" aria-hidden />
            <LtrNum>{player.rating.toFixed(1)}</LtrNum>
          </span>
        ) : null}
      </div>
      <span dir="auto" className="w-full truncate text-center text-[10px] text-foreground/90">
        {lastName(player.name)}
      </span>
    </div>
  );
}

function groupRows(players: LineupPlayer[]) {
  const order = ["G", "D", "M", "F"];
  return order.map((code) => ({
    code,
    depth: ROW_DEPTH[code],
    players: players.filter((p) => (p.position ?? "M").toUpperCase() === code),
  }));
}

function HalfPlayers({ players, half }: { players: LineupPlayer[]; half: "home" | "away" }) {
  return (
    <>
      {groupRows(players).map((row) =>
        row.players.map((p, i) => {
          const across = ((i + 1) / (row.players.length + 1)) * 100;
          const depth = half === "away" ? row.depth : 100 - row.depth;
          return (
            <div
              key={p.player_id ?? `${half}-${row.code}-${i}`}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ top: `${depth}%`, left: `${across}%` }}
            >
              <PlayerChip player={p} />
            </div>
          );
        }),
      )}
    </>
  );
}

function Bench({ players, align }: { players: LineupPlayer[]; align: "start" | "end" }) {
  if (players.length === 0) return null;
  return (
    <div
      className={cn(
        "scrollbar-none flex gap-2 overflow-x-auto py-2",
        align === "start" ? "justify-start" : "justify-end",
      )}
    >
      {players.map((p, i) => (
        <div key={p.player_id ?? `b-${i}`} className="shrink-0">
          <PlayerChip player={p} />
        </div>
      ))}
    </div>
  );
}

function Pitch({ home, away }: { home: LineupPlayer[]; away: LineupPlayer[] }) {
  return (
    <div className="relative aspect-[3/4.1] w-full overflow-hidden rounded-2xl bg-[repeating-linear-gradient(180deg,oklch(0.32_0.06_150)_0_8%,oklch(0.28_0.055_150)_8%_16%)]">
      {/* pitch lines */}
      <div className="pointer-events-none absolute inset-2 rounded-sm border border-white/25" />
      <div className="pointer-events-none absolute inset-x-2 top-1/2 h-px bg-white/25" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 size-24 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/25" />
      <div className="pointer-events-none absolute left-1/2 top-2 h-[14%] w-[54%] -translate-x-1/2 border border-white/25 border-t-0" />
      <div className="pointer-events-none absolute left-1/2 top-2 h-[6%] w-[28%] -translate-x-1/2 border border-white/25 border-t-0" />
      <div className="pointer-events-none absolute bottom-2 left-1/2 h-[14%] w-[54%] -translate-x-1/2 border border-white/25 border-b-0" />
      <div className="pointer-events-none absolute bottom-2 left-1/2 h-[6%] w-[28%] -translate-x-1/2 border border-white/25 border-b-0" />

      <HalfPlayers players={away} half="away" />
      <HalfPlayers players={home} half="home" />
    </div>
  );
}

export function MatchPitchLineups({ matchRef }: { matchRef: string }) {
  const fetchLineups = useServerFn(getMatchLineupsFn);
  const { data, isPending } = useQuery({
    queryKey: ["match-lineups", matchRef],
    queryFn: () => fetchLineups({ data: { matchExternalId: matchRef } }),
  });

  if (isPending) return <SkeletonBlock className="aspect-[3/4.1] w-full" />;

  const home = data?.homeTeam ?? [];
  const away = data?.awayTeam ?? [];
  if (home.length === 0 && away.length === 0) return <EmptyState text="אין הרכבים עדיין" />;

  return (
    <div>
      <Bench players={away.filter((p) => !p.is_starting)} align="start" />
      <Pitch
        home={home.filter((p) => p.is_starting)}
        away={away.filter((p) => p.is_starting)}
      />
      <Bench players={home.filter((p) => !p.is_starting)} align="end" />
    </div>
  );
}
