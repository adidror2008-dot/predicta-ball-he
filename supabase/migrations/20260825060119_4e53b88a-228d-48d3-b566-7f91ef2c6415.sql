ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS explanation_he text,
  ADD COLUMN IF NOT EXISTS explanation_at timestamptz;