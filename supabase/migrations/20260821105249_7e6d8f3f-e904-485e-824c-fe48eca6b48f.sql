CREATE TABLE public.match_follows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, match_id)
);

GRANT SELECT, INSERT, DELETE ON public.match_follows TO authenticated;
GRANT ALL ON public.match_follows TO service_role;

ALTER TABLE public.match_follows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own match follows select" ON public.match_follows FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own match follows insert" ON public.match_follows FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own match follows delete" ON public.match_follows FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX idx_match_follows_match ON public.match_follows(match_id);

ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS notify_goals boolean DEFAULT true;