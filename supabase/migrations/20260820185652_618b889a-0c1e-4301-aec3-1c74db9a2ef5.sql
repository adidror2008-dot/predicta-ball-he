ALTER TABLE public.lineups ADD COLUMN IF NOT EXISTS sort_order integer;
CREATE INDEX IF NOT EXISTS lineups_match_team_sort_idx ON public.lineups (match_id, team_id, sort_order);
INSERT INTO public.api_quotas (provider, daily_limit, monthly_limit, per_minute_limit, live_reserve_daily, configured, notes)
VALUES ('sofascore-cdn', 1500, NULL, NULL, 0, true, 'Keyless img.sofascore.com player image CDN — photos only')
ON CONFLICT (provider) DO UPDATE SET daily_limit = EXCLUDED.daily_limit, live_reserve_daily = 0, configured = true, notes = EXCLUDED.notes;