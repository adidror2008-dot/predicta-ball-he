import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "התחברות | PredictaBall" },
      {
        name: "description",
        content: "התחברות או הרשמה ל-PredictaBall — תחזיות כדורגל, תוצאות חיות והרכבים.",
      },
      { property: "og:title", content: "התחברות | PredictaBall" },
      {
        property: "og:description",
        content: "התחברות או הרשמה ל-PredictaBall — תחזיות כדורגל, תוצאות חיות והרכבים.",
      },
    ],
  }),
  component: AuthPage,
});

type Mode = "signin" | "signup" | "forgot";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="no-mirror size-5" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.6l6.2 5.2C36.9 40.3 44 35 44 24c0-1.3-.1-2.6-.4-3.9z"
      />
    </svg>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
  placeholder,
  autoComplete,
  reveal,
}: {
  label: string;
  type: "text" | "email" | "password";
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  reveal?: boolean;
}) {
  const [shown, setShown] = useState(false);
  const isPassword = type === "password";
  const inputType = isPassword && shown ? "text" : type;

  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</span>
      <div className="relative">
        <input
          type={inputType}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          dir={type === "email" ? "ltr" : undefined}
          className={cn(
            "w-full rounded-2xl border border-border bg-surface-2 px-4 py-3 text-sm text-foreground outline-none",
            "placeholder:text-muted-foreground focus:border-brand focus:ring-2 focus:ring-ring/40",
            type === "email" && "text-start",
            isPassword && reveal !== false && "pe-11",
          )}
        />
        {isPassword && reveal !== false ? (
          <button
            type="button"
            onClick={() => setShown((s) => !s)}
            aria-label={shown ? "הסתר סיסמה" : "הצג סיסמה"}
            className="absolute inset-y-0 end-0 flex items-center px-3 text-muted-foreground"
          >
            {shown ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
          </button>
        ) : null}
      </div>
    </label>
  );
}

