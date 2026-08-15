create policy "public read team logos" on storage.objects
  for select to anon, authenticated using (bucket_id = 'team-logos');

create policy "public read player photos" on storage.objects
  for select to anon, authenticated using (bucket_id = 'player-photos');

create policy "service manages team logos" on storage.objects
  for all to service_role using (bucket_id = 'team-logos') with check (bucket_id = 'team-logos');

create policy "service manages player photos" on storage.objects
  for all to service_role using (bucket_id = 'player-photos') with check (bucket_id = 'player-photos');

revoke all on function public.api_budget_take(text, text, int) from public, anon, authenticated;
grant execute on function public.api_budget_take(text, text, int) to service_role;

revoke all on function public.enforce_source_insert() from public, anon, authenticated;
revoke all on function public.set_match_season() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;

revoke all on function public.is_admin(uuid) from public, anon;
grant execute on function public.is_admin(uuid) to authenticated, service_role;