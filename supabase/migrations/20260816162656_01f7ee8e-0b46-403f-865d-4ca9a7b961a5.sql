CREATE TABLE public.team_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_external_id text NOT NULL,
  source text NOT NULL DEFAULT 'sofascore',
  external_id text NOT NULL,
  opponent_external_id text,
  opponent_name text,
  is_home boolean NOT NULL,
  goals_for integer,
  goals_against integer,
  result text,
  played_at timestamptz,
  tournament_id text,
  unique_tournament_id text,
  competition_name text,
  category_name text,
  season text,
  raw jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_history_unique_event UNIQUE (team_external_id, source, external_id)
);

GRANT SELECT ON public.team_history TO authenticated;
GRANT ALL ON public.team_history TO service_role;

ALTER TABLE public.team_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_history readable by authenticated"
  ON public.team_history FOR SELECT TO authenticated USING (true);

CREATE INDEX team_history_team_played_idx ON public.team_history (team_external_id, source, played_at DESC);
CREATE INDEX team_history_unique_tournament_idx ON public.team_history (unique_tournament_id);

CREATE TRIGGER team_history_updated_at
  BEFORE UPDATE ON public.team_history
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();