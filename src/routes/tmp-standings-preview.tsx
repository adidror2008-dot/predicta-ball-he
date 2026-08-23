import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { StandingsSheet } from "@/components/predictaball/standings-sheet";

const COMP_ID = "fc988275-97f5-4979-8984-489f4c968df7";

export const Route = createFileRoute("/tmp-standings-preview")({
  component: Page,
  loader: async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("standings")
      .select(
        "position, played, won, drawn, lost, goals_for, goals_against, goal_diff, points, season, computed_at, teams(name_he, name_en, logo_url)",
      )
      .eq("competition_id", COMP_ID)
      .order("position", { ascending: true });
    const rows = data ?? [];
    const paths = rows.map((r) => r.teams?.logo_url).filter((u): u is string => !!u);
    const { data: signed } = await supabaseAdmin.storage
      .from("team-logos")
      .createSignedUrls(paths, 3600);
    const byPath = new Map((signed ?? []).map((s) => [s.path ?? "", s.signedUrl]));
    return {
      season: rows[0]?.season ?? null,
      rows,
      logos: rows.map((r) => byPath.get(r.teams?.logo_url ?? "") ?? null),
    };
  },
  head: () => ({ meta: [{ title: "תצוגה זמנית" }] }),
});

function Page() {
  const data = Route.useLoaderData();
  const qc = useQueryClient();
  qc.setQueryData(["standings", COMP_ID], data);
  const [open, setOpen] = useState(true);
  return (
    <StandingsSheet
      open={open}
      onOpenChange={setOpen}
      competitionId={COMP_ID}
      competitionName="ליג 1"
    />
  );
}
