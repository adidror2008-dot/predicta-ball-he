import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronRight } from "lucide-react";
import { SectionTitle } from "@/components/predictaball/ui-bits";
import { MatchHeaderCard } from "@/components/predictaball/match-header-card";
import { MatchPredictionSection } from "@/components/predictaball/match-prediction-section";
import { MatchPitchLineups } from "@/components/predictaball/match-pitch-lineups";
import { MatchEventsTab } from "@/components/predictaball/match-events-tab";
import { getMatchHeaderFn } from "@/lib/match-details-read.functions";

export const Route = createFileRoute("/_authenticated/match/$id")({
  head: () => ({
    meta: [
      { title: "פרטי משחק — PredictaBall" },
      {
        name: "description",
        content: "תוצאה, תחזית, הרכבים ואירועי המשחק במסך אחד.",
      },
      { property: "og:title", content: "פרטי משחק — PredictaBall" },
      {
        property: "og:description",
        content: "תוצאה, תחזית, הרכבים ואירועי המשחק במסך אחד.",
      },
    ],
  }),
  component: MatchPage,
});

function MatchPage() {
  const { id } = Route.useParams();
  const fetchHeader = useServerFn(getMatchHeaderFn);
  const { data: header, isPending } = useQuery({
    queryKey: ["match-header", id],
    queryFn: () => fetchHeader({ data: { matchExternalId: id } }),
  });

  return (
    <main className="flex flex-col gap-6 px-4 pt-5 pb-8">
      <header className="flex items-center gap-2">
        <Link
          to="/"
          aria-label="חזרה"
          className="rounded-2xl bg-surface p-2 text-muted-foreground"
        >
          <ChevronRight className="size-4" aria-hidden />
        </Link>
        <h1 className="text-lg font-bold">פרטי משחק</h1>
      </header>

      <MatchHeaderCard header={header} isPending={isPending} />

      <section>
        <SectionTitle>תחזית</SectionTitle>
        <MatchPredictionSection matchRef={id} header={header} />
      </section>

      <section>
        <SectionTitle>הרכבים</SectionTitle>
        <MatchPitchLineups matchRef={id} />
      </section>

      {header?.isFinished ? (
        <section>
          <SectionTitle>אירועי המשחק</SectionTitle>
          <MatchEventsTab matchRef={id} />
        </section>
      ) : null}
    </main>
  );
}
