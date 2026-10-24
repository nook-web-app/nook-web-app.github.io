-- Audit fixes, part 1. Paste this whole file in the Supabase SQL editor and run it once.
-- (The assistant could not run it itself: the SQL tool asks for a confirmation on statements like revoke and drop, and nobody could answer.)

-- notifications: clients may only mark rows read
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- messages: time and read state come from the server
create or replace function public.nook_messages_insert_guard() returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare e jsonb;
begin
  if auth.uid() is null then return new; end if;
  new.created_at := now();
  new.read_at := null;
  if char_length(coalesce(new.body, '')) > 20000 then raise exception 'message_too_long' using errcode = '23514'; end if;
  if new.media is not null and new.media <> '[]'::jsonb then
    if jsonb_typeof(new.media) <> 'array' or jsonb_array_length(new.media) > 4 or length(new.media::text) > 4000 then raise exception 'bad_media' using errcode = '23514'; end if;
    for e in select jsonb_array_elements(new.media) loop
      if jsonb_typeof(e) <> 'object' or not public.nook_media_ok(e ->> 'url', 'dm-media', new.sender_id) or coalesce(length(e ->> 'iv'), 0) not between 1 and 40 then
        raise exception 'bad_media' using errcode = '23514';
      end if;
    end loop;
  end if;
  if (select count(*) from public.messages where sender_id = new.sender_id and created_at > now() - interval '1 minute') >= 60 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  return new;
end $function$;

-- media urls: no percent encoding, so dot segments cannot sneak in
create or replace function public.nook_media_ok(p_url text, p_bucket text, p_owner uuid) returns boolean language sql immutable set search_path to 'public' as $function$
  select p_url is not null
     and p_url like 'https://cimyolsipjdpibzaebmx.supabase.co/storage/v1/object/public/' || p_bucket || '/' || p_owner::text || '/%'
     and length(p_url) <= 400
     and p_url !~ '[[:space:]"''<>\\%]'
     and position('..' in p_url) = 0
$function$;

