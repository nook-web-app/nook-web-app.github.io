-- Post strikes: run this once in the Supabase SQL editor.
-- A post taken down for the rules or sexual content pauses posting: 6 hours, 24 hours, 72 hours, 7 days, 14 days, then a ban.
-- The count is kept by email (not by account) so deleting and remaking an account does not reset it.

-- refuse to run after the hmac upgrade (migration 20261026019000): the md5 body below would undo it and break every lookup
do $$ begin
  if to_regprocedure('public.nook_email_key_old(text)') is not null then
    raise exception 'nook_email_key was already upgraded to the hmac chain; do not run this file again';
  end if;
end $$;

create table if not exists public.post_strikes (
  email_key text primary key,
  strikes int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.post_strikes enable row level security;
revoke all on public.post_strikes from anon, authenticated;

-- same person, same key: lower case, no +tag, no dots for gmail
create or replace function public.nook_email_key(p_email text) returns text language sql immutable set search_path = public as $$
  select md5(
    case when split_part(lower(btrim(p_email)), '@', 2) in ('gmail.com', 'googlemail.com')
      then replace(split_part(split_part(lower(btrim(p_email)), '@', 1), '+', 1), '.', '') || '@gmail.com'
      else split_part(split_part(lower(btrim(p_email)), '@', 1), '+', 1) || '@' || split_part(lower(btrim(p_email)), '@', 2)
    end)
$$;

-- counts a strike when Aegis removes a post, then pauses posting or bans
create or replace function public.nook_strike_on_notice() returns trigger language plpgsql security definer set search_path = public, auth as $$
declare mail text; k text; n int; hrs int[] := array[6, 24, 72, 168, 336];
begin
  select email into mail from auth.users where id = new.user_id;
  if mail is null then return new; end if;
  k := public.nook_email_key(mail);
  insert into public.post_strikes (email_key, strikes) values (k, 1)
    on conflict (email_key) do update set strikes = public.post_strikes.strikes + 1, updated_at = now()
    returning strikes into n;
  if n >= 6 then
    update auth.users set banned_until = now() + interval '100 years' where id = new.user_id;
  else
    update public.post_strikes set locked_until = now() + make_interval(hours => hrs[n]) where email_key = k;
  end if;
  return new;
end $$;
revoke all on function public.nook_strike_on_notice() from public, anon, authenticated;
drop trigger if exists nook_strike_on_notice_t on public.mod_notices;
create trigger nook_strike_on_notice_t after insert on public.mod_notices
  for each row when (new.post_id is not null and new.kind in ('rules', 'sexual'))
  execute function public.nook_strike_on_notice();

-- posting is refused while the pause of that email is running
create or replace function public.nook_post_lock_guard() returns trigger language plpgsql security definer set search_path = public, auth as $$
declare until_t timestamptz;
begin
  if auth.uid() is null then return new; end if;
  select s.locked_until into until_t from public.post_strikes s join auth.users u on public.nook_email_key(u.email) = s.email_key where u.id = auth.uid();
  if until_t is not null and until_t > now() then
    raise exception 'post_locked:%', extract(epoch from until_t)::bigint using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.nook_post_lock_guard() from public, anon, authenticated;
drop trigger if exists nook_post_lock_ins on public.posts;
create trigger nook_post_lock_ins before insert on public.posts for each row execute function public.nook_post_lock_guard();
drop trigger if exists nook_post_lock_upd on public.posts;
create trigger nook_post_lock_upd before update of body, media_url on public.posts
  for each row when (new.body is distinct from old.body or new.media_url is distinct from old.media_url)
  execute function public.nook_post_lock_guard();

-- the app asks how long posting is paused for the signed in person
create or replace function public.nook_post_lock() returns table (locked_until timestamptz, strikes int) language sql security definer set search_path = public, auth as $$
  select s.locked_until, s.strikes from public.post_strikes s join auth.users u on public.nook_email_key(u.email) = s.email_key where u.id = auth.uid() and s.locked_until > now()
$$;
revoke all on function public.nook_post_lock() from public, anon;
grant execute on function public.nook_post_lock() to authenticated;
