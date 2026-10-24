-- Audit fixes, part 2. Paste this whole file in the Supabase SQL editor and run it once.

-- 1. email aliases: name+tag@gmail.com and n.a.m.e@gmail.com count as the same email for the age lock
create or replace function public.nook_email_norm(p text) returns text language sql immutable set search_path to 'public' as $$
  select case when p is null then null else (
    select case when d in ('gmail.com', 'googlemail.com') then replace(split_part(l, '+', 1), '.', '') || '@gmail.com' else split_part(l, '+', 1) || '@' || d end
    from (select lower(split_part(p, '@', 1)) as l, lower(split_part(p, '@', 2)) as d) s
  ) end
$$;

create or replace function public.nook_age_hold_sync() returns trigger language plpgsql security definer set search_path to 'public', 'extensions' as $function$
declare v_hash text; v_old text;
begin
  select encode(digest(public.nook_email_norm(email), 'sha256'), 'hex'), encode(digest(lower(email), 'sha256'), 'hex') into v_hash, v_old from auth.users where id = new.id;
  if v_hash is null then return new; end if;
  -- the lock follows the email, so deleting the account and signing up again does not remove it
  if new.age_hold then
    insert into public.age_holds (email_hash) values (v_hash) on conflict do nothing;
    insert into public.age_holds (email_hash) values (v_old) on conflict do nothing;
  else
    delete from public.age_holds where email_hash in (v_hash, v_old);
  end if;
  return new;
end $function$;

create or replace function public.nook_accounts_mod() returns trigger language plpgsql security definer set search_path to 'public', 'extensions' as $function$
declare v_hash text; v_old text;
begin
  if auth.uid() is not null then
    if tg_op = 'INSERT' then
      new.age_hold := false; new.age_verified := false; new.age_session := null; new.age_fails := 0;
      -- somebody who was locked and made a new account with the same email stays locked
      select encode(digest(public.nook_email_norm(email), 'sha256'), 'hex'), encode(digest(lower(email), 'sha256'), 'hex') into v_hash, v_old from auth.users where id = new.id;
      if v_hash is not null and exists (select 1 from public.age_holds where email_hash in (v_hash, v_old)) then new.age_hold := true; end if;
    else
      new.age_hold := old.age_hold; new.age_verified := old.age_verified; new.age_session := old.age_session; new.age_fails := old.age_fails;
    end if;
  end if;
  if auth.uid() is not null and coalesce(current_setting('nook.mod', true), '') <> '1' then
    if tg_op = 'INSERT' then
      new.avatar_mod := case when new.avatar is not null and new.avatar <> '' then 'pending' else 'safe' end;
      new.banner_mod := case when new.banner is not null and new.banner <> '' then 'pending' else 'safe' end;
      new.text_pending := true;
    else
      if new.avatar is distinct from old.avatar then new.avatar_mod := case when new.avatar is not null and new.avatar <> '' then 'pending' else 'safe' end; else new.avatar_mod := old.avatar_mod; end if;
      if new.banner is distinct from old.banner then new.banner_mod := case when new.banner is not null and new.banner <> '' then 'pending' else 'safe' end; else new.banner_mod := old.banner_mod; end if;
      if new.username is distinct from old.username or new.display_name is distinct from old.display_name or new.bio is distinct from old.bio then new.text_pending := true; else new.text_pending := old.text_pending; end if;
    end if;
  end if;
  return new;
end $function$;

-- 2. a banned account is erased for good once its 30 day download copy expires
create or replace function public.nook_sweep_archives() returns integer language plpgsql security definer set search_path to 'public' as $function$
declare r record; n int := 0;
begin
  for r in select user_id from public.ban_archive where expires_at <= now() loop
    perform public.nook_archive_storage(r.user_id, true);
    perform public.nook_purge_user(r.user_id);
    delete from auth.users where id = r.user_id;
    n := n + 1;
  end loop;
  perform public.nook_drop_expired_archives();
  return n;
end $function$;

-- 3. upload limits per person (the app never gets close to these)
alter policy "media upload own" on storage.objects with check (
  bucket_id = 'media' and (storage.foldername(name))[1] = (auth.uid())::text
  and (select count(*) from storage.objects o where o.bucket_id = 'media' and (storage.foldername(o.name))[1] = (auth.uid())::text) < 300
);
alter policy "dm media upload own folder" on storage.objects with check (
  bucket_id = 'dm-media' and (storage.foldername(name))[1] = (auth.uid())::text
  and (select count(*) from storage.objects o where o.bucket_id = 'dm-media' and (storage.foldername(o.name))[1] = (auth.uid())::text) < 600
);
update storage.buckets set file_size_limit = 10485760 where id = 'media';

-- 4. a report can only hide a photo post when two different, older accounts reported it
create or replace function public.nook_report_after() returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare n int;
begin
  select count(distinct r.reporter_id) into n from public.reports r join public.accounts a on a.id = r.reporter_id
    where r.post_id = new.post_id and a.created_at < now() - interval '1 day';
  if n >= 2 then
    perform set_config('nook.mod', '1', true);
    update public.posts set mod_status = 'pending' where id = new.post_id and mod_status = 'safe' and media_url is not null and media_url <> '';
  end if;
  if n >= 2 or new.reason in ('threats', 'selfharm') then
    perform set_config('nook.mod', '1', true);
    update public.posts set text_pending = true where id = new.post_id and not text_pending and coalesce(body, '') <> '';
  end if;
  perform set_config('nook.mod', '', true);
  return new;
end $function$;
