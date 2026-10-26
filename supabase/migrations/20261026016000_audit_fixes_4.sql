-- audit fixes 4: idempotent, non-destructive (no data deleted), every statement guarded.
-- Written against the live schema read on 2026-10-26.

-- 1. server side banned-word check in the posts guard (same list and word-boundary rule as app.js bannedHit).
--    Body is the live nook_posts_guard plus the check; skipped for moderation writes (nook.mod = 1).
do $outer$ begin
  if to_regclass('public.posts') is not null and to_regprocedure('public.nook_media_ok(text,text,uuid)') is not null then
    execute $fn$
create or replace function public.nook_posts_guard() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_url text; arr jsonb; v_author uuid; v_has boolean; v_norm text; v_w text;
begin
  if char_length(coalesce(new.body, '')) > 5000 then raise exception 'post_too_long' using errcode = '23514'; end if;
  if new.media_url is not null and new.media_url <> '' then
    if length(new.media_url) > 4000 then raise exception 'bad_media' using errcode = '23514'; end if;
    begin
      if left(new.media_url, 1) = '[' then arr := new.media_url::jsonb; else arr := to_jsonb(array[new.media_url]); end if;
    exception when others then raise exception 'bad_media' using errcode = '23514';
    end;
    if jsonb_typeof(arr) <> 'array' or jsonb_array_length(arr) > 4 then raise exception 'bad_media' using errcode = '23514'; end if;
    for v_url in select jsonb_array_elements_text(arr) loop
      if not public.nook_media_ok(v_url, 'media', new.user_id) then raise exception 'bad_media' using errcode = '23514'; end if;
    end loop;
  end if;
  if auth.uid() is not null and coalesce(current_setting('nook.mod', true), '') <> '1' then
    if coalesce(new.body, '') <> '' and (tg_op = 'INSERT' or new.body is distinct from old.body) then
      v_norm := ' ' || btrim(regexp_replace(lower(new.body), '[^[:alnum:]]+', ' ', 'g')) || ' ';
      foreach v_w in array array['nigger','nigga','n1gga','n1gger','nigg4','nigg3r','n1gg4','n1gg3r'] loop
        if position(' ' || v_w || ' ' in v_norm) > 0 then raise exception 'banned_word' using errcode = '23514'; end if;
      end loop;
    end if;
    v_has := new.media_url is not null and new.media_url <> '';
    if tg_op = 'INSERT' then
      new.mod_status := case when v_has then 'pending' else 'safe' end;
      new.text_pending := coalesce(new.body, '') <> '';
      new.created_at := now();
    else
      new.created_at := old.created_at;
      new.user_id := old.user_id;
      new.parent_id := old.parent_id;
      if new.media_url is distinct from old.media_url then
        new.mod_status := case when v_has then 'pending' else 'safe' end;
      else
        new.mod_status := old.mod_status;
      end if;
      if new.body is distinct from old.body then new.text_pending := coalesce(new.body, '') <> ''; else new.text_pending := old.text_pending; end if;
    end if;
  end if;
  if tg_op = 'INSERT' and auth.uid() is not null then
    if (select count(*) from public.posts where user_id = new.user_id and created_at > now() - interval '10 minutes') >= 40 then
      raise exception 'rate_limited' using errcode = 'P0001';
    end if;
    if new.parent_id is not null then
      select user_id into v_author from public.posts where id = new.parent_id;
      if v_author is not null and exists (select 1 from public.blocks b where b.blocker_id = v_author and b.blocked_id = new.user_id) then
        raise exception 'blocked' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end $$;
$fn$;
  end if;
end $outer$;

-- 2. nook_block_banned: ban check and age_hold check (re-stated so the repo matches the live body)
do $outer$ begin
  if to_regclass('public.bans') is not null and to_regclass('public.accounts') is not null then
    execute $fn$
create or replace function public.nook_block_banned() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is not null and exists (select 1 from public.bans b where b.user_id = auth.uid()) then
    raise exception 'banned' using errcode = '42501';
  end if;
  if auth.uid() is not null and exists (select 1 from public.accounts a where a.id = auth.uid() and a.age_hold) then
    raise exception 'age_hold' using errcode = '42501';
  end if;
  return new;
end $$;
$fn$;
  end if;
end $outer$;

-- 3. notes cap: an upsert of an existing note must not be refused when the user is at the cap
do $outer$ begin
  if to_regclass('public.notes_self') is not null then
    execute $fn$
create or replace function public.nook_notes_cap() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  if (select count(*) from public.notes_self where owner_id = new.owner_id) >= 20000
     and not exists (select 1 from public.notes_self n where n.owner_id = new.owner_id and n.id = new.id) then
    raise exception 'notes_full';
  end if;
  return new;
end $$;
$fn$;
  end if;
end $outer$;

-- 4. remove_dm_media: live messages.id is bigint; the uuid overload from audit_fixes_3 would make the rpc ambiguous
do $$ begin
  if exists (select 1 from pg_attribute where attrelid = to_regclass('public.messages') and attname = 'id' and atttypid = 'bigint'::regtype)
     and to_regprocedure('public.remove_dm_media(bigint,integer)') is not null
     and to_regprocedure('public.remove_dm_media(uuid,integer)') is not null then
    drop function public.remove_dm_media(uuid, integer);
  end if;
