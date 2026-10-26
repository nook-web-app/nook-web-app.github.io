-- muting a chat: no push and no unread badge for that person; the messages still arrive
create table if not exists public.dm_mutes (
  owner_id uuid not null references auth.users (id) on delete cascade,
  target_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, target_id),
  check (owner_id <> target_id)
);
alter table public.dm_mutes enable row level security;
grant select, insert, delete on public.dm_mutes to authenticated;
grant all on public.dm_mutes to service_role;
drop policy if exists dm_mutes_read on public.dm_mutes;
create policy dm_mutes_read on public.dm_mutes for select to authenticated using (owner_id = auth.uid());
drop policy if exists dm_mutes_add on public.dm_mutes;
create policy dm_mutes_add on public.dm_mutes for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists dm_mutes_remove on public.dm_mutes;
create policy dm_mutes_remove on public.dm_mutes for delete to authenticated using (owner_id = auth.uid());
