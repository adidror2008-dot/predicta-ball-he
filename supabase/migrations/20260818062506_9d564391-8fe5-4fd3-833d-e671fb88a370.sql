CREATE OR REPLACE FUNCTION public.recompute_internal_elo()
RETURNS TABLE(distinct_matches int, skipped_null_opponent int, rated_entities int, teams_rated int, avg_rating double precision)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  m record;
  rh double precision; ra double precision; eh double precision; sh double precision;
  gd int; km double precision; d double precision;
  v_skipped int := 0;
  v_matches int := 0;
begin
  create temp table _elo (ext text primary key, rating double precision not null default 1500.0, played int not null default 0) on commit drop;

  create temp table _dm on commit drop as
  select distinct on (tmh.external_match_id)
    tmh.external_match_id,
    case when tmh.is_home then t.external_id else tmh.opponent_external_id end as home_ext,
    case when tmh.is_home then tmh.opponent_external_id else t.external_id end as away_ext,
    case when tmh.is_home then tmh.goals_for else tmh.goals_against end as home_goals,
    case when tmh.is_home then tmh.goals_against else tmh.goals_for end as away_goals,
    tmh.played_at
  from public.team_match_history tmh
  join public.teams t on t.id = tmh.team_id
  order by tmh.external_match_id, tmh.played_at;

  select count(*) into v_skipped from _dm where home_ext is null or away_ext is null;
  delete from _dm where home_ext is null or away_ext is null;
  select count(*) into v_matches from _dm;

  for m in select * from _dm order by played_at asc, external_match_id asc loop
    insert into _elo(ext) values (m.home_ext) on conflict do nothing;
    insert into _elo(ext) values (m.away_ext) on conflict do nothing;
    select rating into rh from _elo where ext = m.home_ext;
    select rating into ra from _elo where ext = m.away_ext;
    eh := 1.0 / (1.0 + power(10.0, (ra - rh - 65.0) / 400.0));
    sh := case when m.home_goals > m.away_goals then 1.0 when m.home_goals = m.away_goals then 0.5 else 0.0 end;
    gd := abs(m.home_goals - m.away_goals);
    km := case when gd <= 1 then 1.0 when gd = 2 then 1.5 else (11 + gd) / 8.0 end;
    d := 20.0 * km * (sh - eh);
    update _elo set rating = rh + d, played = played + 1 where ext = m.home_ext;
    update _elo set rating = ra - d, played = played + 1 where ext = m.away_ext;
  end loop;

  update public.teams t
    set elo_internal = round(e.rating::numeric, 1), elo_internal_matches = e.played
  from _elo e
  where e.ext = t.external_id and e.played >= 3;

  update public.teams t
    set elo_internal = null, elo_internal_matches = coalesce(e.played, 0)
  from _elo e
  where e.ext = t.external_id and e.played < 3;

  update public.team_match_history h
    set opponent_elo = round(e.rating::numeric, 1)
  from _elo e
  where e.ext = h.opponent_external_id and e.played >= 3
    and (h.opponent_elo is distinct from round(e.rating::numeric, 1));

  update public.team_match_history h
    set opponent_elo = null
  where h.opponent_elo is not null
    and not exists (select 1 from _elo e where e.ext = h.opponent_external_id and e.played >= 3);

  return query
  select v_matches, v_skipped,
    (select count(*)::int from _elo),
    (select count(*)::int from public.teams where elo_internal is not null),
    (select avg(rating) from _elo);
end; $function$;

COMMENT ON COLUMN public.team_match_history.opponent_elo IS 'The opponent''s CURRENT (final) internal Elo rating, not their rating at the time of that match. Intentional: this field feeds the "how strong is this opponent" weighting layer, not a point-in-time backtest.';

CREATE OR REPLACE FUNCTION public.recompute_competition_baselines()
RETURNS TABLE(competitions_measured int, competitions_total int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  with agg as (
    select competition_id, count(*) n, avg(home_score::numeric) ah, avg(away_score::numeric) aa
    from public.matches
    where status = 'finished' and home_score is not null and away_score is not null and competition_id is not null
    group by competition_id
  )
  update public.competitions c
  set avg_goals_home = case when a.n >= 30 then round(a.ah, 3) else null end,
      avg_goals_away = case when a.n >= 30 then round(a.aa, 3) else null end,
      avg_goals_measured = coalesce(a.n, 0) >= 30,
      home_advantage = case when a.n >= 30 and a.aa > 0
        then least(1.45, greatest(1.00, round(a.ah / a.aa, 3))) else c.home_advantage end,
      home_advantage_measured = coalesce(a.n, 0) >= 30 and a.aa > 0
  from agg a
  where a.competition_id = c.id;

  update public.competitions c
  set avg_goals_home = null, avg_goals_away = null, avg_goals_measured = false, home_advantage_measured = false
  where not exists (
    select 1 from public.matches m
    where m.competition_id = c.id and m.status = 'finished' and m.home_score is not null and m.away_score is not null
    group by m.competition_id having count(*) >= 30
  );

  return query select (select count(*)::int from public.competitions where avg_goals_measured), (select count(*)::int from public.competitions);
end; $function$;