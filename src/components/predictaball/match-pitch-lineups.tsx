import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { EmptyState, LtrNum, SkeletonBlock } from "./ui-bits";
import { getMatchHeaderFn, getMatchLineupsFn } from "@/lib/match-details-read.functions";
import type { LineupPlayer } from "@/lib/match-details-read.server";
import { cn } from "@/lib/utils";

type Row = LineupPlayer[];

function lastName(name: string | null) {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? (parts[parts.length - 1] as string) : (parts[0] as string);
}

function parseFormation(formation: string | null): number[] | null {
  if (!formation) return null;
  const nums = formation
    .split(/[^0-9]+/)
    .filter((s) => s.length > 0)
    .map((s) => Number(s));
  if (nums.length < 2 || nums.some((n) => !Number.isFinite(n) || n <= 0)) return null;
  return nums;
}

/** Fallback grouping: by position code, never dropping a player. */
function rowsByPosition(starters: LineupPlayer[]): Row[] {
  const order = ["G", "D", "M", "F"];
  const rows: Row[] = [];
  const used = new Set<LineupPlayer>();
  for (const code of order) {
    const group = starters.filter((p) => (p.position ?? "").toUpperCase().startsWith(code));
    for (const p of group) used.add(p);
    if (group.length > 0) rows.push(group);
  }
  const rest = starters.filter((p) => !used.has(p));
  if (rest.length > 0) rows.push(rest);
  return rows;
}

export function buildRows(starters: LineupPlayer[], formation: string | null): Row[] {
  const ordered = [...starters].sort((a, b) => {
    const ao = a.sort_order ?? Number.MAX_SAFE_INTEGER;
    const bo = b.sort_order ?? Number.MAX_SAFE_INTEGER;
    return ao - bo;
  });
  const lines = parseFormation(formation);
  const hasOrder = ordered.every((p) => p.sort_order !== null);
  if (!lines || !hasOrder) return rowsByPosition(ordered);
  const expected = 1 + lines.reduce((a, b) => a + b, 0);
  if (expected !== ordered.length) return rowsByPosition(ordered);

  const rows: Row[] = [[ordered[0] as LineupPlayer]];
  let cursor = 1;
  for (const n of lines) {
    rows.push(ordered.slice(cursor, cursor + n));
    cursor += n;
  }
  return rows;
}

function ratingClass(rating: number) {
  if (rating >= 9) return "bg-rating-elite";
  if (rating >= 8) return "bg-rating-good";
  if (rating >= 7) return "bg-rating-avg";
  if (rating >= 6) return "bg-rating-low";
  return "bg-rating-bad";
}

function PlayerChip({ player, onPitch }: { player: LineupPlayer; onPitch?: boolean }) {
  return (
    <div
      className={cn("flex flex-col items-center gap-1", onPitch ? "w-full" : "w-16")}
      data-player-chip=""
    >
      <div className="relative size-10">
        <div className="flex size-10 items-center justify-center overflow-hidden rounded-full border border-border bg-surface-2 text-sm font-bold">
          {player.photoUrl ? (
            <img
              src={player.photoUrl}
              alt=""
              loading="lazy"
              className="size-full object-cover object-top"
            />
          ) : (
            <LtrNum>{player.shirt_number ?? "—"}</LtrNum>
          )}
        </div>

        {player.rating !== null ? (
          <span
            className={cn(
              "absolute -top-1 flex size-[18px] items-center justify-center rounded-full text-[9px] font-bold text-rating-foreground",
              ratingClass(player.rating),
            )}
            style={{ right: "-4px" }}
          >
            <LtrNum>{player.rating.toFixed(1)}</LtrNum>
          </span>
        ) : null}

        {player.shirt_number !== null ? (
          <span
            className="absolute -top-1 flex size-4 items-center justify-center rounded-full border border-border bg-surface text-[8px] font-bold text-foreground"
            style={{ left: "-4px" }}
          >
            <LtrNum>{player.shirt_number}</LtrNum>
          </span>
        ) : null}
      </div>

      <span className="max-w-full truncate rounded bg-name-backdrop px-1 text-center text-[10px] leading-4 text-foreground">
        {lastName(player.name)}
      </span>
    </div>
  );
}

