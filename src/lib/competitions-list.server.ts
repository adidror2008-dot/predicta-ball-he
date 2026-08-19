import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type CompetitionListItem = {
  id: string;
  name: string;
  nameEn: string | null;
  country: string | null;
};

export async function getCompetitionsList(): Promise<CompetitionListItem[]> {
  const { data, error } = await supabaseAdmin
    .from("competitions")
    .select("id, name_he, name_en, country, sort_order")
    .eq("is_active", true)
    .order("sort_order", { ascending: true, nullsFirst: false });

  if (error) throw new Error(error.message);

  return (data ?? [])
    .map((c) => ({
      id: c.id,
      name: (c.name_he || c.name_en) ?? "",
      nameEn: c.name_en,
      country: c.country,
    }))
    .filter((c) => c.name.length > 0);
}
