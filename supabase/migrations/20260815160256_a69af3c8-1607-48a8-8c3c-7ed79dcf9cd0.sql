-- ============ EXTENSIONS ============
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- ============ SHARED HELPERS ============
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;

-- ============ COMPETITIONS ============
create table public.competitions (
  id uuid primary key default gen_random_uuid(),
  external_id text,
  source text,
  name_he text not null,
  name_en text,
  country text,
  display_type text check (display_type in ('league','cup','international')),
  season_calc_method text not null check (season_calc_method in ('aug_may','calendar')),
  tournament_id text,
  current_season_id text,
  home_advantage numeric default 1.05,
  logo_url text,
  sort_order int,
  is_active boolean default true,
  fetched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (external_id, source)
);
grant select on public.competitions to anon, authenticated;
grant all on public.competitions to service_role;
alter table public.competitions enable row level security;
create policy "competitions readable" on public.competitions for select to anon, authenticated using (true);
create trigger competitions_updated_at before update on public.competitions for each row execute function public.set_updated_at();

-- ============ TEAMS ============
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  external_id text,
  source text,
  name_he text,
  name_en text,
  short_name text,
  country text,
  logo_url text,
  logo_checked_at timestamptz,
  history_checked_at timestamptz,
  elo numeric,
  clubelo_rating numeric,
  clubelo_updated_at timestamptz,
  fetched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (external_id, source)
);
grant select on public.teams to anon, authenticated;
grant all on public.teams to service_role;
alter table public.teams enable row level security;
create policy "teams readable" on public.teams for select to anon, authenticated using (true);
create index idx_teams_source on public.teams(source);
create trigger teams_updated_at before update on public.teams for each row execute function public.set_updated_at();

-- ============ TEAM ALIASES ============
create table public.team_aliases (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  alias text not null,
  source text not null,
  created_at timestamptz not null default now(),
  unique (alias, source)
);
grant select on public.team_aliases to anon, authenticated;
grant all on public.team_aliases to service_role;
alter table public.team_aliases enable row level security;
create policy "team_aliases readable" on public.team_aliases for select to anon, authenticated using (true);

-- ============ PLAYERS ============
create table public.players (
  id uuid primary key default gen_random_uuid(),
  external_id text,
  source text,
  team_id uuid references public.teams(id) on delete set null,
  name_he text,
  name_en text,
  position text,
  shirt_number int,
  photo_url text,
  photo_checked_at timestamptz,
  fetched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (external_id, source)
);
grant select on public.players to anon, authenticated;
grant all on public.players to service_role;
alter table public.players enable row level security;
create policy "players readable" on public.players for select to anon, authenticated using (true);
create trigger players_updated_at before update on public.players for each row execute function public.set_updated_at();

-- ============ MATCHES ============
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  external_id text,
  source text,
  competition_id uuid references public.competitions(id) on delete set null,
  home_team_id uuid references public.teams(id) on delete set null,
  away_team_id uuid references public.teams(id) on delete set null,
  kickoff_at timestamptz,
  time_confirmed boolean not null default false,
  status text,
  minute int,
  home_score int,
  away_score int,
  venue text,
  is_neutral boolean not null default false,
  round text,
  season text,
  needs_review boolean default false,
  live_source text,
  fetched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (external_id, source)
);
grant select on public.matches to anon, authenticated;
grant all on public.matches to service_role;
alter table public.matches enable row level security;
create policy "matches readable" on public.matches for select to anon, authenticated using (true);
create index idx_matches_kickoff on public.matches(kickoff_at);
create index idx_matches_comp_season on public.matches(competition_id, season);
create index idx_matches_status on public.matches(status);
create trigger matches_updated_at before update on public.matches for each row execute function public.set_updated_at();

-- ============ LINEUPS ============
create table public.lineups (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  player_id uuid references public.players(id) on delete set null,
  is_starting boolean,
  position text,
  shirt_number int,
  formation text,
  fetched_at timestamptz,
  created_at timestamptz not null default now(),
  unique (match_id, player_id)
);
grant select on public.lineups to anon, authenticated;
grant all on public.lineups to service_role;
alter table public.lineups enable row level security;
create policy "lineups readable" on public.lineups for select to anon, authenticated using (true);
create index idx_lineups_match on public.lineups(match_id);

-- ============ EVENTS ============
create table public.events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  external_id text,
  source text,
  minute int,
  added_minute int,
  type text,
  team_id uuid references public.teams(id) on delete set null,
  player_id uuid references public.players(id) on delete set null,
  related_player_id uuid references public.players(id) on delete set null,
  detail text,
  home_score int,
  away_score int,
  created_at timestamptz not null default now()
);
grant select on public.events to anon, authenticated;
grant all on public.events to service_role;
alter table public.events enable row level security;
create policy "events readable" on public.events for select to anon, authenticated using (true);
create index idx_events_match on public.events(match_id);
create unique index idx_events_external on public.events(external_id, source) where external_id is not null;

