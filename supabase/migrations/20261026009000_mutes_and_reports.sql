-- muting an account hides its posts from your feed; it is private to you
create table if not exists public.mutes (
  muter_id uuid not null references auth.users (id) on delete cascade,
  muted_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (muter_id, muted_id),
  check (muter_id <> muted_id)
);
alter table public.mutes enable row level security;
grant select, insert, delete on public.mutes to authenticated;
grant all on public.mutes to service_role;
drop policy if exists mutes_read on public.mutes;
create policy mutes_read on public.mutes for select to authenticated using (muter_id = auth.uid());
drop policy if exists mutes_add on public.mutes;
create policy mutes_add on public.mutes for insert to authenticated with check (muter_id = auth.uid());
drop policy if exists mutes_remove on public.mutes;
create policy mutes_remove on public.mutes for delete to authenticated using (muter_id = auth.uid());

-- reports about an account itself: only the server reads them
create table if not exists public.user_reports (
  reporter_id uuid not null references auth.users (id) on delete cascade,
  reported_id uuid not null references auth.users (id) on delete cascade,
  reason text not null,
  created_at timestamptz not null default now(),
  primary key (reporter_id, reported_id),
  check (reporter_id <> reported_id),
  check (char_length(reason) <= 40)
);
alter table public.user_reports enable row level security;
grant insert on public.user_reports to authenticated;
grant all on public.user_reports to service_role;
drop policy if exists user_reports_add on public.user_reports;
create policy user_reports_add on public.user_reports for insert to authenticated with check (reporter_id = auth.uid());
