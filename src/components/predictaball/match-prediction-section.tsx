import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { EmptyState, LtrNum, SectionTitle, SkeletonBlock } from "./ui-bits";
import { getMatchPredictionFn } from "@/lib/match-details-read.functions";
import type { MatchHeader } from "@/lib/match-details-read.server";
import { cn } from "@/lib/utils";

function pct(v: number | null) {
  if (v === null) return null;
  const n = v <= 1 ? v * 100 : v;
  return Math.round(n);
}

function outcome(h: number | null, a: number | null) {
  if (h === null || a === null) return null;
  return h > a ? "home" : h < a ? "away" : "draw";
}

function verdict(header: MatchHeader, predH: number | null, predA: number | null) {
  if (!header.isFinished || predH === null || predA === null) return null;
  const actualH = header.homeScore;
  const actualA = header.awayScore;
  if (actualH === null || actualA === null) return null;

  const exact = actualH === predH && actualA === predA;
  const sameWinner = outcome(actualH, actualA) === outcome(predH, predA);
  const sameGoals = actualH + actualA === predH + predA;

  if (exact) return { text: "התחזית תפסה", className: "bg-status-win/20 text-status-win" };
  if (sameWinner)
    return { text: "תפסה מנצח בלבד", className: "bg-status-draw/25 text-foreground" };
  if (sameGoals) return { text: "תפסה כמות שערים", className: "bg-sky-500/20 text-sky-300" };
  return { text: "התחזית לא תפסה", className: "bg-status-loss/20 text-status-loss" };
}

function Meter({ label, value }: { label: string; value: number | null }) {
  const v = value ?? 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <LtrNum className="font-bold">{value === null ? "—" : `${value}%`}</LtrNum>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-brand-gradient" style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

export function MatchPredictionSection({
  matchRef,
  header,
}: {
  matchRef: string;
  header: MatchHeader | null | undefined;
}) {
  const fetchPrediction = useServerFn(getMatchPredictionFn);
  const { data, isPending } = useQuery({
    queryKey: ["match-prediction", matchRef],
    queryFn: () => fetchPrediction({ data: { matchExternalId: matchRef } }),
  });

  if (isPending) {
    return (
      <div className="flex flex-col gap-2">
        <SkeletonBlock className="h-28" />
        <SkeletonBlock className="h-32" />
      </div>
    );
  }

  if (!data) return <EmptyState text="התחזית טרם חושבה" />;

  const badge = header ? verdict(header, data.predictedHomeScore, data.predictedAwayScore) : null;
  const confidence = pct(data.confidence);
  const confidenceLabel =
    confidence === null
      ? "—"
      : confidence >= 70
        ? "גבוה"
        : confidence >= 40
          ? "בינוני"
          : "נמוך";

  return (
    <div className="flex flex-col gap-3">
      <section className="rounded-2xl bg-card p-4 shadow-card">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">תוצאה חזויה</p>
            <LtrNum className="text-2xl font-bold">
              {data.predictedAwayScore ?? "—"} - {data.predictedHomeScore ?? "—"}
            </LtrNum>
          </div>
          {badge ? (
            <span className={cn("rounded-full px-3 py-1 text-[11px] font-medium", badge.className)}>
              {badge.text}
            </span>
          ) : null}
        </div>

        <div className="mt-4 flex flex-col gap-3">
          <Meter label={`ניצחון ${header?.homeName ?? "הבית"}`} value={pct(data.probHome)} />
          <Meter label="תיקו" value={pct(data.probDraw)} />
          <Meter label={`ניצחון ${header?.awayName ?? "החוץ"}`} value={pct(data.probAway)} />
        </div>

        <div className="mt-4 border-t border-border pt-3">
          <Meter label={`רמת הביטחון בתחזית · ${confidenceLabel}`} value={confidence} />
        </div>
      </section>

      {data.reasons.length > 0 ? (
        <section className="rounded-2xl bg-card p-4 shadow-card">
          <SectionTitle>על מה התחזית מבוססת</SectionTitle>
          <ul className="flex flex-col gap-2">
            {data.reasons.map((reason, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand" aria-hidden />
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