-- ============ MATCH STATS ============
create table public.match_stats (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  stat_key text,
  stat_value numeric,
  period text,
  fetched_at timestamptz,
  unique (match_id, team_id, stat_key, period)
);
grant select on public.match_stats to anon, authenticated;
grant all on public.match_stats to service_role;
alter table public.match_stats enable row level security;
create policy "match_stats readable" on public.match_stats for select to anon, authenticated using (true);

-- ============ PLAYER RATINGS ============
create table public.player_ratings (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  player_id uuid references public.players(id) on delete set null,
  rating numeric,
  source text,
  fetched_at timestamptz,
  unique (match_id, player_id, source)
);
grant select on public.player_ratings to anon, authenticated;
grant all on public.player_ratings to service_role;
alter table public.player_ratings enable row level security;
create policy "player_ratings readable" on public.player_ratings for select to anon, authenticated using (true);

-- ============ PREDICTIONS ============
create table public.predictions (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null unique references public.matches(id) on delete cascade,
  engine_version text not null default 'v7',
  predicted_home_score int,
  predicted_away_score int,
  prob_home numeric,
  prob_draw numeric,
  prob_away numeric,
  expected_total_goals numeric,
  prob_over_2_5 numeric,
  prob_under_2_5 numeric,
  prob_btts numeric,
  lambda_home numeric,
  lambda_away numeric,
  confidence numeric,
  reasons_he jsonb,
  explanation_he text,
  score_matrix jsonb,
  computed_at timestamptz,
  next_update_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select on public.predictions to anon, authenticated;
grant all on public.predictions to service_role;
alter table public.predictions enable row level security;
create policy "predictions readable" on public.predictions for select to anon, authenticated using (true);
create trigger predictions_updated_at before update on public.predictions for each row execute function public.set_updated_at();

-- ============ STANDINGS ============
create table public.standings (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid references public.competitions(id) on delete cascade,
  season text,
  team_id uuid references public.teams(id) on delete cascade,
  position int,
  played int,
  won int,
  drawn int,
  lost int,
  goals_for int,
  goals_against int,
  goal_diff int,
  points int,
  form text,
  computed_at timestamptz,
  unique (competition_id, season, team_id)
);
grant select on public.standings to anon, authenticated;
grant all on public.standings to service_role;
alter table public.standings enable row level security;
create policy "standings readable" on public.standings for select to anon, authenticated using (true);
create index idx_standings_comp_season on public.standings(competition_id, season);

-- ============ NEWS ============
create table public.news (
  id uuid primary key default gen_random_uuid(),
  external_id text,
  source text default 'ynet',
  title_he text,
  summary_he text,
  url text,
  image_url text,
  published_at timestamptz,
  fetched_at timestamptz,
  unique (external_id, source)
);
grant select on public.news to anon, authenticated;
grant all on public.news to service_role;
alter table public.news enable row level security;
create policy "news readable" on public.news for select to anon, authenticated using (true);

-- ============ PROFILES ============
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "own profile select" on public.profiles for select to authenticated using (auth.uid() = id);
create policy "own profile update" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
create policy "own profile insert" on public.profiles for insert to authenticated with check (auth.uid() = id);

create or replace function public.is_admin(_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = _user_id and is_admin = true);
$$;

-- ============ USER PREFERENCES ============
create table public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  notifications_enabled boolean default false,
  notify_lineups boolean default true,
  notify_kickoff boolean default true,
  notify_result boolean default true,
  chip_order jsonb,
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.user_preferences to authenticated;
grant all on public.user_preferences to service_role;
alter table public.user_preferences enable row level security;
create policy "own prefs" on public.user_preferences for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger user_preferences_updated_at before update on public.user_preferences for each row execute function public.set_updated_at();

-- ============ PUSH SUBSCRIPTIONS ============
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text unique,
  p256dh text,
  auth text,
  user_agent text,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;
alter table public.push_subscriptions enable row level security;
create policy "own push subs" on public.push_subscriptions for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============ COMPETITION FOLLOWS ============
create table public.competition_follows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  competition_id uuid not null references public.competitions(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, competition_id)
);
grant select, insert, update, delete on public.competition_follows to authenticated;
grant all on public.competition_follows to service_role;
alter table public.competition_follows enable row level security;
create policy "own follows" on public.competition_follows for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============ NOTIFICATIONS SENT ============
create table public.notifications_sent (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  kind text not null check (kind in ('lineups','kickoff','result')),
  sent_at timestamptz not null default now(),
  unique (user_id, match_id, kind)
);
grant all on public.notifications_sent to service_role;
alter table public.notifications_sent enable row level security;

