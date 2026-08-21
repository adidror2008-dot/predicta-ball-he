import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { getIsAdmin } from "@/lib/admin.functions";

/**
 * Client-side convenience only — the real enforcement lives in the database
 * (RLS policies + public.is_admin). Never trust this value for access control.
 */
export function useIsAdmin() {
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const fetchIsAdmin = useServerFn(getIsAdmin);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setUserId(data.session?.user.id ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const query = useQuery({
    queryKey: ["is-admin", userId],
    enabled: Boolean(userId),
    staleTime: 60_000,
    queryFn: () => fetchIsAdmin(),
  });

  return {
    isAdmin: query.data?.isAdmin === true,
    isLoading: userId === undefined || (Boolean(userId) && query.isLoading),
  };
}
