-- Multi-client game platform: clients (operators), the games each one has enabled, and back-office admins.
-- Run once in the Supabase SQL editor (or `supabase db push`). Safe to re-run.

create table if not exists public.clients (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  name        text not null,
  active      boolean not null default true,
  -- ClientTheme (src/kit/theme.ts): accent, accent2, panel, text, recolorGames, bgTop, bgBottom, font, logoUrl
  theme       jsonb not null default '{}'::jsonb,
  -- ClientAds: provider, publisherId, testMode, interstitialEveryRuns, minSecondsBetweenAds, graceRuns
  ads         jsonb not null default '{}'::jsonb,
  -- Portal copy: headline, tagline, footer, links
  site        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.client_games (
  client_id   uuid not null references public.clients(id) on delete cascade,
  game_id     text not null,
  enabled     boolean not null default true,
  sort        integer not null default 0,
  primary key (client_id, game_id)
);
create index if not exists client_games_client_sort on public.client_games (client_id, sort);

-- Back-office users. Add a row (by auth user id) for every person allowed to manage clients.
create table if not exists public.admins (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  email       text,
  created_at  timestamptz not null default now()
);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists clients_touch on public.clients;
create trigger clients_touch before update on public.clients for each row execute function public.touch_updated_at();

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

alter table public.clients      enable row level security;
alter table public.client_games enable row level security;
alter table public.admins       enable row level security;

-- Public (anon) reads only active clients and their enabled games; admins read and write everything.
drop policy if exists clients_public_read on public.clients;
create policy clients_public_read on public.clients for select using (active or public.is_admin());
drop policy if exists clients_admin_write on public.clients;
create policy clients_admin_write on public.clients for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists client_games_public_read on public.client_games;
create policy client_games_public_read on public.client_games for select using (
  public.is_admin() or (enabled and exists (select 1 from public.clients c where c.id = client_id and c.active))
);
drop policy if exists client_games_admin_write on public.client_games;
create policy client_games_admin_write on public.client_games for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists admins_self_read on public.admins;
create policy admins_self_read on public.admins for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists admins_admin_write on public.admins;
create policy admins_admin_write on public.admins for all using (public.is_admin()) with check (public.is_admin());

-- One round trip for a portal: the client's config plus its enabled games in order (null when unknown or inactive).
create or replace function public.portal_config(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'slug', c.slug, 'name', c.name, 'theme', c.theme, 'ads', c.ads, 'site', c.site,
    'games', coalesce((select jsonb_agg(g.game_id order by g.sort, g.game_id)
                       from public.client_games g where g.client_id = c.id and g.enabled), '[]'::jsonb))
  from public.clients c where c.slug = p_slug and c.active;
$$;
grant execute on function public.portal_config(text) to anon, authenticated;