-- ============ APP SETTINGS ============
create table public.app_settings (
  id int primary key default 1 check (id = 1),
  max_users int not null default 20 check (max_users between 1 and 100),
  updated_at timestamptz not null default now()
);
grant select on public.app_settings to authenticated;
grant update on public.app_settings to authenticated;
grant all on public.app_settings to service_role;
alter table public.app_settings enable row level security;
create policy "admins read app settings" on public.app_settings for select to authenticated using (public.is_admin(auth.uid()));
create policy "admins update app settings" on public.app_settings for update to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
insert into public.app_settings (id) values (1);

-- ============ BLOCKED EMAILS ============
create table public.blocked_emails (
  email text primary key,
  blocked_at timestamptz not null default now(),
  blocked_by uuid
);
grant select, update on public.blocked_emails to authenticated;
grant all on public.blocked_emails to service_role;
alter table public.blocked_emails enable row level security;
create policy "admins read blocked emails" on public.blocked_emails for select to authenticated using (public.is_admin(auth.uid()));
create policy "admins update blocked emails" on public.blocked_emails for update to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- ============ PLAYER PHOTOS CACHE ============
create table public.player_photos (
  id uuid primary key default gen_random_uuid(),
  player_external_id text,
  source text,
  storage_path text,
  cached_at timestamptz not null default now(),
  unique (player_external_id, source)
);
grant all on public.player_photos to service_role;
alter table public.player_photos enable row level security;

-- ============ SOURCE PERMISSIONS ============
create table public.source_permissions (
  source text primary key,
  can_insert_teams boolean not null default false,
  can_insert_matches boolean not null default false,
  can_insert_competitions boolean not null default false
);
grant all on public.source_permissions to service_role;
alter table public.source_permissions enable row level security;
insert into public.source_permissions (source, can_insert_teams, can_insert_matches, can_insert_competitions) values
  ('sofascore', true, true, true),
  ('football-data', false, true, false),
  ('api-football', false, false, false),
  ('clubelo', false, false, false),
  ('ynet', false, false, false);

create or replace function public.enforce_source_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare allowed boolean;
begin
  if new.source is null then
    raise exception 'source is required for INSERT into %', tg_table_name;
  end if;
  if tg_table_name = 'teams' then
    select can_insert_teams into allowed from public.source_permissions where source = new.source;
  elsif tg_table_name = 'matches' then
    select can_insert_matches into allowed from public.source_permissions where source = new.source;
  elsif tg_table_name = 'competitions' then
    select can_insert_competitions into allowed from public.source_permissions where source = new.source;
  end if;
  if allowed is null then
    raise exception 'unknown source "%" — insert into % denied', new.source, tg_table_name;
  end if;
  if not allowed then
    raise exception 'source "%" is not permitted to insert into %', new.source, tg_table_name;
  end if;
  return new;
end; $$;

create trigger teams_source_guard before insert on public.teams for each row execute function public.enforce_source_insert();
create trigger matches_source_guard before insert on public.matches for each row execute function public.enforce_source_insert();
create trigger competitions_source_guard before insert on public.competitions for each row execute function public.enforce_source_insert();

-- ============ SEASON LOGIC ============
create or replace function public.compute_season(kickoff timestamptz, method text)
returns text language plpgsql immutable set search_path = public as $$
declare y int; m int;
begin
  if kickoff is null then return null; end if;
  y := extract(year from kickoff)::int;
  m := extract(month from kickoff)::int;
  if method = 'calendar' then
    return y::text;
  end if;
  if m >= 7 then
    return y::text || '/' || lpad(((y + 1) % 100)::text, 2, '0');
  else
    return (y - 1)::text || '/' || lpad((y % 100)::text, 2, '0');
  end if;
end; $$;

create or replace function public.set_match_season()
returns trigger language plpgsql security definer set search_path = public as $$
declare m text;
begin
  select season_calc_method into m from public.competitions where id = new.competition_id;
  new.season := public.compute_season(new.kickoff_at, coalesce(m, 'aug_may'));
  return new;
end; $$;

create trigger matches_set_season before insert or update on public.matches for each row execute function public.set_match_season();

-- ============ QUOTAS ============
create table public.api_quotas (
  provider text primary key,
  daily_limit int,
  monthly_limit int,
  per_minute_limit int,
  live_reserve_daily int not null default 0,
  configured boolean not null default false,
  notes text
);
grant all on public.api_quotas to service_role;
alter table public.api_quotas enable row level security;
insert into public.api_quotas (provider, daily_limit, monthly_limit, per_minute_limit, live_reserve_daily, configured, notes) values
  ('sofascore', null, null, null, 0, false, 'RapidAPI plan not yet chosen — owner must set limits'),
  ('football-data', null, null, 10, 0, true, null),
  ('api-football', 100, null, null, 0, true, 'free tier, resets at midnight');

