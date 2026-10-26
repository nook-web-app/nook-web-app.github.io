-- audit fixes 5: needs the matching app.js (ships together)

-- 1. shares and saves: people only read their own rows; counts and own flags come from one rpc
do $$ begin
  if to_regclass('public.post_shares') is not null then
    drop policy if exists post_shares_read on public.post_shares;
    create policy post_shares_read on public.post_shares for select to authenticated using (user_id = auth.uid());
  end if;
  if to_regclass('public.post_saves') is not null then
    drop policy if exists post_saves_read on public.post_saves;
    create policy post_saves_read on public.post_saves for select to authenticated using (user_id = auth.uid());
  end if;
end $$;

create or replace function public.post_share_save_stats(p_ids uuid[])
returns table (post_id uuid, shares integer, saves integer, i_shared boolean, i_saved boolean)
language sql stable security definer set search_path = public
as $$
  select i,
    (select count(*)::int from public.post_shares s where s.post_id = i),
    (select count(*)::int from public.post_saves v where v.post_id = i),
    exists (select 1 from public.post_shares s where s.post_id = i and s.user_id = auth.uid()),
    exists (select 1 from public.post_saves v where v.post_id = i and v.user_id = auth.uid())
  from unnest(p_ids[1:500]) as i
  where auth.uid() is not null;
$$;
revoke all on function public.post_share_save_stats(uuid[]) from public, anon;
grant execute on function public.post_share_save_stats(uuid[]) to authenticated;

-- 2. dm-media becomes private; the owner of a folder and the person a message was sent to can read a file
create or replace function public.nook_dm_media_readable(p_name text)
returns boolean language plpgsql stable security definer set search_path = public
as $$
declare owner_id uuid;
begin
  if auth.uid() is null or p_name is null then return false; end if;
  if split_part(p_name, '/', 1) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  owner_id := split_part(p_name, '/', 1)::uuid;
  if owner_id = auth.uid() then return true; end if;
  return exists (
    select 1 from public.messages m
    where m.sender_id = owner_id and m.recipient_id = auth.uid()
      and strpos(m.media::text, p_name) > 0
  );
end $$;
revoke all on function public.nook_dm_media_readable(text) from public, anon;
grant execute on function public.nook_dm_media_readable(text) to authenticated;

do $$ begin
  if exists (select 1 from storage.buckets where id = 'dm-media') then
    update storage.buckets set public = false where id = 'dm-media' and public is distinct from false;
  end if;
  drop policy if exists "dm media read own folder" on storage.objects;
  drop policy if exists "dm media read own or received" on storage.objects;
  create policy "dm media read own or received" on storage.objects for select to authenticated
    using (bucket_id = 'dm-media' and public.nook_dm_media_readable(name));
exception when insufficient_privilege then
  raise notice 'storage policy not changed: insufficient privilege';
end $$;

-- 3. typing signals: private realtime channel tp-<recipient>; only the recipient listens, only a mutual follower (not blocked) may send
create or replace function public.nook_tp_send_ok(p_topic text)
returns boolean language plpgsql stable security definer set search_path = public
as $$
declare other uuid;
begin
  if auth.uid() is null or p_topic is null then return false; end if;
  if p_topic !~* '^tp-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  other := substr(p_topic, 4)::uuid;
  if other = auth.uid() then return false; end if;
  return exists (select 1 from public.follows f where f.follower_id = auth.uid() and f.followee_id = other)
    and exists (select 1 from public.follows f where f.follower_id = other and f.followee_id = auth.uid())
    and not exists (select 1 from public.blocks b where (b.blocker_id = auth.uid() and b.blocked_id = other) or (b.blocker_id = other and b.blocked_id = auth.uid()));
end $$;
revoke all on function public.nook_tp_send_ok(text) from public, anon;
grant execute on function public.nook_tp_send_ok(text) to authenticated;

do $$ begin
  drop policy if exists "tp receive own" on realtime.messages;
  create policy "tp receive own" on realtime.messages for select to authenticated
    using (extension = 'broadcast' and realtime.topic() = 'tp-' || auth.uid()::text);
  drop policy if exists "tp send to mutual" on realtime.messages;
  create policy "tp send to mutual" on realtime.messages for insert to authenticated
    with check (extension = 'broadcast' and public.nook_tp_send_ok(realtime.topic()));
exception when insufficient_privilege or undefined_table or undefined_function then
  raise notice 'realtime policies not changed';
end $$;

-- 5. inbox: last message and unread count per conversation, whatever the history length
create or replace function public.dm_inbox()
returns table (id bigint, sender_id uuid, recipient_id uuid, body text, media jsonb, created_at timestamptz, read_at timestamptz, other_id uuid, unread integer)
language sql stable security invoker set search_path = public
as $$
  with m as (
    select x.*, case when x.sender_id = auth.uid() then x.recipient_id else x.sender_id end as o
    from public.messages x
    where x.sender_id = auth.uid() or x.recipient_id = auth.uid()
  ), u as (
    select o, count(*)::int as n from m where m.recipient_id = auth.uid() and m.read_at is null group by o
  )
  select l.id, l.sender_id, l.recipient_id, l.body, l.media, l.created_at, l.read_at, l.o, coalesce(u.n, 0)
  from (select distinct on (o) * from m order by o, created_at desc, id desc) l
  left join u on u.o = l.o
  order by l.created_at desc;
$$;
revoke all on function public.dm_inbox() from public, anon;
grant execute on function public.dm_inbox() to authenticated;

-- 6. muting an already muted chat is an upsert, which needs update on dm_mutes
do $$ begin
  if to_regclass('public.dm_mutes') is not null then
    grant update on public.dm_mutes to authenticated;
    drop policy if exists dm_mutes_update on public.dm_mutes;
    create policy dm_mutes_update on public.dm_mutes for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
  end if;
end $$;
