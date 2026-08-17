CREATE TABLE IF NOT EXISTS public.cron_config (
  key text PRIMARY KEY,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.cron_config TO service_role;

ALTER TABLE public.cron_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cron_config service only" ON public.cron_config
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS cron_config_updated_at ON public.cron_config;
CREATE TRIGGER cron_config_updated_at
  BEFORE UPDATE ON public.cron_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
