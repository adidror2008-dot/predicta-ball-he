select cron.schedule(
  'predictaball-fetch-news',
  '10 4 * * *',
  $$
  select net.http_post(
    url := 'https://project--a9163e81-d4e2-4a11-ab5a-c420296e1843-dev.lovable.app/api/public/fetch-news',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.cron_config where key = 'cron_secret')
    ),
    body := '{}'::jsonb
  )
  $$
);