function HalfPlayers({
  starters,
  formation,
  half,
}: {
  starters: LineupPlayer[];
  formation: string | null;
  half: "home" | "away";
}) {
  const rows = buildRows(starters, formation);
  const k = Math.max(rows.length, 1);

  return (
    <>
      {rows.map((row, i) => {
        const depth = ((i + 0.5) / k) * 50;
        const top = half === "away" ? depth : 100 - depth;
        return row.map((p, j) => {
          const raw = ((j + 1) / (row.length + 1)) * 100;
          const left = Math.min(91, Math.max(9, raw));
          return (
            <div
              key={p.player_id ?? `${half}-${i}-${j}`}
              className="absolute w-[19%] max-w-[68px] -translate-x-1/2 -translate-y-1/2"
              style={{ top: `${top}%`, left: `${left}%` }}
              data-pitch-slot={`${half}-${i}`}
            >
              <PlayerChip player={p} onPitch />
            </div>
          );
        });
      })}
    </>
  );
}

function Bench({ players, label }: { players: LineupPlayer[]; label: string }) {
  if (players.length === 0) return null;
  return (
    <section className="mt-4">
      <h3 className="mb-2 text-xs font-semibold text-muted-foreground">{label}</h3>
      <div className="scrollbar-none -mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
        {players.map((p, i) => (
          <div key={p.player_id ?? `b-${i}`} className="shrink-0">
            <PlayerChip player={p} />
          </div>
        ))}
      </div>
    </section>
  );
}

function FormationLabel({ value, side }: { value: string | null; side: "top" | "bottom" }) {
  if (!value) return null;
  return (
    <span
      dir="ltr"
      className={cn(
        "absolute end-3 rounded-full bg-name-backdrop px-2 py-0.5 text-[10px] font-semibold text-foreground",
        side === "top" ? "top-3" : "bottom-3",
      )}
    >
      {value}
    </span>
  );
}

export function MatchPitchLineups({ matchRef }: { matchRef: string }) {
  const fetchLineups = useServerFn(getMatchLineupsFn);
  const fetchHeader = useServerFn(getMatchHeaderFn);

  const { data, isPending } = useQuery({
    queryKey: ["match-lineups", matchRef],
    queryFn: () => fetchLineups({ data: { matchExternalId: matchRef } }),
  });
  const { data: header } = useQuery({
    queryKey: ["match-header", matchRef],
    queryFn: () => fetchHeader({ data: { matchExternalId: matchRef } }),
  });

  if (isPending) return <SkeletonBlock className="min-h-[560px] w-full" />;

  const home = data?.homeTeam ?? [];
  const away = data?.awayTeam ?? [];
  if (home.length === 0 && away.length === 0) return <EmptyState text="טרם פורסם הרכב רשמי" />;

  const homeName = header?.homeName ?? "קבוצת הבית";
  const awayName = header?.awayName ?? "קבוצת החוץ";

  return (
    <div>
      <div className="relative aspect-[3/4.6] min-h-[560px] w-full overflow-hidden rounded-2xl bg-pitch-turf">
        <div className="pointer-events-none absolute inset-2 rounded-sm border border-pitch-line" />
        <div className="pointer-events-none absolute inset-x-2 top-1/2 h-px bg-pitch-line" />
        <div className="pointer-events-none absolute left-1/2 top-1/2 size-24 -translate-x-1/2 -translate-y-1/2 rounded-full border border-pitch-line" />
        <div className="pointer-events-none absolute left-1/2 top-2 h-[11%] w-[54%] -translate-x-1/2 border border-t-0 border-pitch-line" />
        <div className="pointer-events-none absolute bottom-2 left-1/2 h-[11%] w-[54%] -translate-x-1/2 border border-b-0 border-pitch-line" />

        <FormationLabel value={data?.awayFormation ?? null} side="top" />
        <FormationLabel value={data?.homeFormation ?? null} side="bottom" />

        <HalfPlayers
          starters={away.filter((p) => p.is_starting)}
          formation={data?.awayFormation ?? null}
          half="away"
        />
        <HalfPlayers
          starters={home.filter((p) => p.is_starting)}
          formation={data?.homeFormation ?? null}
          half="home"
        />
      </div>

      <Bench players={away.filter((p) => !p.is_starting)} label={`ספסל · ${awayName}`} />
      <Bench players={home.filter((p) => !p.is_starting)} label={`ספסל · ${homeName}`} />
    </div>
  );
}
