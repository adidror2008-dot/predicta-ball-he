import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronLeft, Loader2, LogOut, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { EmptyState, SectionTitle } from "@/components/predictaball/ui-bits";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "הגדרות — PredictaBall" },
      {
        name: "description",
        content: "ניהול התראות, תחרויות למעקב ומידע על האפליקציה.",
      },
      { property: "og:title", content: "הגדרות — PredictaBall" },
      {
        property: "og:description",
        content: "ניהול התראות, תחרויות למעקב ומידע על האפליקציה.",
      },
    ],
  }),
  component: SettingsScreen,
});

type FollowedCompetition = { id: string; name: string };

const subToggles = [
  { id: "lineup", label: "הרכב רשמי פורסם" },
  { id: "kickoff", label: "המשחק מתחיל בעוד שעה" },
  { id: "final", label: "המשחק הסתיים" },
] as const;

function SettingsScreen() {
  const [master, setMaster] = useState(false);
  const [subs, setSubs] = useState<Record<string, boolean>>({
    lineup: false,
    kickoff: false,
    final: false,
  });
  const followed: FollowedCompetition[] = [];

  return (
    <main className="space-y-6 px-4 pt-5">
      <h1 className="text-xl font-bold">הגדרות</h1>

      <section>
        <SectionTitle>התראות</SectionTitle>
        <div className="rounded-2xl bg-card p-4 shadow-card">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">קבלת התראות</span>
            <Switch checked={master} onCheckedChange={setMaster} aria-label="קבלת התראות" />
          </div>

          <div className="mt-3 space-y-3 border-t border-border pt-3">
            {subToggles.map((t) => (
              <div
                key={t.id}
                className={cn(
                  "flex items-center justify-between gap-3 transition-opacity",
                  !master && "opacity-40",
                )}
              >
                <span className="text-sm">{t.label}</span>
                <Switch
                  checked={master && subs[t.id] === true}
                  disabled={!master}
                  aria-label={t.label}
                  onCheckedChange={(v) => setSubs((s) => ({ ...s, [t.id]: v }))}
                />
              </div>
            ))}
          </div>

          <p className="mt-4 text-xs text-muted-foreground">
            באייפון יש להוסיף את האפליקציה למסך הבית כדי לקבל התראות.
          </p>
        </div>
      </section>

      <section>
        <SectionTitle>תחרויות במעקב</SectionTitle>
        {followed.length === 0 ? (
          <EmptyState text="לא נבחרו תחרויות למעקב" />
        ) : (
          <ul className="space-y-2">
            {followed.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between rounded-2xl bg-card p-3 shadow-card"
              >
                <span className="text-sm">{c.name}</span>
                <button
                  type="button"
                  aria-label={`הסרת ${c.name}`}
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
            האפליקציה מציגה לכל משחק תחזית סטטיסטית מוסברת, המבוססת על נתוני עבר,
            כושר הקבוצות ונתוני המשחק — כך שתמיד ברור מדוע התחזית היא כפי שהיא.
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
    </main>
  );
}
