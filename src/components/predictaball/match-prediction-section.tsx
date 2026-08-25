import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { EmptyState, LtrNum, SectionTitle, SkeletonBlock } from "./ui-bits";
import { getMatchPredictionFn } from "@/lib/match-details-read.functions";
import type { MatchHeader, MatchPrediction } from "@/lib/match-details-read.server";
import { cn } from "@/lib/utils";

function pct(v: number | null) {
  if (v === null) return null;
  const n = v <= 1 ? v * 100 : v;
  return Math.round(n);
}

function sign(h: number | null, a: number | null) {
  if (h === null || a === null) return null;
  return h > a ? "home" : h < a ? "away" : "draw";
}

const dateFmt = new Intl.DateTimeFormat("he-IL", {
  timeZone: "Asia/Jerusalem",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatStamp(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = dateFmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}`;
}

function verdict(header: MatchHeader, predH: number | null, predA: number | null) {
  if (!header.isFinished || predH === null || predA === null) return null;
  const actualH = header.homeScore;
  const actualA = header.awayScore;
  if (actualH === null || actualA === null) return null;

  if (actualH === predH && actualA === predA)
    return { text: "קלע בול", className: "bg-status-win/25 text-status-win" };
  if (sign(actualH, actualA) === sign(predH, predA))
    return { text: "צדק", className: "bg-status-win/15 text-status-win" };
  return { text: "פספס", className: "bg-status-loss/20 text-status-loss" };
}

function teamLabel(side: "home" | "away" | null, header: MatchHeader | null | undefined) {
  if (side === "home") return header?.homeName || "קבוצת הבית";
  if (side === "away") return header?.awayName || "קבוצת החוץ";
  return null;
}

function buildReasons(data: MatchPrediction, header: MatchHeader | null | undefined) {
  if (data.reasons.length > 0) return data.reasons.slice(0, 3);

  const lines: string[] = [];
  for (const f of data.factors) {
    const name = teamLabel(f.side, header);
    if (!name) continue;
    if (f.type === "elo_gap" && f.value !== null) {
      lines.push(`יתרון בדירוג ל${name} (פער ${Math.round(f.value)} נק')`);
    } else if (f.type === "form") {
      lines.push(`כושר עדכני טוב ל${name}`);
    } else if (f.type === "rest_days" && f.value !== null) {
      lines.push(`יתרון מנוחה ל${name} (${Math.round(f.value)} ימי מנוחה)`);
    }
    if (lines.length === 3) break;
  }
  return lines;
}

/** Wraps every number/percentage/score run in an LTR span so RTL text stays correct. */
function ltrNumbers(text: string) {
  return text.split(/(\d+(?:[.,:\-–]\d+)*%?)/g).map((part, i) =>
    /^\d/.test(part) ? (
      <LtrNum key={i} className="font-medium text-foreground">
        {part}
      </LtrNum>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
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

const BAND_LABEL: Record<string, string> = {
  high: "ביטחון גבוה",
  mid: "ביטחון בינוני",
  low: "ביטחון נמוך",
};

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

  if (!data) return <EmptyState text="אין עדיין תחזית למשחק הזה" />;

  const badge = header ? verdict(header, data.predictedHomeScore, data.predictedAwayScore) : null;
  const confidence = pct(data.confidence);
  const bandLabel = data.confidenceBand ? (BAND_LABEL[data.confidenceBand] ?? null) : null;
  const reasons = buildReasons(data, header);
  const computed = formatStamp(data.computedAt);
  const nextUpdate = formatStamp(data.nextUpdateAt);
  const showActual =
    header?.isFinished && header.homeScore !== null && header.awayScore !== null;

  return (
    <div className="flex flex-col gap-3">
      <section className="rounded-2xl bg-card p-4 shadow-card">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 text-center">
            <p className="text-xs text-muted-foreground">תוצאה חזויה</p>
            <LtrNum className="text-3xl font-bold">
              {data.predictedAwayScore ?? "—"} : {data.predictedHomeScore ?? "—"}
            </LtrNum>
            {showActual ? (
              <p className="mt-1 text-xs text-muted-foreground">
                תוצאה בפועל{" "}
                <LtrNum className="font-bold text-foreground">
                  {header?.awayScore} : {header?.homeScore}
                </LtrNum>
              </p>
            ) : null}
          </div>
          {badge ? (
            <span className={cn("rounded-full px-3 py-1 text-[11px] font-medium", badge.className)}>
              {badge.text}
            </span>
          ) : null}
        </div>

        <div className="mt-4 flex flex-col gap-3">
          <Meter label={header?.homeName ? `ניצחון ${header.homeName}` : "ניצחון בית"} value={pct(data.probHome)} />
          <Meter label="תיקו" value={pct(data.probDraw)} />
          <Meter label={header?.awayName ? `ניצחון ${header.awayName}` : "ניצחון חוץ"} value={pct(data.probAway)} />
        </div>

        <div className="mt-4 border-t border-border pt-3">
          <Meter label={bandLabel ?? "רמת ביטחון"} value={confidence} />
        </div>
      </section>

      <section className="rounded-2xl bg-card p-4 shadow-card">
        <SectionTitle>כמות שערים צפויה</SectionTitle>
        <div className="flex flex-col gap-3">
          <Meter label="0-1 גולים" value={pct(data.probGoals01)} />
          <Meter label="2-3 גולים" value={pct(data.probGoals23)} />
          <Meter label="4+ גולים" value={pct(data.probGoals4Plus)} />
        </div>
      </section>

      {data.explanationHe ? (
        <section className="rounded-2xl bg-card p-4 shadow-card">
          <SectionTitle>פירוט החיזוי</SectionTitle>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {ltrNumbers(data.explanationHe)}
          </p>
        </section>
      ) : reasons.length > 0 ? (
        <section className="rounded-2xl bg-card p-4 shadow-card">
          <SectionTitle>על מה התחזית מבוססת</SectionTitle>
          <ul className="flex flex-col gap-2">
            {reasons.map((reason, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand" aria-hidden />
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}


      {computed || nextUpdate ? (
        <section className="rounded-2xl bg-card p-4 text-xs text-muted-foreground shadow-card">
          {computed ? (
            <div className="flex items-center justify-between gap-2">
              <span>עודכן לאחרונה</span>
              <LtrNum>{computed}</LtrNum>
            </div>
          ) : null}
          {nextUpdate ? (
            <div className="mt-2 flex items-center justify-between gap-2">
              <span>העדכון הבא</span>
              <LtrNum>{nextUpdate}</LtrNum>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
