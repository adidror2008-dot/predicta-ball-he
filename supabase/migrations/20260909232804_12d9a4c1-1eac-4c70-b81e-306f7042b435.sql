-- ---------------------------------------------------------------- discovery state
create table if not exists public.provider_discovery (
  provider text not null,
  league_id integer not null,
  season integer not null,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_fixture_count integer,
  resolved_count integer not null default 0,
  unresolved_count integer not null default 0,
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (provider, league_id, season)
);

grant all on public.provider_discovery to service_role;
alter table public.provider_discovery enable row level security;

create trigger provider_discovery_updated_at
  before update on public.provider_discovery
  for each row execute function public.set_updated_at();

-- ------------------------------------------------- mapping freshness metadata
alter table public.match_provider_map
  add column if not exists provider_kickoff_at timestamptz,
  add column if not exists provider_status text,
  add column if not exists last_checked_at timestamptz,
  add column if not exists next_check_at timestamptz;

create index if not exists match_provider_map_next_check_idx
  on public.match_provider_map (provider, next_check_at nulls first);

-- ------------------------------------------------------- provider usage baseline
alter table public.api_quotas
  add column if not exists reported_period date,
  add column if not exists reported_used integer,
  add column if not exists reported_at timestamptz,
  add column if not exists pace_enabled boolean not null default true;

comment on column public.api_quotas.reported_used is
  'Highest usage the provider itself reported for reported_period. Used as a conservative floor next to the local counter, never added to it.';
comment on column public.api_quotas.cycle_start_day is
  'Day of month the provider billing cycle starts (1-31, clamped to the last day of short months). NULL = calendar month.';

