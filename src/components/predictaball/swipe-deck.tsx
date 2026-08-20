import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const LOCK_DISTANCE = 10;
const HORIZONTAL_RATIO = 1.5;
const COMMIT_RATIO = 0.22;
const FLICK_VELOCITY = 0.5; // px per ms
const EDGE_RESISTANCE = 0.25;
const EASING = "cubic-bezier(0.22, 0.61, 0.36, 1)";
const DURATION = 240;

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/**
 * Horizontal swipe between sibling panels.
 * `children(i)` renders the panel at index `i`; neighbours are rendered only
 * while a drag is in flight so the user sees a real preview, not a blank slide.
 */
export function SwipeDeck({
  index,
  count,
  onIndexChange,
  children,
  className,
}: {
  index: number;
  count: number;
  onIndexChange: (next: number) => void;
  children: (index: number) => ReactNode;
  className?: string;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const mode = useRef<"idle" | "pending" | "horizontal" | "vertical">("idle");
  const suppressClick = useRef(false);

  const [offset, setOffset] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [dragging, setDragging] = useState(false);

  const inert = count <= 1;

  const width = () => containerRef.current?.offsetWidth ?? 1;

  const indexDeltaForPhysicalDrag = useCallback((dx: number): 1 | -1 => {
    const direction = containerRef.current
      ? window.getComputedStyle(containerRef.current).direction
      : "rtl";
    const towardRight = dx > 0;
    return direction === "rtl"
      ? towardRight
        ? -1
        : 1
      : towardRight
        ? 1
        : -1;
  }, []);

  const reset = useCallback(() => {
    start.current = null;
    mode.current = "idle";
    setDragging(false);
  }, []);

  const springBack = useCallback(() => {
    setAnimating(true);
    setOffset(0);
    window.setTimeout(() => {
      setAnimating(false);
      setDragging(false);
    }, DURATION);
  }, []);

  const commit = useCallback(
    (dir: 1 | -1) => {
      const next = index + dir;
      if (reducedMotion) {
        setOffset(0);
        setDragging(false);
        onIndexChange(next);
        return;
      }
      setAnimating(true);
      // dir = +1 (next competition) slides the track toward the screen start.
      setOffset(-dir * width());
      window.setTimeout(() => {
        setAnimating(false);
        setDragging(false);
        setOffset(0);
        onIndexChange(next);
      }, DURATION);
    },
    [index, onIndexChange, reducedMotion],
  );

  const onTouchStart = (e: React.TouchEvent) => {
    if (inert || animating) return;
    const t = e.touches[0]!;
    start.current = { x: t.clientX, y: t.clientY, t: Date.now() };
    mode.current = "pending";
    suppressClick.current = false;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const s = start.current;
    if (!s || mode.current === "vertical") return;
    const t = e.touches[0]!;
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;

    if (mode.current === "pending") {
      if (Math.abs(dx) < LOCK_DISTANCE && Math.abs(dy) < LOCK_DISTANCE) return;
      if (Math.abs(dx) > Math.abs(dy) * HORIZONTAL_RATIO) {
        mode.current = "horizontal";
        suppressClick.current = true;
        setDragging(true);
      } else {
        mode.current = "vertical";
        return;
      }
    }

    const dir = indexDeltaForPhysicalDrag(dx);
    const atEdge = dir === 1 ? index >= count - 1 : index <= 0;
    const applied = atEdge ? dx * EDGE_RESISTANCE : dx;
    if (!reducedMotion) setOffset(applied);
  };

  const onTouchEnd = () => {
    const s = start.current;
    if (!s || mode.current !== "horizontal") {
      reset();
      return;
    }
    const raw = reducedMotion ? offsetFromLastRef.current : offset;
    const elapsed = Math.max(1, Date.now() - s.t);
    const velocity = Math.abs(raw) / elapsed;
    const dir = indexDeltaForPhysicalDrag(raw);
    const atEdge = dir === 1 ? index >= count - 1 : index <= 0;
    const passed = Math.abs(raw) > width() * COMMIT_RATIO || velocity > FLICK_VELOCITY;

    start.current = null;
    mode.current = "idle";

    if (!atEdge && passed) commit(dir);
    else if (reducedMotion) {
      setDragging(false);
      setOffset(0);
    } else springBack();
  };

  // Reduced motion never translates, so the raw delta is tracked separately.
  const offsetFromLastRef = useRef(0);
  useEffect(() => {
    offsetFromLastRef.current = offset;
  }, [offset]);

  const onTouchMoveWrapper = (e: React.TouchEvent) => {
    onTouchMove(e);
    if (reducedMotion && start.current && mode.current === "horizontal") {
      offsetFromLastRef.current = e.touches[0]!.clientX - start.current.x;
    }
  };

  if (inert) return <div className={className}>{children(index)}</div>;

  const showNeighbors = dragging && !reducedMotion;
  const gap = 16;

  return (
    <div
      ref={containerRef}
      className={cn("relative", showNeighbors && "overflow-hidden", className)}
      style={{ touchAction: "pan-y" }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMoveWrapper}
      onTouchEnd={onTouchEnd}
      onTouchCancel={() => {
        reset();
        if (!reducedMotion) springBack();
      }}
      onClickCapture={(e) => {
        if (suppressClick.current) {
          e.preventDefault();
          e.stopPropagation();
          suppressClick.current = false;
        }
      }}
    >
      <div
        style={{
          transform: `translate3d(${reducedMotion ? 0 : offset}px, 0, 0)`,
          transition: animating ? `transform ${DURATION}ms ${EASING}` : undefined,
        }}
      >
        {children(index)}

        {showNeighbors && index > 0 ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 w-full"
            style={{ transform: `translate3d(calc(-100% - ${gap}px), 0, 0)`, insetInlineStart: 0 }}
          >
            {children(index - 1)}
          </div>
        ) : null}

        {showNeighbors && index < count - 1 ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 w-full"
            style={{ transform: `translate3d(calc(100% + ${gap}px), 0, 0)`, insetInlineStart: 0 }}
          >
            {children(index + 1)}
          </div>
        ) : null}
      </div>
    </div>
  );
}
