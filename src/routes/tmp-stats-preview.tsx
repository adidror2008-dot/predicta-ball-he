import { createFileRoute } from "@tanstack/react-router";
import { SectionTitle } from "@/components/predictaball/ui-bits";
import { MatchStatsTab } from "@/components/predictaball/match-stats-tab";

export const Route = createFileRoute("/tmp-stats-preview")({
  component: () => (
    <main className="flex flex-col gap-6 px-4 pt-5 pb-8">
      <section>
        <SectionTitle>סטטיסטיקות</SectionTitle>
        <MatchStatsTab matchRef="16363246" />
      </section>
    </main>
  ),
});
