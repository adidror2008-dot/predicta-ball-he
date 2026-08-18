REVOKE EXECUTE ON FUNCTION public.recompute_internal_elo() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.recompute_competition_baselines() FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.recompute_internal_elo() TO service_role;
GRANT EXECUTE ON FUNCTION public.recompute_competition_baselines() TO service_role;