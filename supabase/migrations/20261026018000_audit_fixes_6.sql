-- audit fixes 6 (idempotent, guarded)
-- 1. sign in lockout counts DISTINCT places, so a stranger cannot lock a real person out (works with supabase/functions/signin)

create table if not exists public.login_ip_fails (
  email_key text not null,
  ip text not null,
  fails integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (email_key, ip)
);
alter table public.login_ip_fails enable row level security;
revoke all on table public.login_ip_fails from public, anon, authenticated;
create index if not exists login_ip_fails_updated on public.login_ip_fails (updated_at);

-- writes down one failed try of one place on one email; old rows of that email are dropped
create or replace function public.nook_login_note_ip(p_key text, p_ip text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_key is null or p_ip is null or p_ip = '' or p_ip = 'none' then return; end if;
  delete from public.login_ip_fails where email_key = p_key and updated_at < now() - interval '1 day';
  insert into public.login_ip_fails (email_key, ip, fails, updated_at) values (p_key, p_ip, 1, now())
  on conflict (email_key, ip) do update set fails = public.login_ip_fails.fails + 1, updated_at = now();
end $$;

-- how many different places failed on this email inside the window
create or replace function public.nook_login_distinct_ips(p_key text, p_window interval default interval '1 hour')
returns integer
language sql stable security definer set search_path = public
as $$
  select count(*)::int from public.login_ip_fails where email_key = p_key and updated_at > now() - p_window;
$$;

-- a good sign in clears the places of that email
create or replace function public.nook_login_clear_ips(p_key text)
returns void
language sql security definer set search_path = public
as $$ delete from public.login_ip_fails where email_key = p_key $$;

-- old rows of every email are swept now and then (called from nook_login_note_ip only for its own email, so this one is for cron or by hand)
create or replace function public.nook_login_sweep_ips()
returns void
language sql security definer set search_path = public
as $$ delete from public.login_ip_fails where updated_at < now() - interval '1 day' $$;

revoke all on function public.nook_login_note_ip(text, text) from public, anon, authenticated;
revoke all on function public.nook_login_distinct_ips(text, interval) from public, anon, authenticated;
revoke all on function public.nook_login_clear_ips(text) from public, anon, authenticated;
revoke all on function public.nook_login_sweep_ips() from public, anon, authenticated;
grant execute on function public.nook_login_note_ip(text, text) to service_role;
grant execute on function public.nook_login_distinct_ips(text, interval) to service_role;
grant execute on function public.nook_login_clear_ips(text) to service_role;
grant execute on function public.nook_login_sweep_ips() to service_role;

-- 2. upload limits: count the files of one person by a name range (usable by the (bucket_id, name) index), not by a function over every object
create or replace function public.nook_upload_count(p_bucket text) returns int language sql stable security definer set search_path to 'public' as $$
  select count(*)::int from storage.objects o
  where o.bucket_id = p_bucket
    and o.name collate "C" >= (select auth.uid())::text || '/'
    and o.name collate "C" < (select auth.uid())::text || '0'
$$;
grant execute on function public.nook_upload_count(text) to authenticated;

-- 3. zenith policies: the owner check runs once per statement, not once per row
do $$ begin
  if to_regclass('public.zenith_docs') is not null and to_regprocedure('public.nook_is_owner()') is not null then
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'zenith_docs' and policyname = 'zenith owner select') then
      alter policy "zenith owner select" on public.zenith_docs using (owner_id = (select auth.uid()) and (select public.nook_is_owner()));
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'zenith_docs' and policyname = 'zenith owner insert') then
      alter policy "zenith owner insert" on public.zenith_docs with check (owner_id = (select auth.uid()) and (select public.nook_is_owner()));
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'zenith_docs' and policyname = 'zenith owner update') then
      alter policy "zenith owner update" on public.zenith_docs using (owner_id = (select auth.uid()) and (select public.nook_is_owner())) with check (owner_id = (select auth.uid()) and (select public.nook_is_owner()));
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'zenith_docs' and policyname = 'zenith owner delete') then
      alter policy "zenith owner delete" on public.zenith_docs using (owner_id = (select auth.uid()) and (select public.nook_is_owner()));
    end if;
  end if;
end $$;

-- 4. deleting many posts sends ONE purge request for the statement, not one per row
do $outer$ begin
  if to_regclass('public.posts') is not null
     and to_regprocedure('public.nook_media_paths(text,text)') is not null
     and to_regprocedure('public.nook_purge_storage(text,text[],uuid)') is not null then
    execute $fn$
create or replace function public.nook_purge_post_media_stmt() returns trigger
language plpgsql security definer set search_path = public as $$
declare gone text[] := '{}'; r record;
begin
  for r in select media_url from old_rows loop
    gone := array_cat(gone, public.nook_media_paths(r.media_url, 'media'));
  end loop;
  if coalesce(array_length(gone, 1), 0) > 0 then perform public.nook_purge_storage('media', gone); end if;
  return null;
end $$;
$fn$;
    revoke all on function public.nook_purge_post_media_stmt() from public, anon, authenticated;
    drop trigger if exists nook_purge_post_media_del on public.posts;
    create trigger nook_purge_post_media_del after delete on public.posts
      referencing old table as old_rows for each statement execute function public.nook_purge_post_media_stmt();
  end if;
end $outer$;
