import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "איפוס סיסמה | PredictaBall" },
      { name: "description", content: "הגדרת סיסמה חדשה לחשבון PredictaBall שלך." },
      { property: "og:title", content: "איפוס סיסמה | PredictaBall" },
      { property: "og:description", content: "הגדרת סיסמה חדשה לחשבון PredictaBall שלך." },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setHasSession(true);
        setReady(true);
      }
    });
    void supabase.auth.getSession().then(({ data }) => {
      setHasSession(Boolean(data.session));
      setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("הסיסמה חייבת להכיל לפחות 6 תווים");
      return;
    }
    if (password !== confirm) {
      setError("הסיסמאות אינן תואמות");
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) {
      setError("עדכון הסיסמה נכשל. בקש קישור איפוס חדש");
      return;
    }
    setDone(true);
    setTimeout(() => void navigate({ to: "/", replace: true }), 1500);
  }

  return (
    <main className="min-h-screen px-4 pb-10 pt-10">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="font-brand text-3xl font-extrabold text-brand-gradient">PredictaBall</p>
          <h1 className="mt-3 text-xl font-bold text-foreground">סיסמה חדשה</h1>
        </div>

        <div className="rounded-2xl bg-card p-5 shadow-card">
          {!ready ? (
            <div className="h-32 animate-pulse rounded-2xl bg-surface-2" />
          ) : !hasSession ? (
            <div className="text-center">
              <p className="text-sm text-muted-foreground">
                קישור האיפוס אינו תקף או שפג תוקפו. יש לבקש קישור חדש.
              </p>
              <Link
                to="/auth"
                className="mt-5 inline-flex items-center justify-center rounded-2xl bg-brand-gradient px-6 py-2.5 text-sm font-bold text-brand-foreground"
              >
                חזרה להתחברות
              </Link>
            </div>
          ) : done ? (
            <p className="py-6 text-center text-sm text-status-win">
              הסיסמה עודכנה בהצלחה. מעבירים אותך לאפליקציה…
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {(
                [
                  ["סיסמה חדשה", password, setPassword],
                  ["אימות סיסמה", confirm, setConfirm],
                ] as const
              ).map(([label, value, setter]) => (
                <label key={label} className="block">
                  <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    {label}
                  </span>
                  <div className="relative">
                    <input
                      type={shown ? "text" : "password"}
                      value={value}
                      onChange={(e) => setter(e.target.value)}
                      autoComplete="new-password"
                      className="w-full rounded-2xl border border-border bg-surface-2 px-4 py-3 pe-11 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-brand focus:ring-2 focus:ring-ring/40"
                    />
                    <button
                      type="button"
                      onClick={() => setShown((s) => !s)}
                      aria-label={shown ? "הסתר סיסמה" : "הצג סיסמה"}
                      className="absolute inset-y-0 end-0 flex items-center px-3 text-muted-foreground"
                    >
                      {shown ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
                    </button>
                  </div>
                </label>
              ))}

              {error ? (
                <p className="rounded-xl bg-surface-2 px-3 py-2 text-xs text-destructive">
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={busy}
                className="mt-1 flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-gradient px-4 py-3 text-sm font-bold text-brand-foreground transition-transform active:scale-95 disabled:opacity-60"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                עדכון סיסמה
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
