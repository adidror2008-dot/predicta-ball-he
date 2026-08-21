import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  pendingMs: 0,
  pendingComponent: AuthPending,
  component: () => <Outlet />,
});

function AuthPending() {
  return (
    <div className="min-h-screen bg-background px-4 pt-6" aria-busy="true">
      <div className="h-8 w-40 animate-pulse rounded-xl bg-card" />
      <div className="mt-4 flex gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-9 w-24 animate-pulse rounded-full bg-card" />
        ))}
      </div>
      <div className="mt-6 space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 w-full animate-pulse rounded-2xl bg-card" />
        ))}
      </div>
      <span className="sr-only">בודק התחברות…</span>
    </div>
  );
}
