import { cn } from "@/lib/utils";

export type Competition = {
  id: string;
  name: string;
  hasMatches: boolean;
};

export function CompetitionChips({
  competitions,
  activeId,
  onSelect,
}: {
  competitions: Competition[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  if (competitions.length === 0) return null;

  return (
    <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      {competitions.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onSelect(c.id)}
          className={cn(
            "shrink-0 rounded-2xl px-3 py-1.5 text-xs font-medium transition-colors",
            activeId === c.id
              ? "bg-brand-gradient text-brand-foreground"
              : "bg-surface text-muted-foreground",
            !c.hasMatches && "opacity-40",
          )}
        >
          {c.name}
          {!c.hasMatches ? (
            <span className="ms-1 text-[10px]">· אין משחקים כרגע</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
