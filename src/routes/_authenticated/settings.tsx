import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronLeft, Loader2, LogOut, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { EmptyState, SectionTitle, SkeletonBlock } from "@/components/predictaball/ui-bits";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { ensurePushSubscription, needsIosHomeScreen } from "@/lib/push-client";
import { useIsAdmin } from "@/hooks/use-is-admin";


export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "הגדרות — PredictaBall" },
      {
        name: "description",
        content: "ניהול התראות, תחרויות ומשחקים במעקב ומידע על האפליקציה.",
      },
      { property: "og:title", content: "הגדרות — PredictaBall" },
      {
        property: "og:description",
        content: "ניהול התראות, תחרויות ומשחקים במעקב ומידע על האפליקציה.",
      },
    ],
  }),
  component: SettingsScreen,
});

type Prefs = {
  notifications_enabled: boolean;
  notify_lineups: boolean;
  notify_kickoff: boolean;
  notify_goals: boolean;
  notify_result: boolean;
};

const DEFAULT_PREFS: Prefs = {
  notifications_enabled: false,
  notify_lineups: true,
  notify_kickoff: true,
  notify_goals: true,
  notify_result: true,
};

const subToggles = [
  { key: "notify_lineups", label: "הרכב רשמי פורסם" },
  { key: "notify_kickoff", label: "שריקת פתיחה" },
  { key: "notify_goals", label: "גול במשחק" },
  { key: "notify_result", label: "המשחק הסתיים" },
] as const;

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

function usePrefs() {
  return useQuery({
    queryKey: ["user-preferences"],
    queryFn: async (): Promise<Prefs> => {
      const userId = await currentUserId();
      if (!userId) return DEFAULT_PREFS;
      const { data } = await supabase
        .from("user_preferences")
        .select("notifications_enabled, notify_lineups, notify_kickoff, notify_goals, notify_result")
        .eq("user_id", userId)
        .maybeSingle();
      if (!data) return DEFAULT_PREFS;
      return {
        notifications_enabled: data.notifications_enabled ?? false,
        notify_lineups: data.notify_lineups ?? true,
        notify_kickoff: data.notify_kickoff ?? true,
        notify_goals: data.notify_goals ?? true,
        notify_result: data.notify_result ?? true,
      };
    },
  });
}

function useFollowedCompetitions() {
  return useQuery({
    queryKey: ["settings-followed-competitions"],
    queryFn: async (): Promise<Array<{ id: string; name: string }>> => {
      const userId = await currentUserId();
      if (!userId) return [];
      const { data: follows } = await supabase
        .from("competition_follows")
        .select("competition_id")
        .eq("user_id", userId);
      const ids = (follows ?? []).map((f) => f.competition_id);
      if (ids.length === 0) return [];
      const { data: comps } = await supabase
        .from("competitions")
        .select("id, name_he, name_en")
        .in("id", ids);
      return (comps ?? []).map((c) => ({
        id: c.id,
        name: c.name_he?.trim() || c.name_en?.trim() || "—",
      }));
    },
  });
}

function useFollowedMatches() {
  return useQuery({
    queryKey: ["settings-followed-matches"],
    queryFn: async (): Promise<Array<{ id: string; title: string; date: string | null }>> => {
      const userId = await currentUserId();
      if (!userId) return [];
      const { data: follows } = await supabase
        .from("match_follows")
        .select("match_id")
        .eq("user_id", userId);
      const ids = (follows ?? []).map((f) => f.match_id);
      if (ids.length === 0) return [];

      const { data: matches } = await supabase
        .from("matches")
        .select("id, kickoff_at, home_team_id, away_team_id, status")
        .in("id", ids)
        .not("status", "eq", "finished")
        .order("kickoff_at", { ascending: true });


      const teamIds = [
        ...new Set(
          (matches ?? []).flatMap((m) =>
            [m.home_team_id, m.away_team_id].filter((v): v is string => Boolean(v)),
          ),
        ),
      ];
      const { data: teams } = teamIds.length
        ? await supabase.from("teams").select("id, name_he, name_en, short_name").in("id", teamIds)
        : { data: [] };

      const nameById = new Map(
        (teams ?? []).map((t) => [
          t.id,
          t.name_he?.trim() || t.name_en?.trim() || t.short_name?.trim() || "—",
        ]),
      );

      return (matches ?? []).map((m) => {
        const kickoff = m.kickoff_at ? new Date(m.kickoff_at) : null;
        const p = (n: number) => String(n).padStart(2, "0");
        return {
          id: m.id,
          title: `${nameById.get(m.home_team_id ?? "") ?? "—"} — ${nameById.get(m.away_team_id ?? "") ?? "—"}`,
          date: kickoff
            ? `${p(kickoff.getDate())}/${p(kickoff.getMonth() + 1)}/${kickoff.getFullYear()}`
            : null,
        };
      });
    },
  });
}

