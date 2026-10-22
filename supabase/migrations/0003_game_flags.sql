-- Platform-wide feature flag per game. A game switched off here disappears from the studio site, every client portal
-- and every embed, whatever each client has enabled. Games without a row are on.
create table if not exists public.game_flags (
  game_id     text primary key,
  enabled     boolean not null default true,
  updated_at  timestamptz not null default now()
);
drop trigger if exists game_flags_touch on public.game_flags;
create trigger game_flags_touch before update on public.game_flags for each row execute function public.touch_updated_at();

alter table public.game_flags enable row level security;
drop policy if exists game_flags_public_read on public.game_flags;
create policy game_flags_public_read on public.game_flags for select using (true);
drop policy if exists game_flags_admin_write on public.game_flags;
create policy game_flags_admin_write on public.game_flags for all using (public.is_admin()) with check (public.is_admin());

-- Portals list only games that are on for the client and on platform-wide.
create or replace function public.portal_config(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'slug', c.slug, 'name', c.name, 'theme', c.theme, 'ads', c.ads, 'site', c.site,
    'games', coalesce((select jsonb_agg(g.game_id order by g.sort, g.game_id)
                       from public.client_games g
                       where g.client_id = c.id and g.enabled
                         and not exists (select 1 from public.game_flags f where f.game_id = g.game_id and not f.enabled)),
                      '[]'::jsonb))
  from public.clients c where c.slug = p_slug and c.active;
$$;
grant execute on function public.portal_config(text) to anon, authenticated;
