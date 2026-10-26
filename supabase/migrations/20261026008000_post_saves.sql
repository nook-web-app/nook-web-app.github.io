-- counts how many people saved a post: one row per person and post
create table if not exists public.post_saves (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table public.post_saves enable row level security;
grant select, insert, delete on public.post_saves to authenticated;
grant all on public.post_saves to service_role;
drop policy if exists post_saves_read on public.post_saves;
create policy post_saves_read on public.post_saves for select to authenticated using (true);
drop policy if exists post_saves_add on public.post_saves;
create policy post_saves_add on public.post_saves for insert to authenticated with check (user_id = auth.uid());
drop policy if exists post_saves_remove on public.post_saves;
create policy post_saves_remove on public.post_saves for delete to authenticated using (user_id = auth.uid());
create index if not exists post_saves_post on public.post_saves (post_id);
