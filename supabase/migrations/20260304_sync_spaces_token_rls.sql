create extension if not exists pgcrypto;

create table if not exists public.sync_spaces (
  sync_id text primary key,
  blob jsonb not null default '{}'::jsonb,
  token_hash text,
  updated_at timestamptz not null default now()
);

alter table public.sync_spaces add column if not exists token_hash text;
alter table public.sync_spaces add column if not exists updated_at timestamptz not null default now();

create or replace function public.touch_sync_spaces_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists sync_spaces_touch_updated_at on public.sync_spaces;
create trigger sync_spaces_touch_updated_at
before update on public.sync_spaces
for each row execute function public.touch_sync_spaces_updated_at();

alter table public.sync_spaces enable row level security;
alter table public.sync_spaces force row level security;

create or replace function public.leiser_request_token()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.headers', true)::jsonb ->> 'x-leiser-token', ''),
    nullif(current_setting('request.header.x-leiser-token', true), '')
  )
$$;

create or replace function public.leiser_token_ok(expected_hash text)
returns boolean
language sql
stable
as $$
  select expected_hash is not null
    and public.leiser_request_token() is not null
    and encode(digest(public.leiser_request_token(), 'sha256'), 'hex') = expected_hash
$$;

drop policy if exists sync_spaces_select_token on public.sync_spaces;
drop policy if exists sync_spaces_insert_token on public.sync_spaces;
drop policy if exists sync_spaces_update_token on public.sync_spaces;

create policy sync_spaces_select_token
on public.sync_spaces
for select
to anon
using (public.leiser_token_ok(token_hash));

create policy sync_spaces_insert_token
on public.sync_spaces
for insert
to anon
with check (public.leiser_token_ok(token_hash));

create policy sync_spaces_update_token
on public.sync_spaces
for update
to anon
using (public.leiser_token_ok(token_hash))
with check (public.leiser_token_ok(token_hash));
