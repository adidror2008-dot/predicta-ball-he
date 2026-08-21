import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronRight } from "lucide-react";
import { EmptyState, LtrNum, SkeletonBlock } from "@/components/predictaball/ui-bits";
import { getModelAccuracyFn } from "@/lib/match-details-read.functions";

export const Route = createFileRoute("/_authenticated/accuracy")({
  head: () => ({
    meta: [
      { title: "דיוק המודל — PredictaBall" },
      {
        name: "description",
        content: "אחוזי הצלחה של מנוע התחזיות מול בסיס נאיבי, לפי משחקים שהסתיימו.",
      },
      { property: "og:title", content: "דיוק המודל — PredictaBall" },
      {
        property: "og:description",
        content: "אחוזי הצלחה של מנוע התחזיות מול בסיס נאיבי, לפי משחקים שהסתיימו.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AccuracyScreen,
});

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string | null;
}) {
  return (
    <div className="rounded-2xl bg-card p-4 shadow-card">
      <p className="text-xs text-muted-foreground">{label}</p>
      <LtrNum className="mt-1 text-2xl font-bold">{value}</LtrNum>
      {sub ? <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

function AccuracyScreen() {
  const fetchAccuracy = useServerFn(getModelAccuracyFn);
  const { data, isPending } = useQuery({
    queryKey: ["model-accuracy"],
    queryFn: () => fetchAccuracy(),
  });

  const asPct = (v: number | null) =>
    v === null ? "—" : `${Math.round(v <= 1 ? v * 100 : v)}%`;
  const as3 = (v: number | null) => (v === null ? "—" : v.toFixed(3));

  return (
    <main className="flex flex-col gap-6 px-4 pt-5 pb-8">
      <header className="flex items-center gap-2">
        <Link
          to="/settings"
          aria-label="חזרה"
          className="rounded-2xl bg-surface p-2 text-muted-foreground"
        >
          <ChevronRight className="size-4" aria-hidden />
        </Link>
        <h1 className="text-lg font-bold">דיוק המודל</h1>
      </header>

      {isPending ? (
        <div className="grid grid-cols-2 gap-3">
          <SkeletonBlock className="h-24" />
          <SkeletonBlock className="h-24" />
          <SkeletonBlock className="h-24" />
          <SkeletonBlock className="h-24" />
        </div>
      ) : !data || data.n < data.minSample ? (
        <EmptyState text="עדיין אין מספיק משחקים שהסתיימו כדי להציג דיוק. המסך יתמלא ככל שיצטברו תוצאות." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label="ניחוש מנצח"
              value={asPct(data.pctWinner)}
              sub={`בסיס נאיבי ${asPct(data.naivePctWinner)}`}
            />
            <StatCard label="תוצאה מדויקת" value={asPct(data.pctExact)} />
            <StatCard
              label="קטגוריית שערים"
              value={asPct(data.pctGoalBucket)}
              sub={`בסיס נאיבי ${asPct(data.naivePctBucket)}`}
            />
            <StatCard label="מעל/מתחת 2.5" value={asPct(data.pctOu25)} />
            <StatCard label="RPS ממוצע" value={as3(data.avgRps)} />
            <StatCard label="Brier ממוצע" value={as3(data.avgBrier)} />
          </div>
          <p className="text-xs text-muted-foreground">
            מבוסס על <LtrNum className="font-bold text-foreground">{data.n}</LtrNum> משחקים
            שהסתיימו.
          </p>
        </>
      )}
    </main>
  );
}
