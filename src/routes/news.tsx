import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { EmptyState, SkeletonBlock } from "@/components/predictaball/ui-bits";

export const Route = createFileRoute("/news")({
  head: () => ({
    meta: [
      { title: "חדשות כדורגל — PredictaBall" },
      { name: "description", content: "עדכוני חדשות כדורגל מרוכזים במקום אחד." },
      { property: "og:title", content: "חדשות כדורגל — PredictaBall" },
      {
        property: "og:description",
        content: "עדכוני חדשות כדורגל מרוכזים במקום אחד.",
      },
    ],
  }),
  component: NewsScreen,
});

type NewsItem = {
  id: string;
  headline: string;
  summary: string;
  relativeTime: string;
  imageUrl: string | null;
};

function NewsScreen() {
  const items: NewsItem[] = [];
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(false);
  }, []);

  return (
    <main className="px-4 pt-5">
      <h1 className="mb-4 text-xl font-bold">חדשות</h1>

      <section className="space-y-3">
        {loading ? (
          <>
            <SkeletonBlock className="h-32" />
            <SkeletonBlock className="h-32" />
            <SkeletonBlock className="h-32" />
          </>
        ) : items.length === 0 ? (
          <EmptyState text="אין חדשות להצגה כרגע" />
        ) : (
          items.map((item) => (
            <article
              key={item.id}
              className="flex gap-3 rounded-2xl bg-card p-3 shadow-card transition-colors hover:bg-surface-2"
            >
              <div className="no-mirror size-20 shrink-0 overflow-hidden rounded-2xl bg-surface-2">
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt={item.headline}
                    loading="lazy"
                    className="size-full object-cover"
                  />
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="line-clamp-2 text-sm font-bold">{item.headline}</h2>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  {item.summary}
                </p>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {item.relativeTime}
                </p>
              </div>
            </article>
          ))
        )}
      </section>
    </main>
  );
}
