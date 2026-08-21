import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ensurePushSubscription } from "@/lib/push-client";

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/** Followed match ids for the signed-in user. */
export function useMatchFollows() {
  return useQuery({
    queryKey: ["match-follows"],
    queryFn: async (): Promise<string[]> => {
      const userId = await currentUserId();
      if (!userId) return [];
      const { data } = await supabase
        .from("match_follows")
        .select("match_id")
        .eq("user_id", userId);
      return (data ?? []).map((r) => r.match_id);
    },
    staleTime: 30_000,
  });
}

/** Followed competition ids for the signed-in user. */
export function useCompetitionFollows() {
  return useQuery({
    queryKey: ["competition-follows"],
    queryFn: async (): Promise<string[]> => {
      const userId = await currentUserId();
      if (!userId) return [];
      const { data } = await supabase
        .from("competition_follows")
        .select("competition_id")
        .eq("user_id", userId);
      return (data ?? []).map((r) => r.competition_id);
    },
    staleTime: 30_000,
  });
}

type ToggleInput = { id: string; following: boolean };

function useToggle(
  table: "match_follows" | "competition_follows",
  column: "match_id" | "competition_id",
  queryKey: string,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, following }: ToggleInput) => {
      const userId = await currentUserId();
      if (!userId) throw new Error("no session");

      if (following) {
        const { error } = await supabase
          .from(table)
          .delete()
          .eq("user_id", userId)
          .eq(column, id);
        if (error) throw error;
        return { following: false };
      }

      // First follow ever also asks for browser permission and stores the subscription.
      await ensurePushSubscription();
      const { error } = await supabase.from(table).insert({ user_id: userId, [column]: id });
      if (error && error.code !== "23505") throw error;
      return { following: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [queryKey] });
    },
    onError: () => {
      toast.error("הפעולה נכשלה, נסו שוב");
    },
  });
}

export function useToggleMatchFollow() {
  return useToggle("match_follows", "match_id", "match-follows");
}

export function useToggleCompetitionFollow() {
  return useToggle("competition_follows", "competition_id", "competition-follows");
}
