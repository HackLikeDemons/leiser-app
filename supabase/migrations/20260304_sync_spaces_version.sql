alter table public.sync_spaces
add column if not exists version bigint not null default 0;

create or replace function public.bump_sync_spaces_version()
returns trigger
language plpgsql
as $$
begin
  new.version = old.version + 1;
  return new;
end;
$$;

drop trigger if exists sync_spaces_bump_version on public.sync_spaces;
create trigger sync_spaces_bump_version
before update on public.sync_spaces
for each row execute function public.bump_sync_spaces_version();
