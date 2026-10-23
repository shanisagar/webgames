-- Table privileges for the Data API roles. Newer Supabase projects no longer grant these automatically to tables
-- created in the SQL editor, which shows up as "permission denied for table clients". Row level security (0001, 0003)
-- still decides which rows each role can see or change: anon only reads live portals and flags, admins write.
grant usage on schema public to anon, authenticated;

grant select on public.clients, public.client_games, public.game_flags to anon, authenticated;
grant insert, update, delete on public.clients, public.client_games, public.game_flags to authenticated;
grant select, insert, update, delete on public.admins to authenticated;

grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.portal_config(text) to anon, authenticated;
grant execute on function public.portal_slug_for_host(text) to anon, authenticated;
