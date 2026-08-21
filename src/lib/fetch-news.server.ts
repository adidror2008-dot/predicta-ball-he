import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SOURCE = "ynet";

/** Ynet RSS feeds, football first. No API key required. */
const FEEDS = [
  { url: "https://www.ynet.co.il/Integration/StoryRss57.xml", label: "כדורגל ישראלי" },
  { url: "https://www.ynet.co.il/Integration/StoryRss3.xml", label: "ספורט" },
] as const;

const MAX_ITEMS_PER_FEED = 40;

export type FetchNewsResult = {
  status: "success" | "partial" | "failed";
  feeds_fetched: number;
  items_parsed: number;
  rows_upserted: number;
  errors: string[];
};

type ParsedItem = {
  external_id: string;
  source: string;
  title_he: string;
  summary_he: string | null;
  url: string;
  image_url: string | null;
  published_at: string | null;
};

function tag(block: string, name: string): string | null {
  const re = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i");
  const m = re.exec(block);
  if (!m || m[1] == null) return null;
  const raw = m[1].trim();
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(raw);
  return (cdata?.[1] ?? raw).trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function stripHtml(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function firstImage(description: string): string | null {
  const m = /<img[^>]+src=['"]([^'"]+)['"]/i.exec(description);
  return m?.[1] ?? null;
}

function parseFeed(xml: string): ParsedItem[] {
  const items: ParsedItem[] = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];

  for (const block of blocks.slice(0, MAX_ITEMS_PER_FEED)) {
    const title = tag(block, "title");
    const link = tag(block, "link");
    if (!title || !link) continue;

    const guid = tag(block, "guid") ?? link;
    const description = tag(block, "description") ?? "";
    const summary = stripHtml(description);
    const pubDate = tag(block, "pubDate");
    const published = pubDate ? new Date(pubDate) : null;

    items.push({
      external_id: guid,
      source: SOURCE,
      title_he: decodeEntities(title),
      summary_he: summary.length > 0 ? summary : null,
      url: link,
      image_url: firstImage(description),
      published_at:
        published && !Number.isNaN(published.getTime()) ? published.toISOString() : null,
    });
  }

  return items;
}

export async function runFetchNews(): Promise<FetchNewsResult> {
  const startedAt = new Date().toISOString();
  const errors: string[] = [];
  const byId = new Map<string, ParsedItem>();
  let feedsFetched = 0;

  for (const feed of FEEDS) {
    try {
      const response = await fetch(feed.url, {
        headers: { accept: "application/rss+xml, application/xml, text/xml" },
      });
      if (!response.ok) {
        errors.push(`${feed.label}: HTTP ${response.status}`);
        continue;
      }
      feedsFetched += 1;
      for (const item of parseFeed(await response.text())) {
        if (!byId.has(item.external_id)) byId.set(item.external_id, item);
      }
    } catch (error) {
      errors.push(`${feed.label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const items = [...byId.values()];
  let upserted = 0;

  if (items.length > 0) {
    const fetchedAt = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from("news")
      .upsert(
        items.map((item) => ({ ...item, fetched_at: fetchedAt })),
        { onConflict: "external_id,source" },
      )
      .select("id");
    if (error) errors.push(error.message);
    else upserted = data?.length ?? 0;
  }

  const status: FetchNewsResult["status"] =
    feedsFetched === 0 ? "failed" : errors.length > 0 ? "partial" : "success";

  const result: FetchNewsResult = {
    status,
    feeds_fetched: feedsFetched,
    items_parsed: items.length,
    rows_upserted: upserted,
    errors,
  };

  await supabaseAdmin.from("job_runs").insert({
    job_name: "fetch-news",
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    status,
    result_metric: upserted,
    result_detail: result as unknown as Record<string, unknown>,
    error: errors.length > 0 ? errors.join(" | ") : null,
  });

  return result;
}