end $$;

-- 5. accounts: moderation columns (age_*, *_mod, text_pending, last_edit_at, edit_burst, delete_after) are not readable
--    by clients; the column list is exactly the app.js ACC_COLS (matches the live grants)
do $$ begin
  if to_regclass('public.accounts') is not null then
    revoke select on public.accounts from anon, authenticated;
    grant select (id, username, display_name, bio, avatar, banner, banner_theme, public_key, deactivated, handle_changed_at, pinned_post_id, created_at)
      on public.accounts to authenticated;
  end if;
end $$;

-- 6. reposts read policy already exists live (reposts read, using true); nothing to do.

-- 7. trigger-only security definer functions must not be callable through /rest/v1/rpc
do $$ declare f text; begin
  foreach f in array array['nook_accounts_edit_gap','nook_force_created_at','nook_key_links_cap','nook_posts_edit_gap','nook_push_subs_cap'] loop
    if to_regprocedure('public.' || f || '()') is not null then
      execute format('revoke all on function public.%I() from public, anon, authenticated', f);
    end if;
  end loop;
end $$;

-- 8. RLS performance: duplicate permissive policies on posts / messages, then initplan fix for auth.uid()
do $$ begin
  if to_regclass('public.posts') is not null
     and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'posts' and policyname = 'owners manage posts') then
    -- "owners manage posts" was FOR ALL: it duplicated the select and delete policies. Insert and update stay as before.
    drop policy if exists "posts insert own" on public.posts;
    create policy "posts insert own" on public.posts for insert to authenticated with check ((select auth.uid()) = user_id);
    drop policy if exists "posts update own" on public.posts;
    create policy "posts update own" on public.posts for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
    drop policy "owners manage posts" on public.posts;
  end if;
  -- a with check (false) insert policy next to another permissive one changes nothing
  drop policy if exists "legacy insert disabled" on public.messages;
end $$;

do $$ declare r record; q text; w text; s text; begin
  for r in select * from pg_policies where schemaname = 'public'
            and (coalesce(qual, '') ~ 'auth\.uid\(\)' or coalesce(with_check, '') ~ 'auth\.uid\(\)') loop
    q := regexp_replace(coalesce(r.qual, ''), '(?<!SELECT )auth\.uid\(\)', '(select auth.uid())', 'g');
    w := regexp_replace(coalesce(r.with_check, ''), '(?<!SELECT )auth\.uid\(\)', '(select auth.uid())', 'g');
    if q is distinct from coalesce(r.qual, '') or w is distinct from coalesce(r.with_check, '') then
      s := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
      if r.qual is not null then s := s || ' using (' || q || ')'; end if;
      if r.with_check is not null then s := s || ' with check (' || w || ')'; end if;
      execute s;
    end if;
  end loop;
end $$;

-- 9. duplicate indexes (identical definitions; the kept one stays). Indexes only, no data.
do $$ begin
  if to_regclass('public.messages_sender_created') is not null then drop index if exists public.messages_sender_idx; end if;
  if to_regclass('public.posts_user_created') is not null then drop index if exists public.posts_user_idx; end if;
  if to_regclass('public.post_shares_pkey') is not null then drop index if exists public.post_shares_post; end if;
  if to_regclass('public.post_saves_pkey') is not null then drop index if exists public.post_saves_post; end if;
end $$;

-- 10. indexes for foreign keys without one (advisor 0001)
do $$ declare x text[]; begin
  foreach x slice 1 in array array[
    array['blocks','blocked_id'], array['dm_mutes','target_id'], array['likes','post_id'], array['mod_notices','user_id'],
    array['mutes','muted_id'], array['notifications','actor_id'], array['post_saves','user_id'], array['post_shares','user_id'],
    array['reposts','post_id'], array['user_reports','reported_id']] loop
    if to_regclass('public.' || x[1]) is not null
       and exists (select 1 from pg_attribute where attrelid = to_regclass('public.' || x[1]) and attname = x[2] and not attisdropped) then
      execute format('create index if not exists %I on public.%I (%I)', x[1] || '_' || x[2] || '_idx', x[1], x[2]);
    end if;
  end loop;
end $$;

-- 11. trigram indexes for search_accounts (ilike); only if pg_trgm is installed or can be installed
do $$ begin
  if not exists (select 1 from pg_extension where extname = 'pg_trgm')
     and exists (select 1 from pg_available_extensions where name = 'pg_trgm') then
    begin
      create extension if not exists pg_trgm with schema extensions;
    exception when others then null;
    end;
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_trgm') and to_regclass('public.accounts') is not null then
    execute format('create index if not exists accounts_username_trgm on public.accounts using gin (username %s.gin_trgm_ops)',
      (select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm'));
    execute format('create index if not exists accounts_display_name_trgm on public.accounts using gin (display_name %s.gin_trgm_ops)',
      (select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm'));
  end if;
end $$;

-- 12. passkey sign-in busy check per address: the function can count by ip instead of globally (function change still needed)
do $$ begin
  if to_regclass('public.passkey_challenges') is not null then
    alter table public.passkey_challenges add column if not exists ip text;
    create index if not exists passkey_challenges_created on public.passkey_challenges (created_at);
    create index if not exists passkey_challenges_ip_idx on public.passkey_challenges (purpose, ip, created_at);
  end if;
end $$;
