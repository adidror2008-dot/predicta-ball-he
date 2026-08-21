import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { EmptyState, SkeletonBlock } from "@/components/predictaball/ui-bits";
import { getNewsListFn } from "@/lib/news-read.functions";

export const Route = createFileRoute("/_authenticated/news")({
  head: () => ({
    meta: [
      { title: "חדשות כדורגל — PredictaBall" },
      { name: "description", content: "עדכוני חדשות כדורגל מרוכזים במקום אחד." },
      { property: "og:title", content: "חדשות כדורגל — PredictaBall" },
      {
        property: "og:description",
        content: "עדכוני חדשות כדורגל מרוכזים במקום אחד.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: NewsScreen,
});

const SOURCE_LABELS: Record<string, string> = { ynet: "Ynet" };

function relativeTime(iso: string | null): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const minutes = Math.floor((Date.now() - then) / 60000);
  if (minutes < 1) return "עכשיו";
  if (minutes < 60) return minutes === 1 ? "לפני דקה" : `לפני ${minutes} דקות`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    if (hours === 1) return "לפני שעה";
    if (hours === 2) return "לפני שעתיים";
    return `לפני ${hours} שעות`;
  }
  const days = Math.floor(hours / 24);
  if (days === 1) return "אתמול";
  if (days === 2) return "לפני יומיים";
  return `לפני ${days} ימים`;
}

function NewsScreen() {
  const fetchNews = useServerFn(getNewsListFn);
  const { data, isLoading } = useQuery({
    queryKey: ["news-list"],
    queryFn: () => fetchNews(),
    staleTime: 5 * 60 * 1000,
  });

  const items = data ?? [];
  const [lead, ...rest] = items;

  return (
    <main className="px-4 pt-5">
      <h1 className="mb-4 text-xl font-bold">חדשות</h1>

      {isLoading ? (
        <div className="space-y-3">
          <SkeletonBlock className="h-56" />
          <SkeletonBlock className="h-24" />
          <SkeletonBlock className="h-24" />
          <SkeletonBlock className="h-24" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState text="אין חדשות כרגע" />
      ) : (
        <div className="space-y-4">
          {lead ? (
            <a
              href={lead.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block overflow-hidden rounded-2xl bg-card shadow-card transition-colors hover:bg-surface-2"
            >
              {lead.imageUrl ? (
                <div className="no-mirror aspect-video w-full overflow-hidden bg-surface-2">
                  <img
                    src={lead.imageUrl}
                    alt={lead.title}
                    loading="lazy"
                    className="size-full object-cover"
                  />
                </div>
              ) : null}
              <div className="p-4">
                <h2 className="text-base font-bold leading-snug">{lead.title}</h2>
                {lead.summary ? (
                  <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                    {lead.summary}
                  </p>
                ) : null}
                <p className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="font-semibold text-brand">
                    {SOURCE_LABELS[lead.source] ?? lead.source}
                  </span>
                  {relativeTime(lead.publishedAt) ? (
                    <>
                      <span aria-hidden>•</span>
                      <span>{relativeTime(lead.publishedAt)}</span>
                    </>
                  ) : null}
                </p>
              </div>
            </a>
          ) : null}

          <section className="space-y-3">
            {rest.map((item) => (
              <a
                key={item.id}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex gap-3 rounded-2xl bg-card p-3 shadow-card transition-colors hover:bg-surface-2"
              >
                <div className="no-mirror size-20 shrink-0 overflow-hidden rounded-2xl bg-surface-2">
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt={item.title}
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="line-clamp-2 text-sm font-bold leading-snug">{item.title}</h3>
                  {item.summary ? (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {item.summary}
                    </p>
                  ) : null}
                  <p className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="font-semibold text-brand">
                      {SOURCE_LABELS[item.source] ?? item.source}
                    </span>
                    {relativeTime(item.publishedAt) ? (
                      <>
                        <span aria-hidden>•</span>
                        <span>{relativeTime(item.publishedAt)}</span>
                      </>
                    ) : null}
                  </p>
                </div>
              </a>
            ))}
          </section>
        </div>
      )}
    </main>
  );
}
