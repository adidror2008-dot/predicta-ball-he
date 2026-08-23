import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Server-side admin check. The single source of truth is the database
 * function public.is_admin(uuid), which resolves the admin email from
 * public.admin_email(). Nothing here hardcodes an email address.
 */
export const getIsAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("is_admin", {
      _user_id: context.userId,
    });
    if (error) return { isAdmin: false };
    return { isAdmin: data === true };
  });

type AuthedContext = {
  supabase: { rpc: (fn: "is_admin", args: { _user_id: string }) => Promise<{ data: unknown }> };
  userId: string;
};

async function assertAdmin(context: AuthedContext) {
  const { data } = await context.supabase.rpc("is_admin", { _user_id: context.userId });
  if (data !== true) throw new Error("Forbidden");
}

export const adminListUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context as unknown as AuthedContext);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: authUsers, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
    if (error) throw new Error(error.message);

    const { data: blocked } = await supabaseAdmin.from("blocked_emails").select("email");
    const blockedSet = new Set((blocked ?? []).map((b) => b.email));

    const { data: settings } = await supabaseAdmin
      .from("app_settings")
      .select("max_users")
      .eq("id", 1)
      .maybeSingle();

    return {
      maxUsers: settings?.max_users ?? null,
      blocked: (blocked ?? []).map((b) => b.email),
      users: authUsers.users.map((u) => ({
        id: u.id,
        email: u.email ?? "",
        createdAt: u.created_at,
        blocked: blockedSet.has((u.email ?? "").trim().toLowerCase()),
      })),
    };
  });

export const adminDeleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context as unknown as AuthedContext);
    if (data.userId === context.userId) throw new Error("cannot delete self");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminBlockEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { email: string }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context as unknown as AuthedContext);
    const email = data.email.trim().toLowerCase();
    if (!email) throw new Error("email required");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("blocked_emails")
      .upsert({ email, blocked_by: context.userId }, { onConflict: "email" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminUnblockEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { email: string }) => input)
  .handler(async ({ data, context }) => {
    await assertAdmin(context as unknown as AuthedContext);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("blocked_emails")
      .delete()
      .eq("email", data.email.trim().toLowerCase());
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminSetMaxUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { maxUsers: number }) => {
    const n = Math.floor(Number(input.maxUsers));
    if (!Number.isFinite(n) || n < 1 || n > 100) throw new Error("maxUsers must be 1..100");
    return { maxUsers: n };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context as unknown as AuthedContext);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("app_settings")
      .update({ max_users: data.maxUsers, updated_at: new Date().toISOString() })
      .eq("id", 1);
    if (error) throw new Error(error.message);
    return { ok: true, maxUsers: data.maxUsers };
  });

/** Public: used by the sign-in screen to refuse blocked accounts. */
export const isEmailBlocked = createServerFn({ method: "POST" })
  .inputValidator((input: { email: string }) => input)
  .handler(async ({ data }) => {
    const email = data.email.trim().toLowerCase();
    if (!email) return { blocked: false };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("blocked_emails")
      .select("email")
      .eq("email", email)
      .maybeSingle();
    return { blocked: Boolean(row) };
  });
