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