create table public.api_usage (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  period_month text not null,
  category text not null check (category in ('live','lineups','bulk')),
  calls int not null default 0,
  unique (provider, period_month, category)
);
grant all on public.api_usage to service_role;
alter table public.api_usage enable row level security;

create table public.api_usage_daily (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  day date not null,
  category text not null check (category in ('live','lineups','bulk')),
  calls int not null default 0,
  unique (provider, day, category)
);
grant all on public.api_usage_daily to service_role;
alter table public.api_usage_daily enable row level security;

create or replace function public.api_budget_take(p_provider text, p_category text, p_count int default 1)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  q public.api_quotas%rowtype;
  today_calls int;
  month_calls int;
  ceiling_daily int;
  today date := (now() at time zone 'utc')::date;
  pmonth text := to_char(now() at time zone 'utc', 'YYYY-MM');
begin
  select * into q from public.api_quotas where provider = p_provider;
  if not found or q.configured = false then
    return false;
  end if;
  if p_category not in ('live','lineups','bulk') then
    return false;
  end if;

  select coalesce(sum(calls),0) into today_calls from public.api_usage_daily where provider = p_provider and day = today;
  select coalesce(sum(calls),0) into month_calls from public.api_usage where provider = p_provider and period_month = pmonth;

  if q.daily_limit is not null then
    if p_category = 'live' then
      ceiling_daily := q.daily_limit;
    else
      ceiling_daily := q.daily_limit - coalesce(q.live_reserve_daily, 0);
    end if;
    if today_calls + p_count > ceiling_daily then
      return false;
    end if;
  end if;

  if q.monthly_limit is not null and month_calls + p_count > q.monthly_limit then
    return false;
  end if;

  insert into public.api_usage_daily (provider, day, category, calls)
    values (p_provider, today, p_category, p_count)
    on conflict (provider, day, category) do update set calls = public.api_usage_daily.calls + p_count;
  insert into public.api_usage (provider, period_month, category, calls)
    values (p_provider, pmonth, p_category, p_count)
    on conflict (provider, period_month, category) do update set calls = public.api_usage.calls + p_count;

  return true;
end; $$;

-- ============ JOB RUNS ============
create table public.job_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text check (status in ('success','partial','failed','skipped')),
  result_metric int,
  result_detail jsonb,
  error text
);
grant all on public.job_runs to service_role;
alter table public.job_runs enable row level security;

-- ============ PRIVATE SCHEMA / CRON GATEWAY ============
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.config (
  key text primary key,
  value text
);
revoke all on private.config from public, anon, authenticated;

create or replace function private.call_fn(fn_name text)
returns bigint language plpgsql security definer set search_path = private, public, extensions as $$
declare
  secret text;
  base_url text;
  req_id bigint;
begin
  select value into secret from private.config where key = 'cron_secret';
  if secret is null or secret = '' then
    raise exception 'cron secret is not configured — refusing to send unauthenticated request';
  end if;
  select value into base_url from private.config where key = 'functions_base_url';
  if base_url is null or base_url = '' then
    raise exception 'functions_base_url is not configured';
  end if;
  select net.http_post(
    url := base_url || '/' || fn_name,
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', secret),
    body := '{}'::jsonb
  ) into req_id;
  return req_id;
end; $$;

-- ============ NEW USER TRIGGER ============
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  lower_email text := lower(coalesce(new.email, ''));
  limit_users int;
  current_users int;
begin
  if exists (select 1 from public.blocked_emails where email = lower_email) then
    raise exception 'signup blocked for this email';
  end if;

  select max_users into limit_users from public.app_settings where id = 1;
  select count(*) into current_users from public.profiles;
  if limit_users is not null and current_users >= limit_users then
    raise exception 'user limit reached';
  end if;

  insert into public.profiles (id, email, display_name, is_admin)
  values (new.id, new.email, new.raw_user_meta_data ->> 'display_name', lower_email = 'adidror2008@gmail.com')
  on conflict (id) do nothing;

  insert into public.user_preferences (user_id) values (new.id)
  on conflict (user_id) do nothing;

  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ============ REALTIME ============
alter table public.matches replica identity full;
alter table public.events replica identity full;
alter publication supabase_realtime add table public.matches;
alter publication supabase_realtime add table public.events;

-- ============ COMPETITIONS SEED ============
insert into public.competitions (source, name_he, tournament_id, display_type, season_calc_method, home_advantage, sort_order) values
  ('sofascore', 'ליגת העל', '266', 'league', 'aug_may', 1.05, 1),
  ('sofascore', 'גביע המדינה', '370', 'cup', 'aug_may', 1.05, 2),
  ('sofascore', 'גביע הטוטו על', '9355', 'cup', 'aug_may', 1.05, 3),
  ('sofascore', 'גביע הטוטו לאומית', '9356', 'cup', 'aug_may', 1.05, 4);