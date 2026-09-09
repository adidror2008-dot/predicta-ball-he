create table if not exists public.api_usage_minute (
  provider text not null,
  minute timestamptz not null,
  calls integer not null default 0,
  primary key (provider, minute)
);

grant all on public.api_usage_minute to service_role;
alter table public.api_usage_minute enable row level security;

alter table public.api_quotas
  add column if not exists cycle_start_day smallint,
  add column if not exists cycle_limit integer;

comment on column public.api_quotas.cycle_start_day is
  'Day of month the provider billing cycle starts (1-28). NULL = calendar month.';
comment on column public.api_quotas.cycle_limit is
  'Operating ceiling for one billing cycle. NULL falls back to monthly_limit.';

create or replace function public.api_budget_take(
  p_provider text,
  p_category text,
  p_count integer default 1
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  q public.api_quotas%rowtype;
  today_calls int;
  cycle_calls int;
  minute_calls int;
  ceiling_daily int;
  cycle_cap int;
  today date := (now() at time zone 'utc')::date;
  pmonth text := to_char(now() at time zone 'utc', 'YYYY-MM');
  this_minute timestamptz := date_trunc('minute', now());
  cycle_start date;
  anchor int;
begin
  if p_count is null or p_count <= 0 then
    return false;
  end if;
  if p_category not in ('live','lineups','bulk') then
    return false;
  end if;

  select * into q from public.api_quotas where provider = p_provider for update;
  if not found or q.configured = false then
    return false;
  end if;

  if q.per_minute_limit is not null then
    select coalesce(calls, 0) into minute_calls
      from public.api_usage_minute
     where provider = p_provider and minute = this_minute;
    if coalesce(minute_calls, 0) + p_count > q.per_minute_limit then
      return false;
    end if;
  end if;

  if q.daily_limit is not null then
    select coalesce(sum(calls), 0) into today_calls
      from public.api_usage_daily where provider = p_provider and day = today;
    if p_category = 'live' then
      ceiling_daily := q.daily_limit;
    else
      ceiling_daily := q.daily_limit - coalesce(q.live_reserve_daily, 0);
    end if;
    if today_calls + p_count > ceiling_daily then
      return false;
    end if;
  end if;

  cycle_cap := coalesce(q.cycle_limit, q.monthly_limit);
  if cycle_cap is not null then
    if q.cycle_start_day is null then
      cycle_start := date_trunc('month', today)::date;
    else
      anchor := least(greatest(q.cycle_start_day, 1), 28);
      cycle_start := make_date(extract(year from today)::int, extract(month from today)::int, anchor);
      if today < cycle_start then
        cycle_start := (cycle_start - interval '1 month')::date;
      end if;
    end if;
    select coalesce(sum(calls), 0) into cycle_calls
      from public.api_usage_daily
     where provider = p_provider and day >= cycle_start;
    if cycle_calls + p_count > cycle_cap then
      return false;
    end if;
  end if;

  insert into public.api_usage_minute (provider, minute, calls)
    values (p_provider, this_minute, p_count)
    on conflict (provider, minute) do update
      set calls = public.api_usage_minute.calls + p_count;

  insert into public.api_usage_daily (provider, day, category, calls)
    values (p_provider, today, p_category, p_count)
    on conflict (provider, day, category) do update
      set calls = public.api_usage_daily.calls + p_count;

  insert into public.api_usage (provider, period_month, category, calls)
    values (p_provider, pmonth, p_category, p_count)
    on conflict (provider, period_month, category) do update
      set calls = public.api_usage.calls + p_count;

  delete from public.api_usage_minute
   where provider = p_provider and minute < this_minute - interval '2 hours';

  return true;
end;
$function$;

revoke execute on function public.api_budget_take(text, text, integer) from public, anon, authenticated;
grant execute on function public.api_budget_take(text, text, integer) to service_role;

create or replace function public.api_budget_status(p_provider text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  q public.api_quotas%rowtype;
  today date := (now() at time zone 'utc')::date;
  cycle_start date;
  cycle_end date;
  anchor int;
  cycle_cap int;
  used_today int;
  used_cycle int;
begin
  select * into q from public.api_quotas where provider = p_provider;
  if not found then
    return jsonb_build_object('provider', p_provider, 'configured', false);
  end if;

  cycle_cap := coalesce(q.cycle_limit, q.monthly_limit);
  if q.cycle_start_day is null then
    cycle_start := date_trunc('month', today)::date;
  else
    anchor := least(greatest(q.cycle_start_day, 1), 28);
    cycle_start := make_date(extract(year from today)::int, extract(month from today)::int, anchor);
    if today < cycle_start then
      cycle_start := (cycle_start - interval '1 month')::date;
    end if;
  end if;
  cycle_end := (cycle_start + interval '1 month')::date;

  select coalesce(sum(calls), 0) into used_today
    from public.api_usage_daily where provider = p_provider and day = today;
  select coalesce(sum(calls), 0) into used_cycle
    from public.api_usage_daily where provider = p_provider and day >= cycle_start;

  return jsonb_build_object(
    'provider', p_provider,
    'configured', q.configured,
    'daily_limit', q.daily_limit,
    'live_reserve_daily', q.live_reserve_daily,
    'per_minute_limit', q.per_minute_limit,
    'cycle_limit', cycle_cap,
    'cycle_start', cycle_start,
    'cycle_end', cycle_end,
    'used_today', used_today,
    'used_cycle', used_cycle,
    'cycle_remaining', case when cycle_cap is null then null else cycle_cap - used_cycle end,
    'days_left_in_cycle', greatest((cycle_end - today), 1),
    'pace_per_day', case when cycle_cap is null then null
      else floor((cycle_cap - used_cycle)::numeric / greatest((cycle_end - today), 1)) end
  );
end;
$function$;

revoke execute on function public.api_budget_status(text) from public, anon;
grant execute on function public.api_budget_status(text) to service_role;

create table if not exists public.match_provider_map (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  provider text not null,
  provider_fixture_id bigint not null,
  league_id integer,
  season integer,
  round text,
  evidence jsonb not null default '{}'::jsonb,
  verified_at timestamptz not null default now(),
  unique (provider, provider_fixture_id),
  unique (match_id, provider)
);

create index if not exists match_provider_map_match_idx on public.match_provider_map (match_id);

grant all on public.match_provider_map to service_role;
alter table public.match_provider_map enable row level security;

insert into public.api_quotas
  (provider, daily_limit, monthly_limit, per_minute_limit, live_reserve_daily, configured, cycle_start_day, cycle_limit, notes)
values
  ('api-football', 6000, null, 300, 1800, true, null, null,
   'PRO plan verified 7500/day at provider. Internal operating ceiling 6000/day keeps 1500/day provider headroom; 1800/day reserved for once-per-minute live polling. Per-minute cap 300 mirrors the provider rate limit.')
on conflict (provider) do update set
  daily_limit = excluded.daily_limit,
  per_minute_limit = excluded.per_minute_limit,
  live_reserve_daily = excluded.live_reserve_daily,
  configured = true,
  notes = excluded.notes;

update public.api_quotas
   set notes = coalesce(notes, '') ||
       ' | 2026-09-09: cycle limit stays a conservative 9500 (calendar month) until the real RapidAPI billing-cycle start day is supplied; set api_quotas.cycle_start_day to switch to the true cycle.'
 where provider = 'sofascore'
   and notes not like '%cycle_start_day%';