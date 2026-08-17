ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS stage text,
  ADD COLUMN IF NOT EXISTS round_name text,
  ADD COLUMN IF NOT EXISTS round_number integer,
  ADD COLUMN IF NOT EXISTS is_qualifier boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS leg smallint,
  ADD COLUMN IF NOT EXISTS tie_key text,
  ADD COLUMN IF NOT EXISTS aggregate_home integer,
  ADD COLUMN IF NOT EXISTS aggregate_away integer;

CREATE INDEX IF NOT EXISTS matches_kickoff_at_idx ON public.matches (kickoff_at);
CREATE INDEX IF NOT EXISTS matches_competition_kickoff_idx ON public.matches (competition_id, kickoff_at);
CREATE INDEX IF NOT EXISTS matches_is_qualifier_idx ON public.matches (is_qualifier) WHERE is_qualifier = true;