import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { EmptyState, LtrNum, SectionTitle, SkeletonBlock } from "./ui-bits";
import { getMatchLineupsFn } from "@/lib/match-details-read.functions";

type Player = {
  player_id: string | null;
  name: string | null;
  position: string | null;
  shirt_number: number | null;
  is_starting: boolean | null;
};

function PlayerRow({ player }: { player: Player }) {
  return (
    <li className="flex items-center gap-3 rounded-2xl bg-card px-3 py-2 shadow-card">
      <LtrNum className="min-w-8 text-center text-xs font-bold text-muted-foreground">
        {player.shirt_number ?? "—"}
      </LtrNum>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{player.name ?? "—"}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{player.position ?? "—"}</span>
    </li>
  );
}

function TeamBlock({
  title,
  formation,
  players,
}: {
  title: string;
  formation: string | null;
  players: Player[];
}) {
  const starters = players.filter((p) => p.is_starting);
  const bench = players.filter((p) => !p.is_starting);

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-2">
        <SectionTitle>{title}</SectionTitle>
        {formation ? (
          <LtrNum className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted-foreground">
            {formation}
          </LtrNum>
        ) : null}
      </div>

      {starters.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {starters.map((p, i) => (
            <PlayerRow key={p.player_id ?? `s-${i}`} player={p} />
          ))}
        </ul>
      ) : null}

      {bench.length > 0 ? (
        <div className="mt-4">
          <SectionTitle>ספסל</SectionTitle>
          <ul className="flex flex-col gap-2">
            {bench.map((p, i) => (
              <PlayerRow key={p.player_id ?? `b-${i}`} player={p} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export function MatchLineupsTab({ matchRef }: { matchRef: string }) {
  const fetchLineups = useServerFn(getMatchLineupsFn);
  const { data, isPending } = useQuery({
    queryKey: ["match-lineups", matchRef],
    queryFn: () => fetchLineups({ data: { matchExternalId: matchRef } }),
  });

  if (isPending) {
    return (
      <div className="flex flex-col gap-2">
        <SkeletonBlock className="h-10" />
        <SkeletonBlock className="h-10" />
        <SkeletonBlock className="h-10" />
        <SkeletonBlock className="h-10" />
      </div>
    );
  }

  const home = data?.homeTeam ?? [];
  const away = data?.awayTeam ?? [];
  if (home.length === 0 && away.length === 0) {
    return <EmptyState text="טרם פורסם הרכב רשמי" />;
  }

  return (
    <div className="flex flex-col gap-6">
      {home.length > 0 ? (
        <TeamBlock title="קבוצת הבית" formation={data?.homeFormation ?? null} players={home} />
      ) : null}
      {away.length > 0 ? (
        <TeamBlock title="קבוצת החוץ" formation={data?.awayFormation ?? null} players={away} />
      ) : null}
    </div>
  );
}
