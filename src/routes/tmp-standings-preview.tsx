import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { StandingsSheet } from "@/components/predictaball/standings-sheet";

export const Route = createFileRoute("/tmp-standings-preview")({
  component: Page,
  head: () => ({ meta: [{ title: "תצוגה זמנית" }] }),
});

function Page() {
  const [open, setOpen] = useState(true);
  return (
    <StandingsSheet
      open={open}
      onOpenChange={setOpen}
      competitionId={(typeof window !== "undefined" && new URLSearchParams(window.location.search).get("c")) || ""}
      competitionName="ליג 1"
    />
  );
}
