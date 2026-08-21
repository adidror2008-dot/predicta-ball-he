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

export function useToggleMatchFollow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, following }: ToggleInput) => {
      const userId = await currentUserId();
      if (!userId) throw new Error("no session");

      if (following) {
        const { error } = await supabase
          .from("match_follows")
          .delete()
          .eq("user_id", userId)
          .eq("match_id", id);
        if (error) throw error;
        return { following: false };
      }

      // First follow ever also asks for browser permission and stores the subscription.
      await ensurePushSubscription();
      const { error } = await supabase
        .from("match_follows")
        .insert({ user_id: userId, match_id: id });
      if (error && error.code !== "23505") throw error;
      return { following: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["match-follows"] });
      queryClient.invalidateQueries({ queryKey: ["settings-followed-matches"] });
    },
    onError: () => toast.error("הפעולה נכשלה, נסו שוב"),
  });
}

export function useToggleCompetitionFollow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, following }: ToggleInput) => {
      const userId = await currentUserId();
      if (!userId) throw new Error("no session");

      if (following) {
        const { error } = await supabase
          .from("competition_follows")
          .delete()
          .eq("user_id", userId)
          .eq("competition_id", id);
        if (error) throw error;
        return { following: false };
      }

      await ensurePushSubscription();
      const { error } = await supabase
        .from("competition_follows")
        .insert({ user_id: userId, competition_id: id });
      if (error && error.code !== "23505") throw error;
      return { following: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["competition-follows"] });
      queryClient.invalidateQueries({ queryKey: ["settings-followed-competitions"] });
    },
    onError: () => toast.error("הפעולה נכשלה, נסו שוב"),
  });
}