-- an avatar that points at a removed file is cleared like a banner
create or replace function public.nook_storage_gone_media() returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare r record; arr jsonb; kept jsonb; suffix text;
begin
  if old.bucket_id <> 'media' then return old; end if;
  suffix := '/object/public/media/' || old.name;
  for r in select id, body, media_url from public.posts where media_url like '%' || old.name || '%' loop
    begin
      if left(r.media_url, 1) = '[' then arr := r.media_url::jsonb; else arr := to_jsonb(array[r.media_url]); end if;
    exception when others then continue;
    end;
    select coalesce(jsonb_agg(e), '[]'::jsonb) into kept from jsonb_array_elements(arr) e where right(e #>> '{}', length(suffix)) <> suffix;
    if jsonb_array_length(kept) = jsonb_array_length(arr) then continue; end if;
    if jsonb_array_length(kept) = 0 and btrim(coalesce(r.body, '')) = '' then
      delete from public.posts where id = r.id;
    else
      update public.posts set media_url = case when jsonb_array_length(kept) = 0 then null else kept::text end where id = r.id;
    end if;
  end loop;
  update public.accounts set banner = null where banner is not null and right(banner, length(suffix)) = suffix;
  update public.accounts set avatar = null where avatar is not null and right(avatar, length(suffix)) = suffix;
  return old;
end $function$;

-- reports and key links: the server sets the time
create or replace function public.nook_force_created_at() returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if auth.uid() is not null then new.created_at := now(); end if;
  return new;
end $function$;
drop trigger if exists nook_reports_time on public.reports;
create trigger nook_reports_time before insert on public.reports for each row execute function public.nook_force_created_at();
drop trigger if exists nook_key_links_time on public.key_links;
create trigger nook_key_links_time before insert on public.key_links for each row execute function public.nook_force_created_at();

create or replace function public.nook_key_links_cap() returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  delete from public.key_links where user_id = new.user_id and id in (select id from public.key_links where user_id = new.user_id order by created_at desc offset 4);
  return new;
end $function$;
drop trigger if exists nook_key_links_cap_t on public.key_links;
create trigger nook_key_links_cap_t after insert on public.key_links for each row execute function public.nook_key_links_cap();

-- edits of posts and profiles that start a new AI check are spaced out
alter table public.posts add column if not exists last_edit_at timestamptz;
alter table public.accounts add column if not exists last_edit_at timestamptz;
create or replace function public.nook_posts_edit_gap() returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if auth.uid() is null then return new; end if;
  if new.body is distinct from old.body or new.media_url is distinct from old.media_url then
    if old.last_edit_at is not null and old.last_edit_at > now() - interval '15 seconds' then raise exception 'rate_limited' using errcode = 'P0001'; end if;
    new.last_edit_at := now();
  else
    new.last_edit_at := old.last_edit_at;
  end if;
  return new;
end $function$;
drop trigger if exists nook_posts_edit_gap_t on public.posts;
create trigger nook_posts_edit_gap_t before update on public.posts for each row execute function public.nook_posts_edit_gap();
create or replace function public.nook_accounts_edit_gap() returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if auth.uid() is null then return new; end if;
  if new.bio is distinct from old.bio or new.display_name is distinct from old.display_name or new.avatar is distinct from old.avatar or new.banner is distinct from old.banner or new.username is distinct from old.username then
    if old.last_edit_at is not null and old.last_edit_at > now() - interval '15 seconds' then raise exception 'rate_limited' using errcode = 'P0001'; end if;
    new.last_edit_at := now();
  else
    new.last_edit_at := old.last_edit_at;
  end if;
  return new;
end $function$;
drop trigger if exists nook_accounts_edit_gap_t on public.accounts;
create trigger nook_accounts_edit_gap_t before update on public.accounts for each row execute function public.nook_accounts_edit_gap();

-- no following yourself
alter table public.follows drop constraint if exists follows_not_self;
alter table public.follows add constraint follows_not_self check (follower_id <> followee_id) not valid;

-- the net schema is for the database's own functions only (all functions that call net.http_post are security definer)
revoke usage on schema net from anon, authenticated, public;
revoke all on all tables in schema net from anon, authenticated, public;
revoke execute on all functions in schema net from anon, authenticated, public;

-- length caps on free text columns and a cap on push devices
alter table public.accounts drop constraint if exists accounts_public_key_len;
alter table public.accounts add constraint accounts_public_key_len check (public_key is null or char_length(public_key) <= 200) not valid;
alter table public.push_subs drop constraint if exists push_subs_len;
alter table public.push_subs add constraint push_subs_len check (char_length(endpoint) <= 600 and char_length(p256dh) <= 200 and char_length(auth) <= 100) not valid;
create or replace function public.nook_push_subs_cap() returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  delete from public.push_subs where user_id = new.user_id and id in (select id from public.push_subs where user_id = new.user_id and id <> new.id order by created_at desc nulls last offset 4);
  return new;
end $function$;
drop trigger if exists nook_push_subs_cap_t on public.push_subs;
create trigger nook_push_subs_cap_t after insert on public.push_subs for each row execute function public.nook_push_subs_cap();

-- old login attempt rows go away
create or replace function public.nook_clean_logs() returns void language sql security definer set search_path to 'public' as $function$
  with a as (delete from cron.job_run_details where end_time < now() - interval '7 days' returning 1),
       b as (delete from net._http_response where created < now() - interval '7 days' returning 1),
       c as (delete from public.mod_notices where seen_at is not null and created_at < now() - interval '7 days' returning 1),
       d as (delete from public.ban_attempts where locked_until is not null and locked_until < now() - interval '7 days' returning 1),
       e as (delete from auth.audit_log_entries where created_at < now() - interval '7 days' returning 1),
       f as (delete from public.login_limits where updated_at < now() - interval '7 days' and (locked_until is null or locked_until < now()) returning 1)
  select null::void
$function$;

-- a leftover helper that does nothing
drop function if exists public.tmp_wipe_users();
