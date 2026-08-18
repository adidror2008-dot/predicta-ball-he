-- PART A: base tables (create if not exists; existing ones get missing columns)
create table if not exists public.competitions (
  id uuid primary key default gen_random_uuid(),
  external_id text not null,
  source text not null,
  name_he text not null,
  name_en text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.competitions
  add column if not exists season_method text not null default 'aug_may',
  add column if not exists current_season_id text,
  add column if not exists home_advantage numeric not null default 1.10,
  add column if not exists home_advantage_measured boolean not null default false,
  add column if not exists avg_goals_home numeric,
  add column if not exists avg_goals_away numeric,
  add column if not exists avg_goals_measured boolean not null default false,
  add column if not exists ref_elo numeric,
  add column if not exists is_active boolean not null default true;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'competitions_season_method_chk') then
    alter table public.competitions add constraint competitions_season_method_chk check (season_method in ('aug_may','calendar'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'competitions_external_source_key') then
    alter table public.competitions add constraint competitions_external_source_key unique (external_id, source);
  end if;
end $$;

comment on column public.competitions.home_advantage is 'Model parameter, not displayed data. Stays at the default until home_advantage_measured = true.';

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  external_id text not null,
  source text not null,
  name_he text not null,
  name_en text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.teams
  add column if not exists competition_id uuid references public.competitions(id) on delete set null,
  add column if not exists elo_internal numeric,
  add column if not exists elo_internal_matches integer not null default 0,
  add column if not exists elo_club numeric,
  add column if not exists elo_club_updated_at timestamptz,
  add column if not exists history_checked_at timestamptz,
  add column if not exists logo_checked_at timestamptz,
  add column if not exists logo_url text,
  add column if not exists fetched_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'teams_external_source_key') then
    alter table public.teams add constraint teams_external_source_key unique (external_id, source);
  end if;
end $$;

create table if not exists public.team_aliases (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  alias text not null,
  source text not null,
  created_at timestamptz default now()
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'team_aliases_alias_source_key') then
    alter table public.team_aliases add constraint team_aliases_alias_source_key unique (alias, source);
  end if;
end $$;
create index if not exists team_aliases_team_id_idx on public.team_aliases(team_id);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  external_id text not null,
  source text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.matches
  add column if not exists competition_id uuid references public.competitions(id) on delete set null,
  add column if not exists home_team_id uuid references public.teams(id) on delete set null,
  add column if not exists away_team_id uuid references public.teams(id) on delete set null,
  add column if not exists kickoff_at timestamptz,
  add column if not exists season text,
  add column if not exists status text not null default 'scheduled',
  add column if not exists home_score integer,
  add column if not exists away_score integer,
  add column if not exists is_neutral boolean not null default false,
  add column if not exists time_confirmed boolean not null default false,
  add column if not exists needs_review boolean not null default false,
  add column if not exists fetched_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'matches_external_source_key') then
    alter table public.matches add constraint matches_external_source_key unique (external_id, source);
  end if;
end $$;
create index if not exists matches_competition_kickoff_idx on public.matches(competition_id, kickoff_at);
create index if not exists matches_status_kickoff_idx on public.matches(status, kickoff_at);
create index if not exists matches_home_team_idx on public.matches(home_team_id);
create index if not exists matches_away_team_idx on public.matches(away_team_id);

-- PART B
create table if not exists public.team_match_history (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  external_match_id text not null,
  played_at timestamptz not null,
  is_home boolean not null,
  goals_for integer not null,
  goals_against integer not null,
  opponent_external_id text,
  opponent_name text,
  opponent_elo numeric,
  tournament_id text,
  tournament_name text,
  tournament_type text not null default 'unknown' check (tournament_type in ('official','friendly','youth','unknown')),
  fetched_at timestamptz not null default now(),
  unique (team_id, external_match_id)
);
create index if not exists team_match_history_team_played_idx on public.team_match_history(team_id, played_at desc);
comment on column public.team_match_history.opponent_elo is 'NULL means the opponent level is unknown. The engine then applies the weight_unknown_opponent factor and flags the prediction as partially estimated. Never fill this with a guess.';

-- PART C
create table if not exists public.model_config (
  key text primary key,
  value numeric,
  value_text text,
  note_he text not null,
  updated_at timestamptz not null default now()
);

