CREATE TABLE IF NOT EXISTS public.clubelo_current (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club text NOT NULL,
  country text,
  level integer,
  elo numeric,
  rank integer,
  snapshot_date date NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (club, snapshot_date)
);

CREATE TABLE IF NOT EXISTS public.clubelo_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club text NOT NULL,
  country text,
  level integer,
  elo numeric NOT NULL,
  valid_from date NOT NULL,
  valid_to date NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (club, valid_from)
);

CREATE INDEX IF NOT EXISTS clubelo_history_club_to_idx ON public.clubelo_history (club, valid_to);

GRANT SELECT ON public.clubelo_current TO authenticated;
GRANT SELECT ON public.clubelo_history TO authenticated;
GRANT ALL ON public.clubelo_current TO service_role;
GRANT ALL ON public.clubelo_history TO service_role;

ALTER TABLE public.clubelo_current ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clubelo_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read clubelo_current" ON public.clubelo_current FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "admins read clubelo_history" ON public.clubelo_history FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));