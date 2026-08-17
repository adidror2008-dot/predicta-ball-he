ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS previous_leg_external_id text;
CREATE INDEX IF NOT EXISTS idx_matches_previous_leg_external_id ON public.matches (previous_leg_external_id);