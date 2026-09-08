ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS stats_checked_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS incidents_checked_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS matches_unresolved_kickoff_idx
  ON public.matches (kickoff_at)
  WHERE status IS NULL OR status NOT IN ('finished','canceled','postponed','awarded','removed');