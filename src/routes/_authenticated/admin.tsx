import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Ban, Loader2, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, SectionTitle, SkeletonBlock } from "@/components/predictaball/ui-bits";
import {
  adminBlockEmail,
  adminDeleteUser,
  adminListUsers,
  adminSetMaxUsers,
  adminUnblockEmail,
} from "@/lib/admin.functions";
import { useIsAdmin } from "@/hooks/use-is-admin";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "ניהול משתמשים — PredictaBall" },
      { name: "description", content: "פאנל ניהול: משתמשים רשומים, חסימות והגבלת נרשמים." },
      { property: "og:title", content: "ניהול משתמשים — PredictaBall" },
      {
        property: "og:description",
        content: "פאנל ניהול: משתמשים רשומים, חסימות והגבלת נרשמים.",
      },
    ],
  }),
  component: AdminScreen,
});

function formatDate(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function AdminScreen() {
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();
  const queryClient = useQueryClient();

  const listUsers = useServerFn(adminListUsers);
  const deleteUser = useServerFn(adminDeleteUser);
  const blockEmail = useServerFn(adminBlockEmail);
  const unblockEmail = useServerFn(adminUnblockEmail);
  const setMaxUsers = useServerFn(adminSetMaxUsers);

  const usersQuery = useQuery({
    queryKey: ["admin-users"],
    enabled: isAdmin,
    queryFn: () => listUsers(),
  });

  const [limit, setLimit] = useState("");
  useEffect(() => {
    if (usersQuery.data?.maxUsers != null) setLimit(String(usersQuery.data.maxUsers));
  }, [usersQuery.data?.maxUsers]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin-users"] });

  const removeMutation = useMutation({
    mutationFn: (userId: string) => deleteUser({ data: { userId } }),
    onSuccess: () => {
      toast.success("המשתמש הוסר");
      invalidate();
    },
    onError: () => toast.error("הסרת המשתמש נכשלה"),
  });

  const blockMutation = useMutation({
    mutationFn: (email: string) => blockEmail({ data: { email } }),
    onSuccess: () => {
      toast.success("המייל נחסם");
      invalidate();
    },
    onError: () => toast.error("החסימה נכשלה"),
  });

  const unblockMutation = useMutation({
    mutationFn: (email: string) => unblockEmail({ data: { email } }),
    onSuccess: () => {
      toast.success("החסימה בוטלה");
      invalidate();
    },
    onError: () => toast.error("ביטול החסימה נכשל"),
  });

  const limitMutation = useMutation({
    mutationFn: (maxUsers: number) => setMaxUsers({ data: { maxUsers } }),
    onSuccess: () => {
      toast.success("מגבלת הנרשמים עודכנה");
      invalidate();
    },
    onError: () => toast.error("עדכון המגבלה נכשל"),
  });

  if (adminLoading) {
    return (
      <main className="space-y-3 px-4 pt-5">
        <SkeletonBlock className="h-8 w-40" />
        <SkeletonBlock className="h-24" />
        <SkeletonBlock className="h-24" />
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="px-4 pt-5">
        <EmptyState text="אין לך הרשאה לצפות בעמוד זה" />
      </main>
    );
  }

  const data = usersQuery.data;

  return (
    <main className="space-y-6 px-4 pt-5">
      <h1 className="text-xl font-bold">ניהול משתמשים</h1>

      <section>
        <SectionTitle>הגבלת כמות נרשמים</SectionTitle>
        <div className="flex items-center gap-3 rounded-2xl bg-card p-4 shadow-card">
          <input
            type="number"
            min={1}
            max={100}
            dir="ltr"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            aria-label="מספר נרשמים מרבי"
            className="w-24 rounded-xl bg-background px-3 py-2 text-center text-sm text-foreground outline-none ring-1 ring-border focus:ring-primary"
          />
          <span className="text-sm text-muted-foreground">בין 1 ל-100</span>
          <button
            type="button"
            disabled={limitMutation.isPending}
            onClick={() => limitMutation.mutate(Number(limit))}
            className="ms-auto rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            שמירה
          </button>
        </div>
      </section>

      <section>
        <SectionTitle>משתמשים רשומים</SectionTitle>
        {usersQuery.isLoading ? (
          <div className="space-y-2">
            <SkeletonBlock className="h-16" />
            <SkeletonBlock className="h-16" />
          </div>
        ) : (data?.users ?? []).length === 0 ? (
          <EmptyState text="אין משתמשים רשומים" />
        ) : (
          <ul className="space-y-2">
            {(data?.users ?? []).map((u) => (
              <li
                key={u.id}
                className="flex items-center justify-between gap-3 rounded-2xl bg-card p-3 shadow-card"
              >
                <div className="min-w-0">
                  <p dir="ltr" className="truncate text-start text-sm">
                    {u.email || "—"}
                  </p>
                  <span dir="ltr" className="text-xs text-muted-foreground">
                    {formatDate(u.createdAt)}
                  </span>
                  {u.blocked ? (
                    <span className="ms-2 text-xs text-destructive">חסום</span>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    aria-label={`חסימת ${u.email}`}
                    disabled={u.blocked || blockMutation.isPending}
                    onClick={() => blockMutation.mutate(u.email)}
                    className="rounded-full p-2 text-muted-foreground transition-colors hover:text-destructive disabled:opacity-40"
                  >
                    <Ban className="size-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={`הסרת ${u.email}`}
                    disabled={removeMutation.isPending}
                    onClick={() => removeMutation.mutate(u.id)}
                    className="rounded-full p-2 text-muted-foreground transition-colors hover:text-destructive disabled:opacity-40"
                  >
                    {removeMutation.isPending ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <Trash2 className="size-4" aria-hidden />
                    )}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionTitle>מיילים חסומים</SectionTitle>
        {usersQuery.isLoading ? (
          <SkeletonBlock className="h-12" />
        ) : (data?.blocked ?? []).length === 0 ? (
          <EmptyState text="אין מיילים חסומים" />
        ) : (
          <ul className="space-y-2">
            {(data?.blocked ?? []).map((email) => (
              <li
                key={email}
                className="flex items-center justify-between gap-3 rounded-2xl bg-card p-3 shadow-card"
              >
                <span dir="ltr" className="truncate text-start text-sm">
                  {email}
                </span>
                <button
                  type="button"
                  aria-label={`ביטול חסימה ל-${email}`}
                  onClick={() => unblockMutation.mutate(email)}
                  className="shrink-0 rounded-full p-2 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Undo2 className="size-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
