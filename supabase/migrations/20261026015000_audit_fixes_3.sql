-- audit fixes 3: idempotent, non-destructive, every statement guarded against missing objects

-- 1. maintenance functions must not be callable through /rest/v1/rpc
do $$ begin
  if to_regprocedure('public.nook_clean_logs()') is not null then
    revoke all on function public.nook_clean_logs() from public, anon, authenticated;
    grant execute on function public.nook_clean_logs() to service_role;
  end if;
  if to_regprocedure('public.nook_sweep_archives()') is not null then
    revoke all on function public.nook_sweep_archives() from public, anon, authenticated;
    grant execute on function public.nook_sweep_archives() to service_role;
  end if;
  if to_regprocedure('public.set_my_deactivated(boolean)') is not null then
    revoke all on function public.set_my_deactivated(boolean) from public, anon;
    grant execute on function public.set_my_deactivated(boolean) to authenticated;
  end if;
end $$;

-- 2. dm_mutes upserts (re-mute with a new duration, hide chat) need update
do $$ begin
  if to_regclass('public.dm_mutes') is not null then
    grant update on public.dm_mutes to authenticated;
    drop policy if exists dm_mutes_update on public.dm_mutes;
    create policy dm_mutes_update on public.dm_mutes for update to authenticated
      using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
  end if;
end $$;

-- 3. remove_dm_media: messages.id is uuid, app.js passes the uuid
do $outer$ begin
  if to_regclass('public.messages') is not null then
    execute $fn$
create or replace function public.remove_dm_media(p_msg uuid, p_idx int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.messages%rowtype; newmedia jsonb;
begin
  select * into m from public.messages where id = p_msg and sender_id = auth.uid() for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select coalesce(jsonb_agg(e.v order by e.i), '[]'::jsonb) into newmedia
    from jsonb_array_elements(m.media) with ordinality as e(v, i) where e.i - 1 <> p_idx;
  if btrim(m.body) = '' and jsonb_array_length(newmedia) = 0 then
    delete from public.messages where id = p_msg;
    return jsonb_build_object('deleted', true);
  end if;
  perform set_config('nook.msg_edit', '1', true);
  update public.messages set media = newmedia where id = p_msg;
  return jsonb_build_object('deleted', false, 'media', newmedia);
end $$;
$fn$;
    revoke all on function public.remove_dm_media(uuid, int) from public, anon;
    grant execute on function public.remove_dm_media(uuid, int) to authenticated;
  end if;
end $outer$;

-- 4. banned / age-held accounts cannot edit posts or accounts either
do $$ begin
  if to_regprocedure('public.nook_block_banned()') is not null then
    if to_regclass('public.posts') is not null then
      drop trigger if exists nook_block_banned_upd on public.posts;
      create trigger nook_block_banned_upd before update on public.posts for each row execute function public.nook_block_banned();
    end if;
    if to_regclass('public.accounts') is not null then
      drop trigger if exists nook_block_banned_upd on public.accounts;
      create trigger nook_block_banned_upd before update on public.accounts for each row execute function public.nook_block_banned();
    end if;
  end if;
end $$;

-- 5. posts: created_at forced on insert; created_at / parent_id / user_id immutable for clients
create or replace function public.nook_posts_time_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    if tg_op = 'INSERT' then
      new.created_at := now();
    elsif new.created_at is distinct from old.created_at
       or new.parent_id is distinct from old.parent_id
       or new.user_id is distinct from old.user_id then
      raise exception 'immutable' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.nook_posts_time_guard() from public, anon, authenticated;
do $$ begin
  if to_regclass('public.posts') is not null then
    drop trigger if exists nook_posts_time_guard on public.posts;
    create trigger nook_posts_time_guard before insert or update on public.posts for each row execute function public.nook_posts_time_guard();
  end if;
end $$;

-- 6. notes_self media size cap (not valid: existing rows are not rechecked)
do $$ begin
  if to_regclass('public.notes_self') is not null
     and not exists (select 1 from pg_constraint where conname = 'notes_self_media_size' and conrelid = 'public.notes_self'::regclass) then
    alter table public.notes_self add constraint notes_self_media_size check (length(media::text) <= 400000) not valid;
  end if;
end $$;

-- 7. indexes
do $$ begin
  if to_regclass('public.account_links') is not null then
    create index if not exists account_links_b_idx on public.account_links (b);
  end if;
  if to_regclass('public.passkey_challenges') is not null then
    create index if not exists passkey_challenges_created on public.passkey_challenges (created_at);
  end if;
  -- duplicates of the (post_id, user_id) primary keys
  drop index if exists public.post_shares_post;
  drop index if exists public.post_saves_post;
end $$;