function toHebrewError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "מייל או סיסמה שגויים";
  if (m.includes("email not confirmed")) return "המייל עדיין לא אומת. בדוק את תיבת הדואר";
  if (m.includes("user already registered") || m.includes("already registered"))
    return "כתובת המייל כבר רשומה במערכת";
  if (m.includes("password should be")) return "הסיסמה חייבת להכיל לפחות 6 תווים";
  if (m.includes("blocked")) return "כתובת המייל חסומה להרשמה";
  if (m.includes("limit reached")) return "מכסת המשתמשים באפליקציה מלאה";
  if (m.includes("database error"))
    return "ההרשמה נחסמה: כתובת המייל חסומה או שמכסת המשתמשים מלאה";
  if (m.includes("rate limit")) return "יותר מדי ניסיונות. נסה שוב בעוד כמה דקות";
  return "אירעה שגיאה. נסה שוב";
}

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("signin");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active && data.session) void navigate({ to: "/", replace: true });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) void navigate({ to: "/", replace: true });
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [navigate]);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setNotice(null);
    setPassword("");
    setConfirm("");
  }

  async function handleGoogle() {
    setError(null);
    setBusy(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      setBusy(false);
      setError("ההתחברות עם Google נכשלה. נסה שוב");
      return;
    }
    if (result.redirected) return;
    void navigate({ to: "/", replace: true });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (mode === "signup") {
      if (fullName.trim().length < 2) {
        setError("יש להזין שם מלא");
        return;
      }
      if (password !== confirm) {
        setError("הסיסמאות אינן תואמות");
        return;
      }
      if (password.length < 6) {
        setError("הסיסמה חייבת להכיל לפחות 6 תווים");
        return;
      }
    }

    setBusy(true);
    try {
      if (mode === "signin") {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) setError(toHebrewError(err.message));
      } else if (mode === "signup") {
        const { data, error: err } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { display_name: fullName.trim() },
          },
        });
        if (err) setError(toHebrewError(err.message));
        else if (!data.session)
          setNotice("נשלח אליך מייל אימות. יש ללחוץ על הקישור כדי להשלים את ההרשמה");
      } else {
        const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (err) setError(toHebrewError(err.message));
        else setNotice("אם הכתובת קיימת במערכת, נשלח אליה קישור לאיפוס סיסמה");
      }
    } finally {
      setBusy(false);
    }
  }

  const title =
    mode === "signin" ? "התחברות" : mode === "signup" ? "הרשמה" : "שחזור סיסמה";

  return (
    <main className="min-h-screen px-4 pb-10 pt-10">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="font-brand text-3xl font-extrabold text-brand-gradient">PredictaBall</p>
          <h1 className="mt-3 text-xl font-bold text-foreground">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "forgot"
              ? "נשלח קישור לאיפוס הסיסמה לכתובת המייל שלך"
              : "תחזיות, תוצאות חיות והרכבים — במקום אחד"}
          </p>
        </div>

        <div className="rounded-2xl bg-card p-5 shadow-card">
          {mode !== "forgot" ? (
            <>
              <button
                type="button"
                onClick={handleGoogle}
                disabled={busy}
                className="flex w-full items-center justify-center gap-3 rounded-2xl border border-border bg-surface-2 px-4 py-3 text-sm font-bold text-foreground transition-transform active:scale-95 disabled:opacity-60"
              >
                <GoogleIcon />
                התחברות עם Google
              </button>

              <div className="my-5 flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">או</span>
                <span className="h-px flex-1 bg-border" />
              </div>
            </>
          ) : null}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {mode === "signup" ? (
              <Field
                label="שם מלא"
                type="text"
                value={fullName}
                onChange={setFullName}
                placeholder="ישראל ישראלי"
                autoComplete="name"
              />
            ) : null}

            <Field
              label="כתובת מייל"
              type="email"
              value={email}
              onChange={setEmail}
              placeholder="name@example.com"
              autoComplete="email"
            />

            {mode !== "forgot" ? (
              <Field
                label="סיסמה"
                type="password"
                value={password}
                onChange={setPassword}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
              />
            ) : null}

            {mode === "signup" ? (
              <Field
                label="אימות סיסמה"
                type="password"
                value={confirm}
                onChange={setConfirm}
                autoComplete="new-password"
              />
            ) : null}

            {error ? (
              <p className="rounded-xl bg-surface-2 px-3 py-2 text-xs text-destructive">{error}</p>
            ) : null}
            {notice ? (
              <p className="rounded-xl bg-surface-2 px-3 py-2 text-xs text-status-win">{notice}</p>
            ) : null}

            <button
              type="submit"
              disabled={busy}
              className="mt-1 flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-gradient px-4 py-3 text-sm font-bold text-brand-foreground transition-transform active:scale-95 disabled:opacity-60"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {mode === "signin" ? "התחברות" : mode === "signup" ? "הרשמה" : "שליחת קישור איפוס"}
            </button>
          </form>

          <div className="mt-5 flex flex-col items-center gap-2 text-xs">
            {mode === "signin" ? (
              <>
                <button
                  type="button"
                  onClick={() => switchMode("forgot")}
                  className="text-muted-foreground underline-offset-4 hover:underline"
                >
                  שכחתי סיסמה
                </button>
                <button
                  type="button"
                  onClick={() => switchMode("signup")}
                  className="text-foreground"
                >
                  אין לך חשבון? <span className="font-bold text-brand-3">הרשמה</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => switchMode("signin")}
                className="text-foreground"
              >
                יש לך כבר חשבון? <span className="font-bold text-brand-3">התחברות</span>
              </button>
            )}
          </div>
        </div>

        <div className="mt-6 text-center">
          <Link to="/" className="text-xs text-muted-foreground underline-offset-4 hover:underline">
            חזרה למשחקים
          </Link>
        </div>
      </div>
    </main>
  );
}
