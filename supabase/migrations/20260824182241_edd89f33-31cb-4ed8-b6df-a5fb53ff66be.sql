CREATE TABLE public.backtest_results (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  label text,
  model_version text NOT NULL,
  params_effective jsonb NOT NULL DEFAULT '{}'::jsonb,
  config_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  n integer NOT NULL,
  n_excluded integer NOT NULL,
  n_candidates integer NOT NULL,
  rps_avg numeric,
  brier_avg numeric,
  winner_accuracy numeric,
  exact_score_accuracy numeric,
  over_under_accuracy numeric,
  goal_bucket_accuracy numeric,
  naive_baseline_rps numeric,
  naive_winner_accuracy numeric,
  date_from timestamptz,
  date_to timestamptz,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.backtest_predictions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES public.backtest_results(id) ON DELETE CASCADE,
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  competition_id uuid,
  kickoff_at timestamptz,
  pred_home integer NOT NULL,
  pred_away integer NOT NULL,
  actual_home integer NOT NULL,
  actual_away integer NOT NULL,
  prob_home numeric NOT NULL,
  prob_draw numeric NOT NULL,
  prob_away numeric NOT NULL,
  prob_over_2_5 numeric NOT NULL,
  lambda_home numeric NOT NULL,
  lambda_away numeric NOT NULL,
  elo_home numeric,
  elo_away numeric,
  confidence integer NOT NULL,
  confidence_band text NOT NULL,
  hit_winner boolean NOT NULL,
  hit_exact boolean NOT NULL,
  hit_ou25 boolean NOT NULL,
  hit_goal_bucket boolean NOT NULL,
  rps numeric NOT NULL,
  brier numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, match_id)
);

CREATE INDEX backtest_predictions_run_idx ON public.backtest_predictions (run_id);

GRANT SELECT ON public.backtest_results TO authenticated;
GRANT SELECT ON public.backtest_predictions TO authenticated;
GRANT ALL ON public.backtest_results TO service_role;
GRANT ALL ON public.backtest_predictions TO service_role;

ALTER TABLE public.backtest_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backtest_predictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read backtest results" ON public.backtest_results
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "admins read backtest predictions" ON public.backtest_predictions
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));