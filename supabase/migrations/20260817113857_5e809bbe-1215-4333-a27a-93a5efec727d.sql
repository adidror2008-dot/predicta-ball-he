ALTER TABLE public.competitions ADD COLUMN IF NOT EXISTS current_season_confirmed boolean NOT NULL DEFAULT false;
UPDATE public.competitions SET current_season_confirmed = true WHERE tournament_id IN ('266','7','679','17','8','325');
UPDATE public.competitions SET current_season_confirmed = false WHERE tournament_id IN ('370','9355','9356');
-- derived rule: a competition that already has matches in the computed current season is confirmed
UPDATE public.competitions c
SET current_season_confirmed = true
WHERE EXISTS (
  SELECT 1 FROM public.matches m
  WHERE m.competition_id = c.id
    AND m.season = public.compute_season(now(), coalesce(c.season_calc_method,'aug_may'))
);