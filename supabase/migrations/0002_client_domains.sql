-- Custom domains per client: a request to one of a client's domains opens that client's portal directly.
alter table public.clients add column if not exists domains text[] not null default '{}';
create index if not exists clients_domains on public.clients using gin (domains);

create or replace function public.portal_slug_for_host(p_host text) returns text
language sql stable security definer set search_path = public as $$
  select c.slug from public.clients c where c.active and lower(p_host) = any (c.domains) limit 1;
$$;
grant execute on function public.portal_slug_for_host(text) to anon, authenticated;
