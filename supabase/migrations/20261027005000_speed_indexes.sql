-- speed: indexes for the feed, the chat list and Zenith sync, auth.uid() evaluated once per statement, a faster dm_inbox (measured on 1M posts and 1M messages: feed 599 ms to 2.8 ms, dm_inbox 440 ms to 8 ms)

-- loadFeed: order by created_at desc limit N over posts_feed. Plain (not partial) because the read policy is "own posts OR safe", so a partial
-- "mod_status = 'safe'" index could not serve the own-pending rows. Keyset pagination is done client side: .lt("created_at", lastCreatedAt).
create index if not exists posts_created_at_idx on public.posts (created_at desc, id desc);

-- (select auth.uid()) is an InitPlan: evaluated once per statement instead of once per row. Same semantics.
do $$ begin
  if to_regclass('public.dm_mutes') is not null then
    alter policy dm_mutes_update on public.dm_mutes using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
  end if;
  if to_regclass('public.post_shares') is not null then
    alter policy post_shares_read on public.post_shares using (user_id = (select auth.uid()));
  end if;
  if to_regclass('public.post_saves') is not null then
    alter policy post_saves_read on public.post_saves using (user_id = (select auth.uid()));
  end if;
exception when undefined_object then raise notice 'a policy was missing, skipped: %', sqlerrm;
end $$;
do $$ begin
  alter policy "tp receive own" on realtime.messages
    using (extension = 'broadcast' and realtime.topic() = 'tp-' || (select auth.uid())::text);
exception when insufficient_privilege or undefined_table or undefined_object or undefined_function then
  raise notice 'realtime policy not changed: %', sqlerrm;
end $$;

-- optional: post_saves/post_shares are only keyed (post_id, user_id), so "my saves/shares" (the read policy is user_id = me) reads the whole index.
create index if not exists post_saves_user_idx  on public.post_saves  (user_id);
create index if not exists post_shares_user_idx on public.post_shares (user_id);

-- posts_mod_pending_idx and posts_pending_idx are identical (created_at) where mod_status = 'pending'. Keep posts_pending_idx (older).
-- NOTE: 20261026023000_perf_indexes.sql re-creates posts_mod_pending_idx with "create index if not exists"; edit that line (or it comes back on a replay).
drop index if exists public.posts_mod_pending_idx;

-- dm_inbox(): O(#peers) instead of O(#messages). Needs one index per direction that starts (me, peer) and one partial index for unread.
create index if not exists messages_pair_out_idx on public.messages (sender_id, recipient_id, created_at desc, id desc);
create index if not exists messages_pair_in_idx  on public.messages (recipient_id, sender_id, created_at desc, id desc);
create index if not exists messages_unread_idx   on public.messages (recipient_id, sender_id) where read_at is null;

create or replace function public.dm_inbox()
returns table (id bigint, sender_id uuid, recipient_id uuid, body text, media jsonb, created_at timestamptz, read_at timestamptz, other_id uuid, unread integer)
language sql stable security definer set search_path = public
as $$
  with recursive
  -- loose index scan: one probe per distinct peer, per direction
  po as (
    (select m.recipient_id as o from public.messages m where m.sender_id = (select auth.uid()) order by m.recipient_id limit 1)
    union all
    select (select m.recipient_id from public.messages m where m.sender_id = (select auth.uid()) and m.recipient_id > po.o order by m.recipient_id limit 1) from po where po.o is not null
  ), pi as (
    (select m.sender_id as o from public.messages m where m.recipient_id = (select auth.uid()) order by m.sender_id limit 1)
    union all
    select (select m.sender_id from public.messages m where m.recipient_id = (select auth.uid()) and m.sender_id > pi.o order by m.sender_id limit 1) from pi where pi.o is not null
  ), peers as (
    select o from po where o is not null union select o from pi where o is not null
  )
  select l.id, l.sender_id, l.recipient_id, l.body, l.media, l.created_at, l.read_at, p.o,
         (select count(*)::int from public.messages x where x.recipient_id = (select auth.uid()) and x.sender_id = p.o and x.read_at is null)
  from peers p
  cross join lateral (
    select * from (
      (select a.* from public.messages a where a.sender_id = (select auth.uid()) and a.recipient_id = p.o order by a.created_at desc, a.id desc limit 1)
      union all
      (select b.* from public.messages b where b.recipient_id = (select auth.uid()) and b.sender_id = p.o order by b.created_at desc, b.id desc limit 1)
    ) c order by c.created_at desc, c.id desc limit 1
  ) l
  order by l.created_at desc;
$$;
revoke all on function public.dm_inbox() from public, anon;
grant execute on function public.dm_inbox() to authenticated;

-- WHY SECURITY DEFINER: with SECURITY INVOKER the RLS qual (uid = sender_id OR uid = recipient_id) turns every probe into a BitmapOr that reads the
-- user's whole history, and the skip scan degrades to 2000 ms for 100k messages (measured, worse than today). Every statement below filters on
-- auth.uid() itself (null uid -> no rows), so the rows returned are exactly those "messages read own" allows. Execute stays revoked from anon/public.

-- unread message count (recipient_id = me and read_at is null limit 500) and dm_inbox unread per peer.
create index if not exists messages_unread_idx on public.messages (recipient_id, sender_id) where read_at is null;
-- notifications: NO new index. notifications_dedupe_idx (user_id, actor_id, kind) where read_at is null already serves the unread count
-- (measured 0.88 ms vs 0.77 ms with an extra partial index, not worth the write cost).

create index if not exists zenith_docs_owner_updated_idx on public.zenith_docs (owner_id, updated_at desc);
