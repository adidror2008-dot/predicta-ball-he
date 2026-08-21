import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type NewsListItem = {
  id: string;
  title: string;
  summary: string | null;
  url: string;
  imageUrl: string | null;
  publishedAt: string | null;
  source: string;
};

const DEFAULT_LIMIT = 40;

export async function getNewsList(limit = DEFAULT_LIMIT): Promise<NewsListItem[]> {
  const { data, error } = await supabaseAdmin
    .from("news")
    .select("id, title_he, summary_he, url, image_url, published_at, source")
    .not("url", "is", null)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(Math.max(1, Math.min(limit, 100)));

  if (error) throw error;

  return (data ?? [])
    .filter((row) => row.title_he && row.url)
    .map((row) => ({
      id: row.id,
      title: row.title_he as string,
      summary: row.summary_he,
      url: row.url as string,
      imageUrl: row.image_url,
      publishedAt: row.published_at,
      source: row.source ?? "ynet",
    }));
}
