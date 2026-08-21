-- Single source of truth for the admin email
create or replace function public.admin_email()
returns text
language sql
immutable
set search_path = public
as $$ select 'adidror2008@gmail.com'::text $$;

revoke all on function public.admin_email() from public, anon;
grant execute on function public.admin_email() to authenticated, service_role;

create or replace function public.norm_email(_email text)
returns text
language sql
immutable
set search_path = public
as $$ select lower(btrim(coalesce(_email, ''))) $$;

revoke all on function public.norm_email(text) from public, anon;
grant execute on function public.norm_email(text) to authenticated, service_role;

-- Admin check: profile flag OR the configured admin email (case-insensitive)
create or replace function public.is_admin(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = _user_id
      and (p.is_admin = true
           or public.norm_email(p.email) = public.norm_email(public.admin_email()))
  )
  or exists (
    select 1 from auth.users u
    where u.id = _user_id
      and public.norm_email(u.email) = public.norm_email(public.admin_email())
  );
$$;

revoke all on function public.is_admin(uuid) from public, anon;
grant execute on function public.is_admin(uuid) to authenticated, service_role;

-- New signups: derive admin flag from the single source of truth
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  lower_email text := public.norm_email(new.email);
  limit_users int;
  current_users int;
begin
  if exists (select 1 from public.blocked_emails where email = lower_email) then
    raise exception 'signup blocked for this email';
  end if;

  select max_users into limit_users from public.app_settings where id = 1;
  select count(*) into current_users from public.profiles;
  if limit_users is not null and current_users >= limit_users
     and lower_email <> public.norm_email(public.admin_email()) then
    raise exception 'user limit reached';
  end if;

  insert into public.profiles (id, email, display_name, is_admin)
  values (new.id, new.email, new.raw_user_meta_data ->> 'display_name',
          lower_email = public.norm_email(public.admin_email()))
  on conflict (id) do nothing;

  insert into public.user_preferences (user_id) values (new.id)
  on conflict (user_id) do nothing;

  return new;
end; $$;

-- Backfill any existing profile with the admin email
update public.profiles
set is_admin = true
where public.norm_email(email) = public.norm_email(public.admin_email())
  and is_admin is distinct from true;