insert into public.model_config (key, value, value_text, note_he) values
  ('model_version', null, 'v7.0', 'גרסת המנוע'),
  ('history_max_matches', 10, null, 'כמה משחקים אחורה המנוע קורא'),
  ('history_min_matches', 3, null, 'מתחת לזה — אין תחזית בכלל'),
  ('weight_official', 1.00, null, 'משקל משחק ליגה/גביע/אירופה'),
  ('weight_friendly', 0.25, null, 'משקל משחק ידידות'),
  ('weight_youth', 0.00, null, 'נוער/מילואים — נזרק'),
  ('weight_unknown_type', 0.60, null, 'סוג תחרות לא מזוהה'),
  ('weight_unknown_opponent', 0.60, null, 'יריב שרמתו לא ידועה'),
  ('opp_elo_scale', 800, null, 'סקאלת פער Elo לחישוב משקל היריב'),
  ('opp_weight_floor', 0.45, null, 'רצפת המשקל ליריב חלש מאוד'),
  ('recency_decay', 0.85, null, 'דעיכה לפי עדכניות'),
  ('shrinkage_k', 4.0, null, 'חוזק המשיכה לממוצע הליגה'),
  ('elo_goal_scale', 1000, null, 'סקאלת Elo להשפעה על גולים'),
  ('elo_mult_min', 0.60, null, 'תקרה תחתונה למכפיל Elo'),
  ('elo_mult_max', 1.60, null, 'תקרה עליונה למכפיל Elo'),
  ('rest_days_threshold', 4, null, 'מתחת לזה מתחיל קנס מנוחה'),
  ('rest_penalty_per_day', 0.02, null, 'קנס לכל יום מנוחה חסר'),
  ('rest_penalty_floor', 0.92, null, 'קנס מנוחה מקסימלי'),
  ('lambda_min', 0.15, null, 'רצפת תוחלת גולים'),
  ('lambda_max', 5.00, null, 'תקרת תוחלת גולים'),
  ('max_goals_grid', 8, null, 'גודל מטריצת הפואסון (0..8)'),
  ('global_avg_goals_home', 1.60, null, 'ברירת מחדל עד שנמדד לכל תחרות'),
  ('global_avg_goals_away', 1.30, null, 'ברירת מחדל עד שנמדד לכל תחרות'),
  ('conf_w_decisive', 0.50, null, 'משקל חדות ההסתברות בביטחון'),
  ('conf_w_data', 0.30, null, 'משקל איכות הנתונים בביטחון'),
  ('conf_w_agreement', 0.20, null, 'משקל הסכמת המקורות בביטחון'),
  ('conf_band_low_max', 39, null, 'גבול עליון לביטחון נמוך'),
  ('conf_band_mid_max', 69, null, 'גבול עליון לביטחון בינוני'),
  ('accuracy_min_sample', 30, null, 'מתחת לזה לא מציגים דיוק כלל')
on conflict (key) do nothing;

-- PART D
drop table if exists public.predictions cascade;
create table public.predictions (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  model_version text not null,
  lambda_home numeric not null,
  lambda_away numeric not null,
  predicted_home_score integer not null,
  predicted_away_score integer not null,
  prob_home numeric not null,
  prob_draw numeric not null,
  prob_away numeric not null,
  expected_total_goals numeric not null,
  prob_over_2_5 numeric not null,
  prob_under_2_5 numeric not null,
  prob_btts numeric not null,
  prob_goals_0_1 numeric not null,
  prob_goals_2_3 numeric not null,
  prob_goals_4_plus numeric not null,
  predicted_goal_bucket text not null check (predicted_goal_bucket in ('0-1','2-3','4+')),
  confidence integer not null check (confidence between 0 and 100),
  confidence_band text not null check (confidence_band in ('low','mid','high')),
  factors jsonb not null default '[]'::jsonb,
  reason_lines_he text[] not null default '{}',
  reasons_source text not null default 'template' check (reasons_source in ('ai','template')),
  n_eff_home numeric not null,
  n_eff_away numeric not null,
  history_matches_home integer not null,
  history_matches_away integer not null,
  estimated_share numeric not null default 0,
  computed_at timestamptz not null default now(),
  next_update_at timestamptz,
  locked_at timestamptz,
  locked_payload jsonb,
  unique (match_id, model_version),
  constraint predictions_1x2_sum_chk check (prob_home + prob_draw + prob_away between 0.995 and 1.005),
  constraint predictions_bucket_sum_chk check (prob_goals_0_1 + prob_goals_2_3 + prob_goals_4_plus between 0.995 and 1.005),
  constraint predictions_ou_sum_chk check (prob_over_2_5 + prob_under_2_5 between 0.995 and 1.005),
  constraint predictions_lambda_chk check (lambda_home > 0 and lambda_away > 0)
);
comment on column public.predictions.locked_payload is 'Frozen snapshot of the prediction 60 minutes before kickoff. This, and only this, is what accuracy is measured against. Without it the accuracy number is meaningless.';
create index if not exists predictions_match_idx on public.predictions(match_id);
create index if not exists predictions_unlocked_idx on public.predictions(locked_at) where locked_at is null;

