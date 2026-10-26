-- counts how many people shared a post: one row per person and post
create table if not exists public.post_shares (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table public.post_shares enable row level security;
grant select, insert, delete on public.post_shares to authenticated;
grant all on public.post_shares to service_role;
drop policy if exists post_shares_read on public.post_shares;
create policy post_shares_read on public.post_shares for select to authenticated using (true);
drop policy if exists post_shares_add on public.post_shares;
create policy post_shares_add on public.post_shares for insert to authenticated with check (user_id = auth.uid());
drop policy if exists post_shares_remove on public.post_shares;
create policy post_shares_remove on public.post_shares for delete to authenticated using (user_id = auth.uid());
create index if not exists post_shares_post on public.post_shares (post_id);
