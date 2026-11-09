-- devices: each phone or browser signed in to an account registers itself, so the account info page can list them and
-- sign one out (the row is marked revoked; that device sees it the next time it opens and signs out by itself)
create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  device_id text not null check (char_length(device_id) between 8 and 64),
  name text not null default 'Unknown device' check (char_length(name) <= 80),
  platform text not null default '' check (char_length(platform) <= 20),
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  revoked boolean not null default false,
  unique (user_id, device_id)
);
create index if not exists devices_user on public.devices (user_id, last_seen desc);
alter table public.devices enable row level security;
revoke all on public.devices from anon;
grant select, insert, update, delete on public.devices to authenticated;
drop policy if exists "devices own select" on public.devices;
drop policy if exists "devices own insert" on public.devices;
drop policy if exists "devices own update" on public.devices;
drop policy if exists "devices own delete" on public.devices;
create policy "devices own select" on public.devices for select to authenticated using (user_id = (select auth.uid()));
create policy "devices own insert" on public.devices for insert to authenticated with check (user_id = (select auth.uid()));
create policy "devices own update" on public.devices for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "devices own delete" on public.devices for delete to authenticated using (user_id = (select auth.uid()));