-- PART E
create table if not exists public.prediction_outcomes (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  prediction_id uuid references public.predictions(id) on delete set null,
  model_version text not null,
  confidence_band text not null,
  pred_home integer not null,
  pred_away integer not null,
  actual_home integer not null,
  actual_away integer not null,
  pred_bucket text not null,
  actual_bucket text not null,
  hit_winner boolean not null,
  hit_exact boolean not null,
  hit_goal_bucket boolean not null,
  hit_ou25 boolean not null,
  goals_abs_error integer not null,
  rps numeric not null,
  brier numeric not null,
  naive_hit_winner boolean not null,
  naive_hit_bucket boolean not null,
  finished_at timestamptz not null,
  computed_at timestamptz not null default now(),
  unique (match_id, model_version)
);
comment on column public.prediction_outcomes.naive_hit_winner is 'Naive baseline = always predict a home win. The model number is meaningless without this to compare against.';
comment on column public.prediction_outcomes.naive_hit_bucket is 'Naive baseline = always predict the 2-3 goals bucket.';
create index if not exists prediction_outcomes_model_finished_idx on public.prediction_outcomes(model_version, finished_at desc);

create or replace function public.goal_bucket(total integer)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when total is null then null
    when total <= 1 then '0-1'
    when total <= 3 then '2-3'
    else '4+'
  end
$$;

create or replace view public.model_accuracy_summary as
with ranked as (
  select model_version, hit_winner, hit_exact, hit_goal_bucket, hit_ou25,
         goals_abs_error, rps, brier, naive_hit_winner, naive_hit_bucket,
         row_number() over (partition by model_version order by finished_at desc) as rn
  from public.prediction_outcomes
),
scoped as (
  select model_version, hit_winner, hit_exact, hit_goal_bucket, hit_ou25,
         goals_abs_error, rps, brier, naive_hit_winner, naive_hit_bucket,
         'all'::text as scope
  from ranked
  union all
  select model_version, hit_winner, hit_exact, hit_goal_bucket, hit_ou25,
         goals_abs_error, rps, brier, naive_hit_winner, naive_hit_bucket,
         'last50'::text as scope
  from ranked where rn <= 50
)
select
  model_version,
  scope,
  count(*)::bigint as n,
  round(100.0 * avg(case when hit_winner then 1 else 0 end), 1) as pct_winner,
  round(100.0 * avg(case when hit_exact then 1 else 0 end), 1) as pct_exact,
  round(100.0 * avg(case when hit_goal_bucket then 1 else 0 end), 1) as pct_goal_bucket,
  round(100.0 * avg(case when hit_ou25 then 1 else 0 end), 1) as pct_ou25,
  round(100.0 * avg(case when goals_abs_error <= 1 then 1 else 0 end), 1) as pct_goals_within_1,
  round(avg(rps), 4) as avg_rps,
  round(avg(brier), 4) as avg_brier,
  round(100.0 * avg(case when naive_hit_winner then 1 else 0 end), 1) as naive_pct_winner,
  round(100.0 * avg(case when naive_hit_bucket then 1 else 0 end), 1) as naive_pct_bucket
from scoped
group by model_version, scope;

create or replace view public.model_accuracy_by_confidence as
select
  model_version,
  confidence_band,
  count(*)::bigint as n,
  round(100.0 * avg(case when hit_winner then 1 else 0 end), 1) as pct_winner,
  round(avg(rps), 4) as avg_rps
from public.prediction_outcomes
group by model_version, confidence_band
order by model_version, case confidence_band when 'low' then 1 when 'mid' then 2 when 'high' then 3 else 4 end;

-- PART F: RLS
alter table public.competitions enable row level security;
alter table public.teams enable row level security;
alter table public.team_aliases enable row level security;
alter table public.matches enable row level security;
alter table public.team_match_history enable row level security;
alter table public.predictions enable row level security;
alter table public.prediction_outcomes enable row level security;
alter table public.model_config enable row level security;

do $$
declare t text;
begin
  foreach t in array array['competitions','teams','team_aliases','matches','team_match_history','predictions','prediction_outcomes','model_config'] loop
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke all on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_select_authenticated', t);
  end loop;
end $$;

revoke all on public.model_accuracy_summary from anon;
revoke all on public.model_accuracy_by_confidence from anon;
grant select on public.model_accuracy_summary to authenticated;
grant select on public.model_accuracy_by_confidence to authenticated;