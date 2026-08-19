import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

export type Competition = {
  id: string;
  name: string;
  hasMatches: boolean;
};

function chipClasses(active: boolean, hasMatches: boolean, dragging: boolean) {
  return cn(
    "shrink-0 select-none rounded-2xl px-3 py-1.5 text-xs font-medium transition-[background-color,color,transform,box-shadow] duration-200",
    active ? "bg-brand-gradient text-brand-foreground" : "bg-surface text-muted-foreground",
    !hasMatches && "opacity-40",
    dragging && "opacity-0",
  );
}

function SortableChip({
  competition,
  active,
  onSelect,
}: {
  competition: Competition;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: competition.id,
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        touchAction: "auto",
      }}
      onClick={() => onSelect(competition.id)}
      className={chipClasses(active, competition.hasMatches, isDragging)}
      {...attributes}
      {...listeners}
    >
      {competition.name}
      {!competition.hasMatches ? (
        <span className="ms-1 text-[10px]">· אין משחקים כרגע</span>
      ) : null}
    </button>
  );
}

export function CompetitionChips({
  competitions,
  activeId,
  onSelect,
  onReorder,
  onOpenPicker,
}: {
  competitions: Competition[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onReorder: (ids: string[]) => void;
  onOpenPicker: () => void;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 300, tolerance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } }),
  );

  const dragged = competitions.find((c) => c.id === draggingId) ?? null;

  const handleDragStart = (event: DragStartEvent) => {
    setDraggingId(String(event.active.id));
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate?.(10);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDraggingId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = competitions.map((c) => c.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(ids, from, to));
  };

  return (
    <div className="flex items-center gap-2">
      <div className="scrollbar-none -ms-4 flex flex-1 gap-2 overflow-x-auto ps-4 pb-1">
        {competitions.length === 0 ? (
          <span className="py-1.5 text-xs text-muted-foreground">לא נבחרו תחרויות</span>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToHorizontalAxis]}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setDraggingId(null)}
          >
            <SortableContext
              items={competitions.map((c) => c.id)}
              strategy={horizontalListSortingStrategy}
            >
              {competitions.map((c) => (
                <SortableChip
                  key={c.id}
                  competition={c}
                  active={activeId === c.id}
                  onSelect={onSelect}
                />
              ))}
            </SortableContext>

            <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2,0,0,1)" }}>
              {dragged ? (
                <span
                  className={cn(
                    "inline-block scale-110 rounded-2xl px-3 py-1.5 text-xs font-medium shadow-card ring-2 ring-brand",
                    activeId === dragged.id
                      ? "bg-brand-gradient text-brand-foreground"
                      : "bg-surface-2 text-foreground",
                  )}
                >
                  {dragged.name}
                </span>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      <button
        type="button"
        aria-label="בחירת תחרויות"
        onClick={onOpenPicker}
        className="shrink-0 rounded-2xl bg-surface p-2 text-muted-foreground transition-colors active:bg-surface-2"
      >
        <SlidersHorizontal className="size-4" aria-hidden />
      </button>
    </div>
  );
}