create or replace function public.api_budget_note_reported(
  p_provider text,
  p_period date,
  p_used integer
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_provider is null or p_period is null or p_used is null or p_used < 0 then
    return;
  end if;
  update public.api_quotas
     set reported_period = p_period,
         -- monotone inside one period; a new period starts from the new value
         reported_used = case
           when reported_period = p_period then greatest(coalesce(reported_used, 0), p_used)
           else p_used
         end,
         reported_at = now()
   where provider = p_provider;
end;
$function$;

revoke all on function public.api_budget_note_reported(text, date, integer) from public;
revoke all on function public.api_budget_note_reported(text, date, integer) from anon;
revoke all on function public.api_budget_note_reported(text, date, integer) from authenticated;
grant execute on function public.api_budget_note_reported(text, date, integer) to service_role;

-- ------------------------------------------------------------------ budget take
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
  cycle_end date;
  days_left int;
  anchor int;
  month_days int;
  pace_allow int;
  reserve_rest int;
begin
  -- invalid input fails closed and never counts
  if p_provider is null or p_count is null or p_count <= 0 then
    return false;
  end if;
  if p_category is null or p_category not in ('live','lineups','bulk') then
    return false;
  end if;

  select * into q from public.api_quotas where provider = p_provider for update;
  if not found or q.configured = false then
    return false;
  end if;

  -- per-minute
  if q.per_minute_limit is not null then
    select coalesce(calls, 0) into minute_calls
      from public.api_usage_minute
     where provider = p_provider and minute = this_minute;
    if coalesce(minute_calls, 0) + p_count > q.per_minute_limit then
      return false;
    end if;
  end if;

  -- local counter, raised to the provider-reported floor for the same day
  select coalesce(sum(calls), 0) into today_calls
    from public.api_usage_daily where provider = p_provider and day = today;
  if q.reported_period = today then
    today_calls := greatest(today_calls, coalesce(q.reported_used, 0));
  end if;

  -- billing cycle boundaries (UTC). NULL anchor = calendar month.
  cycle_cap := coalesce(q.cycle_limit, q.monthly_limit);
  if q.cycle_start_day is null then
    cycle_start := date_trunc('month', today)::date;
  else
    anchor := least(greatest(q.cycle_start_day, 1), 31);
    month_days := extract(day from (date_trunc('month', today) + interval '1 month - 1 day'))::int;
    cycle_start := make_date(
      extract(year from today)::int,
      extract(month from today)::int,
      least(anchor, month_days));
    if today < cycle_start then
      cycle_start := (date_trunc('month', cycle_start) - interval '1 month')::date;
      month_days := extract(day from (date_trunc('month', cycle_start) + interval '1 month - 1 day'))::int;
      cycle_start := cycle_start + least(anchor, month_days) - 1;
    end if;
  end if;
  cycle_end := (date_trunc('month', cycle_start) + interval '1 month')::date
               + (cycle_start - date_trunc('month', cycle_start)::date);
  days_left := greatest(cycle_end - today, 1);

  if cycle_cap is not null then
    select coalesce(sum(calls), 0) into cycle_calls
      from public.api_usage_daily
     where provider = p_provider and day >= cycle_start;
    if cycle_calls + p_count > cycle_cap then
      return false;
    end if;
  end if;

  -- daily ceiling: live may use the whole day, other work leaves the live reserve
  if q.daily_limit is not null then
    if p_category = 'live' then
      ceiling_daily := q.daily_limit;
    else
      ceiling_daily := q.daily_limit - coalesce(q.live_reserve_daily, 0);
    end if;
  end if;

  -- reserve-aware pacing for non-live work: keep the live reserve for every
  -- remaining day of the cycle and spread the rest evenly.
  if p_category <> 'live' and q.pace_enabled and cycle_cap is not null then
    reserve_rest := coalesce(q.live_reserve_daily, 0) * days_left;
    pace_allow := greatest(floor((greatest(cycle_cap - cycle_calls - reserve_rest, 0))::numeric / days_left)::int, 0);
    if ceiling_daily is null then
      ceiling_daily := pace_allow;
    else
      ceiling_daily := least(ceiling_daily, pace_allow);
    end if;
  end if;

  if ceiling_daily is not null and today_calls + p_count > ceiling_daily then
    return false;
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

revoke all on function public.api_budget_take(text, text, integer) from public;
revoke all on function public.api_budget_take(text, text, integer) from anon;
revoke all on function public.api_budget_take(text, text, integer) from authenticated;
grant execute on function public.api_budget_take(text, text, integer) to service_role;

-- ----------------------------------------------------------------- budget status
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
  month_days int;
  cycle_cap int;
  used_today int;
  used_cycle int;
  days_left int;
begin
  select * into q from public.api_quotas where provider = p_provider;
  if not found then
    return jsonb_build_object('provider', p_provider, 'configured', false);
  end if;

  cycle_cap := coalesce(q.cycle_limit, q.monthly_limit);
  if q.cycle_start_day is null then
    cycle_start := date_trunc('month', today)::date;
  else
    anchor := least(greatest(q.cycle_start_day, 1), 31);
    month_days := extract(day from (date_trunc('month', today) + interval '1 month - 1 day'))::int;
    cycle_start := make_date(
      extract(year from today)::int,
      extract(month from today)::int,
      least(anchor, month_days));
    if today < cycle_start then
      cycle_start := (date_trunc('month', cycle_start) - interval '1 month')::date;
      month_days := extract(day from (date_trunc('month', cycle_start) + interval '1 month - 1 day'))::int;
      cycle_start := cycle_start + least(anchor, month_days) - 1;
    end if;
  end if;
  cycle_end := (date_trunc('month', cycle_start) + interval '1 month')::date
               + (cycle_start - date_trunc('month', cycle_start)::date);
  days_left := greatest(cycle_end - today, 1);

  select coalesce(sum(calls), 0) into used_today
    from public.api_usage_daily where provider = p_provider and day = today;
  if q.reported_period = today then
    used_today := greatest(used_today, coalesce(q.reported_used, 0));
  end if;
  select coalesce(sum(calls), 0) into used_cycle
    from public.api_usage_daily where provider = p_provider and day >= cycle_start;

  return jsonb_build_object(
    'provider', p_provider,
    'configured', q.configured,
    'daily_limit', q.daily_limit,
    'live_reserve_daily', q.live_reserve_daily,
    'per_minute_limit', q.per_minute_limit,
    'cycle_limit', cycle_cap,
    'cycle_anchor_day', q.cycle_start_day,
    'cycle_anchor_known', q.cycle_start_day is not null,
    'cycle_start', cycle_start,
    'cycle_end', cycle_end,
    'used_today', used_today,
    'used_cycle', used_cycle,
    'provider_reported_used', case when q.reported_period = today then q.reported_used else null end,
    'provider_reported_at', q.reported_at,
    'cycle_remaining', case when cycle_cap is null then null else cycle_cap - used_cycle end,
    'days_left_in_cycle', days_left,
    'pace_enabled', q.pace_enabled,
    'non_live_pace_per_day', case when cycle_cap is null or not q.pace_enabled then null
      else greatest(floor((greatest(cycle_cap - used_cycle - coalesce(q.live_reserve_daily,0) * days_left, 0))::numeric / days_left)::int, 0) end
  );
end;
$function$;

revoke all on function public.api_budget_status(text) from public;
revoke all on function public.api_budget_status(text) from anon;
revoke all on function public.api_budget_status(text) from authenticated;
grant execute on function public.api_budget_status(text) to service_role;

-- ------------------------------------------------------------------- run lease
create or replace function public.pb_try_lease(p_key text, p_ttl_seconds integer)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  ok boolean := false;
begin
  if p_key is null or p_ttl_seconds is null or p_ttl_seconds <= 0 then
    return false;
  end if;
  insert into public.cron_config (key, value)
  values (p_key, (now() + make_interval(secs => p_ttl_seconds))::text)
  on conflict (key) do update
    set value = (now() + make_interval(secs => p_ttl_seconds))::text,
        updated_at = now()
    where public.cron_config.value::timestamptz <= now()
  returning true into ok;
  return coalesce(ok, false);
exception when others then
  -- an unparsable stale value must not wedge the lease forever
  update public.cron_config
     set value = (now() + make_interval(secs => p_ttl_seconds))::text, updated_at = now()
   where key = p_key;
  return true;
end;
$function$;

revoke all on function public.pb_try_lease(text, integer) from public;
revoke all on function public.pb_try_lease(text, integer) from anon;
revoke all on function public.pb_try_lease(text, integer) from authenticated;
grant execute on function public.pb_try_lease(text, integer) to service_role;

create or replace function public.pb_release_lease(p_key text)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  delete from public.cron_config where key = p_key;
$function$;

revoke all on function public.pb_release_lease(text) from public;
revoke all on function public.pb_release_lease(text) from anon;
revoke all on function public.pb_release_lease(text) from authenticated;
grant execute on function public.pb_release_lease(text) to service_role;