function AdminLink() {
  const { isAdmin } = useIsAdmin();
  if (!isAdmin) return null;
  return (
    <section>
      <SectionTitle>ניהול</SectionTitle>
      <Link
        to="/admin"
        className="flex items-center justify-between rounded-2xl bg-card p-4 shadow-card"
      >
        <span className="text-sm font-medium">ניהול משתמשים</span>
        <ChevronLeft className="size-4 text-muted-foreground" aria-hidden />
      </Link>
    </section>
  );
}

function SettingsScreen() {

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const { data: prefs, isLoading: prefsLoading } = usePrefs();
  const { data: followedCompetitions, isLoading: competitionsLoading } = useFollowedCompetitions();
  const { data: followedMatches, isLoading: matchesLoading } = useFollowedMatches();

  const savePrefs = useMutation({
    mutationFn: async (patch: Partial<Prefs>) => {
      const userId = await currentUserId();
      if (!userId) throw new Error("no session");
      if (patch.notifications_enabled === true) await ensurePushSubscription();
      const { error } = await supabase
        .from("user_preferences")
        .upsert({ user_id: userId, ...patch }, { onConflict: "user_id" });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["user-preferences"] }),
  });

  const unfollowCompetition = useMutation({
    mutationFn: async (competitionId: string) => {
      const userId = await currentUserId();
      if (!userId) return;
      await supabase
        .from("competition_follows")
        .delete()
        .eq("user_id", userId)
        .eq("competition_id", competitionId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings-followed-competitions"] });
      queryClient.invalidateQueries({ queryKey: ["competition-follows"] });
    },
  });

  const unfollowMatch = useMutation({
    mutationFn: async (matchId: string) => {
      const userId = await currentUserId();
      if (!userId) return;
      await supabase
        .from("match_follows")
        .delete()
        .eq("user_id", userId)
        .eq("match_id", matchId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings-followed-matches"] });
      queryClient.invalidateQueries({ queryKey: ["match-follows"] });
    },
  });

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  const master = prefs?.notifications_enabled === true;

  return (
    <main className="space-y-6 px-4 pt-5">
      <h1 className="text-xl font-bold">הגדרות</h1>

      <section>
        <SectionTitle>התראות</SectionTitle>
        {prefsLoading ? (
          <SkeletonBlock className="h-52" />
        ) : (
          <div className="rounded-2xl bg-card p-4 shadow-card">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">קבלת התראות</span>
              <Switch
                checked={master}
                aria-label="קבלת התראות"
                onCheckedChange={(v: boolean) =>
                  savePrefs.mutate({ notifications_enabled: v })
                }
              />
            </div>

            <div className="mt-3 space-y-3 border-t border-border pt-3">
              {subToggles.map((t) => (
                <div
                  key={t.key}
                  className={cn(
                    "flex items-center justify-between gap-3 transition-opacity",
                    !master && "opacity-40",
                  )}
                >
                  <span className="text-sm">{t.label}</span>
                  <Switch
                    checked={master && prefs?.[t.key] === true}
                    disabled={!master}
                    aria-label={t.label}
                    onCheckedChange={(v: boolean) => savePrefs.mutate({ [t.key]: v } as Partial<Prefs>)}
                  />
                </div>
              ))}
            </div>

            {needsIosHomeScreen() ? (
              <p className="mt-4 text-xs text-muted-foreground">
                באייפון יש להוסיף את האפליקציה למסך הבית כדי לקבל התראות.
              </p>
            ) : null}

          </div>
        )}
      </section>

      <section>
        <SectionTitle>תחרויות במעקב</SectionTitle>
        {competitionsLoading ? (
          <div className="space-y-2">
            <SkeletonBlock className="h-12" />
            <SkeletonBlock className="h-12" />
          </div>
        ) : (followedCompetitions ?? []).length === 0 ? (
          <EmptyState text="לא נבחרו תחרויות למעקב" />
        ) : (
          <ul className="space-y-2">
            {(followedCompetitions ?? []).map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between rounded-2xl bg-card p-3 shadow-card"
              >
                <span className="text-sm">{c.name}</span>
                <button
                  type="button"
                  aria-label={`הסרת ${c.name}`}
                  onClick={() => unfollowCompetition.mutate(c.id)}
                  className="rounded-full p-1.5 text-muted-foreground transition-colors hover:text-destructive"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionTitle>משחקים במעקב</SectionTitle>
        {matchesLoading ? (
          <div className="space-y-2">
            <SkeletonBlock className="h-12" />
            <SkeletonBlock className="h-12" />
          </div>
        ) : (followedMatches ?? []).length === 0 ? (
          <EmptyState text="לא נבחרו משחקים למעקב" />
        ) : (
          <ul className="space-y-2">
            {(followedMatches ?? []).map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between gap-3 rounded-2xl bg-card p-3 shadow-card"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">{m.title}</p>
                  {m.date ? (
                    <span dir="ltr" className="text-xs text-muted-foreground">
                      {m.date}
                    </span>
                  ) : null}
                </div>
                <button
                  type="button"
                  aria-label={`הסרת ${m.title}`}
                  onClick={() => unfollowMatch.mutate(m.id)}
                  className="shrink-0 rounded-full p-1.5 text-muted-foreground transition-colors hover:text-destructive"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AdminLink />

      <section>
        <SectionTitle>המודל</SectionTitle>
        <Link
          to="/accuracy"
          className="flex items-center justify-between rounded-2xl bg-card p-4 shadow-card"
        >
          <span className="text-sm font-medium">דיוק המודל</span>
          <ChevronLeft className="size-4 text-muted-foreground" aria-hidden />
        </Link>
      </section>


      <section>
        <SectionTitle>אודות</SectionTitle>

        <div className="rounded-2xl bg-card p-4 shadow-card">
          <img
            src="/predictaball-logo-source.jpg"
            alt="PredictaBall"
            className="no-mirror w-full rounded-2xl"
          />
          <p className="mt-4 font-brand text-lg font-extrabold">
            <span className="text-foreground">Predicta</span>
            <span className="text-brand-gradient">Ball</span>
          </p>
          <p className="text-xs text-muted-foreground">כדורגל · חיזוי · כיף</p>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            האפליקציה מציגה לכל משחק תחזית סטטיסטית מוסברת, המבוססת על נתוני עבר, כושר הקבוצות
            ונתוני המשחק — כך שתמיד ברור מדוע התחזית היא כפי שהיא.
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            מקורות: נתוני משחקים ותחרויות ממקורות רשמיים.
          </p>
          <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-xs">
            <span className="text-muted-foreground">עודכן לאחרונה</span>
            <span dir="ltr" className="text-muted-foreground">
              —
            </span>
          </div>
        </div>
      </section>

      <section className="mt-6 border-t border-border pt-6">
        <button
          type="button"
          onClick={handleSignOut}
          disabled={isSigningOut}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-destructive px-4 py-3 font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-60"
        >
          {isSigningOut ? (
            <Loader2 className="size-5 animate-spin" aria-hidden />
          ) : (
            <LogOut className="size-5" aria-hidden />
          )}
          <span>{isSigningOut ? "מתנתק..." : "התנתקות"}</span>
        </button>
      </section>
    </main>
  );
}
