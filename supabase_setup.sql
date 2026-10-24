create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  body text not null default '',
  media jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint messages_not_self check (sender_id <> recipient_id)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('follow', 'reply', 'message')),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint notifications_not_self check (user_id <> actor_id)
);

alter table public.messages enable row level security;
alter table public.notifications enable row level security;

drop policy if exists "messages read own" on public.messages;
create policy "messages read own" on public.messages
  for select to authenticated
  using (auth.uid() = sender_id or auth.uid() = recipient_id);

drop policy if exists "messages send to mutual follows" on public.messages;
create policy "messages send to mutual follows" on public.messages
  for insert to authenticated
  with check (
    auth.uid() = sender_id
    and exists (select 1 from public.follows f where f.follower_id = sender_id and f.followee_id = recipient_id)
    and exists (select 1 from public.follows f where f.follower_id = recipient_id and f.followee_id = sender_id)
    and not exists (select 1 from public.blocks b where (b.blocker_id = sender_id and b.blocked_id = recipient_id) or (b.blocker_id = recipient_id and b.blocked_id = sender_id))
  );

drop policy if exists "messages mark read" on public.messages;
create policy "messages mark read" on public.messages
  for update to authenticated
  using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);

drop policy if exists "notifications read own" on public.notifications;
create policy "notifications read own" on public.notifications
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "notifications insert as actor" on public.notifications;
create policy "notifications insert as actor" on public.notifications
  for insert to authenticated
  with check (auth.uid() = actor_id and user_id <> actor_id);

drop policy if exists "notifications mark read" on public.notifications;
create policy "notifications mark read" on public.notifications
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "likes read all" on public.likes;
create policy "likes read all" on public.likes
  for select to authenticated
  using (true);

drop policy if exists "reposts read all" on public.reposts;
create policy "reposts read all" on public.reposts
  for select to authenticated
  using (true);

insert into storage.buckets (id, name, public) values ('dm-media', 'dm-media', true)
  on conflict (id) do nothing;

drop policy if exists "dm media upload own folder" on storage.objects;
create policy "dm media upload own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'dm-media' and (storage.foldername(name))[1] = auth.uid()::text);

do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null;
end $$;

drop policy if exists "posts delete own" on public.posts;
create policy "posts delete own" on public.posts
  for delete to authenticated
  using (auth.uid() = user_id);

drop policy if exists "media delete own folder" on storage.objects;
create policy "media delete own folder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

alter table public.accounts add column if not exists display_name text;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in ('follow', 'reply', 'message', 'like', 'repost'));

alter table public.messages add column if not exists sender_id uuid;
alter table public.messages add column if not exists recipient_id uuid;
alter table public.messages add column if not exists body text not null default '';
alter table public.messages add column if not exists media jsonb not null default '[]'::jsonb;
alter table public.messages add column if not exists created_at timestamptz not null default now();
alter table public.messages add column if not exists read_at timestamptz;

alter table public.notifications add column if not exists user_id uuid;
alter table public.notifications add column if not exists actor_id uuid;
alter table public.notifications add column if not exists kind text;
alter table public.notifications add column if not exists created_at timestamptz not null default now();
alter table public.notifications add column if not exists read_at timestamptz;

drop policy if exists "messages delete own" on public.messages;
create policy "messages delete own" on public.messages
  for delete to authenticated
  using (auth.uid() = sender_id);

drop policy if exists "dm media delete own folder" on storage.objects;
create policy "dm media delete own folder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'dm-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "posts update own" on public.posts;
create policy "posts update own" on public.posts
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "likes delete own" on public.likes;
create policy "likes delete own" on public.likes
  for delete to authenticated
  using (auth.uid() = user_id);

drop policy if exists "reposts delete own" on public.reposts;
create policy "reposts delete own" on public.reposts
  for delete to authenticated
  using (auth.uid() = user_id);


alter table public.accounts add column if not exists banner text;
alter table public.accounts add column if not exists banner_theme text;

create or replace function public.nook_drop_replies()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.likes where post_id in (select id from public.posts where parent_id = old.id);
  delete from public.reposts where post_id in (select id from public.posts where parent_id = old.id);
  delete from public.posts where parent_id = old.id;
  return old;
end $$;

drop trigger if exists nook_drop_replies on public.posts;
create trigger nook_drop_replies
  before delete on public.posts
  for each row execute function public.nook_drop_replies();

create or replace function public.nook_drop_follows_on_block()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.follows
  where (follower_id = new.blocker_id and followee_id = new.blocked_id)
     or (follower_id = new.blocked_id and followee_id = new.blocker_id);
  return new;
end $$;

drop trigger if exists nook_drop_follows_on_block on public.blocks;
create trigger nook_drop_follows_on_block
  after insert on public.blocks
  for each row execute function public.nook_drop_follows_on_block();

alter table public.accounts add column if not exists public_key text;

notify pgrst, 'reload schema';


-- =====================================================================
-- v2.10.0 changes (applied to the live project on 2026-10-22)
-- Run this part once in the sql editor if you ever rebuild the project.
-- Note: the supabase mcp tool asks for confirmation on top level DROP and
-- DELETE statements, so this file avoids them and uses ALTER POLICY instead.
-- =====================================================================

create extension if not exists pg_net with schema extensions;

-- columns the app already wrote to but that did not exist
alter table public.accounts add column if not exists banner text;
alter table public.accounts add column if not exists banner_theme text;
alter table public.accounts add column if not exists handle_changed_at timestamptz;
alter table public.accounts add column if not exists pinned_post_id uuid references public.posts(id) on delete set null;
alter table public.notifications add column if not exists post_id uuid references public.posts(id) on delete cascade;

-- foreign keys: deleting an auth user or an account removes everything they own
do $$ begin alter table public.accounts add constraint accounts_id_fkey foreign key (id) references auth.users(id) on delete cascade; exception when duplicate_object then null; end $$;
do $$ begin alter table public.posts add constraint posts_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade; exception when duplicate_object then null; end $$;
do $$ begin alter table public.messages add constraint messages_sender_id_fkey foreign key (sender_id) references auth.users(id) on delete cascade; exception when duplicate_object then null; end $$;
do $$ begin alter table public.messages add constraint messages_recipient_id_fkey foreign key (recipient_id) references auth.users(id) on delete cascade; exception when duplicate_object then null; end $$;
do $$ begin alter table public.posts add constraint posts_user_acct_fkey foreign key (user_id) references public.accounts(id) on delete cascade; exception when duplicate_object then null; end $$;
do $$ begin alter table public.messages add constraint messages_sender_acct_fkey foreign key (sender_id) references public.accounts(id) on delete cascade; exception when duplicate_object then null; end $$;
do $$ begin alter table public.messages add constraint messages_recipient_acct_fkey foreign key (recipient_id) references public.accounts(id) on delete cascade; exception when duplicate_object then null; end $$;
do $$ begin alter table public.likes add constraint likes_user_acct_fkey foreign key (user_id) references public.accounts(id) on delete cascade; exception when duplicate_object then null; end $$;
do $$ begin alter table public.follows add constraint follows_follower_acct_fkey foreign key (follower_id) references public.accounts(id) on delete cascade; exception when duplicate_object then null; end $$;
do $$ begin alter table public.follows add constraint follows_followee_acct_fkey foreign key (followee_id) references public.accounts(id) on delete cascade; exception when duplicate_object then null; end $$;
do $$ begin alter table public.blocks add constraint blocks_blocker_acct_fkey foreign key (blocker_id) references public.accounts(id) on delete cascade; exception when duplicate_object then null; end $$;
do $$ begin alter table public.blocks add constraint blocks_blocked_acct_fkey foreign key (blocked_id) references public.accounts(id) on delete cascade; exception when duplicate_object then null; end $$;
do $$ begin alter table public.notifications add constraint notifications_user_acct_fkey foreign key (user_id) references public.accounts(id) on delete cascade; exception when duplicate_object then null; end $$;
do $$ begin alter table public.notifications add constraint notifications_actor_acct_fkey foreign key (actor_id) references public.accounts(id) on delete cascade; exception when duplicate_object then null; end $$;

create unique index if not exists accounts_username_lower_key on public.accounts (lower(username));
create index if not exists messages_recipient_idx on public.messages (recipient_id, created_at desc);
create index if not exists messages_sender_idx on public.messages (sender_id, created_at desc);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_post_idx on public.notifications (post_id);
create index if not exists posts_parent_idx on public.posts (parent_id);
create index if not exists posts_user_idx on public.posts (user_id, created_at desc);
create index if not exists follows_followee_idx on public.follows (followee_id);
create index if not exists accounts_pinned_idx on public.accounts (pinned_post_id);

-- new tables
create table if not exists public.nicknames (
  owner_id uuid not null references auth.users(id) on delete cascade,
  target_id uuid not null references auth.users(id) on delete cascade,
  nickname text not null check (char_length(nickname) between 1 and 30),
  updated_at timestamptz not null default now(),
  primary key (owner_id, target_id),
  check (owner_id <> target_id)
);
create table if not exists public.chat_clears (
  user_id uuid not null references auth.users(id) on delete cascade,
  other_id uuid not null references auth.users(id) on delete cascade,
  cleared_at timestamptz not null default now(),
  primary key (user_id, other_id)
);
create table if not exists public.bans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  banned_at timestamptz not null default now()
);
create table if not exists public.totp_secrets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  secret text not null,
  enabled boolean not null default false,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  last_counter bigint,
  created_at timestamptz not null default now()
);
create table if not exists public.push_subs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index if not exists nicknames_target_idx on public.nicknames (target_id);
create index if not exists chat_clears_other_idx on public.chat_clears (other_id);
create index if not exists push_subs_user_idx on public.push_subs (user_id);
do $$ begin alter table public.push_subs add constraint push_subs_endpoint_host check (endpoint ~ '^https://([a-z0-9-]+\.)*(googleapis\.com|mozilla\.com|mozaws\.net|push\.apple\.com|windows\.com|microsoft\.com)(:[0-9]+)?/') not valid; exception when duplicate_object then null; end $$;
do $$ begin alter table public.nicknames add constraint nicknames_owner_acct_fkey foreign key (owner_id) references public.accounts(id) on delete cascade; exception when duplicate_object then null; end $$;
do $$ begin alter table public.nicknames add constraint nicknames_target_acct_fkey foreign key (target_id) references public.accounts(id) on delete cascade; exception when duplicate_object then null; end $$;
do $$ begin alter table public.chat_clears add constraint chat_clears_user_acct_fkey foreign key (user_id) references public.accounts(id) on delete cascade; exception when duplicate_object then null; end $$;
do $$ begin alter table public.chat_clears add constraint chat_clears_other_acct_fkey foreign key (other_id) references public.accounts(id) on delete cascade; exception when duplicate_object then null; end $$;
do $$ begin alter table public.push_subs add constraint push_subs_user_acct_fkey foreign key (user_id) references public.accounts(id) on delete cascade; exception when duplicate_object then null; end $$;
do $$ begin alter table public.totp_secrets add constraint totp_secrets_user_acct_fkey foreign key (user_id) references public.accounts(id) on delete cascade; exception when duplicate_object then null; end $$;

alter table public.nicknames enable row level security;
alter table public.chat_clears enable row level security;
alter table public.bans enable row level security;
alter table public.totp_secrets enable row level security;
alter table public.push_subs enable row level security;

-- table privileges (tables created by the mcp role did not get the usual default grants,
-- which is why notifications could never be read before)
grant select, update, delete on public.notifications to authenticated;
grant select, insert, update, delete on public.nicknames to authenticated;
grant select, insert, update, delete on public.chat_clears to authenticated;
grant select, insert, update, delete on public.push_subs to authenticated;
grant select on public.bans to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
revoke all on public.totp_secrets from anon, authenticated;
revoke all on public.bans from anon;
revoke insert, update, delete on public.bans from authenticated;

create policy "nicknames own" on public.nicknames for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "chat clears own" on public.chat_clears for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "bans read own" on public.bans for select to authenticated using (user_id = auth.uid());
create policy "push subs own" on public.push_subs for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "messages delete own" on public.messages for delete to authenticated using (auth.uid() = sender_id);
create policy "notifications delete own" on public.notifications for delete to authenticated using (auth.uid() = user_id);
-- the old insert policy let anyone skip the mutual follow rule, and clients can no longer create notifications
alter policy "senders insert messages" on public.messages with check (false);
alter policy "senders insert messages" on public.messages rename to "legacy insert disabled";
alter policy "notifications insert as actor" on public.notifications with check (false);
alter policy "notifications insert as actor" on public.notifications rename to "client inserts disabled";
-- storage: dm files need a select policy too, otherwise the storage api finds nothing to delete
create policy "dm media delete own folder" on storage.objects for delete to authenticated using (bucket_id = 'dm-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "dm media read own folder" on storage.objects for select to authenticated using (bucket_id = 'dm-media' and (storage.foldername(name))[1] = auth.uid()::text);

do $$ begin alter publication supabase_realtime add table public.follows; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.blocks; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.bans; exception when duplicate_object then null; end $$;

-- secrets used by the edge functions (random values, stored in the vault)
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'nook_purge_secret', 'shared secret for the purge-media and send-push edge functions')
  where not exists (select 1 from vault.secrets where name = 'nook_purge_secret');
-- the web push private key is stored the same way under the name nook_vapid_private

create or replace function public.nook_purge_secret() returns text language sql security definer set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'nook_purge_secret' limit 1
$$;
create or replace function public.nook_vapid_private() returns text language sql security definer set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'nook_vapid_private' limit 1
$$;
revoke all on function public.nook_purge_secret() from public, anon, authenticated;
revoke all on function public.nook_vapid_private() from public, anon, authenticated;
grant execute on function public.nook_purge_secret() to service_role;
grant execute on function public.nook_vapid_private() to service_role;

-- notifications are created by triggers so they can not be forged and always arrive
create or replace function public.nook_add_notification(p_user uuid, p_actor uuid, p_kind text, p_post uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_actor is null or p_user = p_actor then return; end if;
  if exists (select 1 from public.blocks b where (b.blocker_id = p_user and b.blocked_id = p_actor) or (b.blocker_id = p_actor and b.blocked_id = p_user)) then return; end if;
  if exists (select 1 from public.notifications n where n.user_id = p_user and n.actor_id = p_actor and n.kind = p_kind and n.post_id is not distinct from p_post and n.read_at is null) then return; end if;
  insert into public.notifications (user_id, actor_id, kind, post_id) values (p_user, p_actor, p_kind, p_post);
end $$;
revoke all on function public.nook_add_notification(uuid, uuid, text, uuid) from public, anon, authenticated;

create or replace function public.nook_notify_follow() returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.nook_add_notification(new.followee_id, new.follower_id, 'follow', null); return new; end $$;
create or replace function public.nook_notify_reply() returns trigger language plpgsql security definer set search_path = public as $$
declare parent_author uuid;
begin
  if new.parent_id is null then return new; end if;
  select user_id into parent_author from public.posts where id = new.parent_id;
  perform public.nook_add_notification(parent_author, new.user_id, 'reply', new.id);
  return new;
end $$;
create or replace function public.nook_notify_like() returns trigger language plpgsql security definer set search_path = public as $$
declare author uuid;
begin
  select user_id into author from public.posts where id = new.post_id;
  perform public.nook_add_notification(author, new.user_id, 'like', new.post_id);
  return new;
end $$;
create or replace function public.nook_notify_repost() returns trigger language plpgsql security definer set search_path = public as $$
declare author uuid;
begin
  select user_id into author from public.posts where id = new.post_id;
  perform public.nook_add_notification(author, new.user_id, 'repost', new.post_id);
  return new;
end $$;
create or replace function public.nook_notify_message() returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.nook_add_notification(new.recipient_id, new.sender_id, 'message', null); return new; end $$;
revoke all on function public.nook_notify_follow(), public.nook_notify_reply(), public.nook_notify_like(), public.nook_notify_repost(), public.nook_notify_message() from public, anon, authenticated;
create or replace trigger nook_notify_follow after insert on public.follows for each row execute function public.nook_notify_follow();
create or replace trigger nook_notify_reply after insert on public.posts for each row execute function public.nook_notify_reply();
create or replace trigger nook_notify_like after insert on public.likes for each row execute function public.nook_notify_like();
create or replace trigger nook_notify_repost after insert on public.reposts for each row execute function public.nook_notify_repost();
create or replace trigger nook_notify_message after insert on public.messages for each row execute function public.nook_notify_message();

-- phone push: every new notification asks the send-push edge function to deliver it
create or replace function public.nook_push_on_notification() returns trigger language plpgsql security definer set search_path = public as $$
declare v_secret text;
begin
  if not exists (select 1 from public.push_subs s where s.user_id = new.user_id) then return new; end if;
  v_secret := public.nook_purge_secret();
  if v_secret is null then return new; end if;
  perform net.http_post(
    url := 'https://cimyolsipjdpibzaebmx.supabase.co/functions/v1/send-push',
    body := jsonb_build_object('notification_id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-purge-secret', v_secret),
    timeout_milliseconds := 10000);
  return new;
exception when others then
  raise warning 'nook_push_on_notification failed: %', sqlerrm;
  return new;
end $$;
revoke all on function public.nook_push_on_notification() from public, anon, authenticated;
create or replace trigger nook_push_on_notification after insert on public.notifications for each row execute function public.nook_push_on_notification();

-- handles: lowercase, unique, never empty, one change per 7 days. the pinned post must be your own top level post
create or replace function public.nook_accounts_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.username := lower(btrim(coalesce(new.username, '')));
    if new.username !~ '^[a-z0-9._]{1,15}$' then raise exception 'invalid_handle' using errcode = '23514'; end if;
    new.handle_changed_at := null;
    new.pinned_post_id := null;
    return new;
  end if;
  if new.username is distinct from old.username then
    new.username := lower(btrim(coalesce(new.username, '')));
    if new.username = '' then raise exception 'handle_required' using errcode = '23514'; end if;
    if new.username !~ '^[a-z0-9._]{1,15}$' then raise exception 'invalid_handle' using errcode = '23514'; end if;
    if new.username <> old.username then
      if auth.uid() is not null and old.handle_changed_at is not null and old.handle_changed_at > now() - interval '7 days' then
        raise exception 'handle_locked:%', ceil(extract(epoch from (old.handle_changed_at + interval '7 days' - now())) / 86400)::int using errcode = '42501';
      end if;
      new.handle_changed_at := now();
    elsif auth.uid() is not null then
      new.handle_changed_at := old.handle_changed_at;
    end if;
  elsif auth.uid() is not null then
    new.handle_changed_at := old.handle_changed_at;
  end if;
  if new.pinned_post_id is not null and new.pinned_post_id is distinct from old.pinned_post_id then
    if not exists (select 1 from public.posts p where p.id = new.pinned_post_id and p.user_id = new.id and p.parent_id is null) then
      raise exception 'invalid_pin' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.nook_accounts_guard() from public, anon, authenticated;
create or replace trigger nook_accounts_guard before insert or update on public.accounts for each row execute function public.nook_accounts_guard();

-- recipients may only mark messages read, never rewrite them
create or replace function public.nook_messages_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and auth.uid() is not null and coalesce(current_setting('nook.msg_edit', true), '') <> '1' then
    if new.sender_id is distinct from old.sender_id or new.recipient_id is distinct from old.recipient_id
       or new.body is distinct from old.body or new.media is distinct from old.media or new.created_at is distinct from old.created_at then
      raise exception 'messages_immutable' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create or replace trigger nook_messages_guard before update on public.messages for each row execute function public.nook_messages_guard();

-- banned users (see nook_on_user_banned) can not write anything while an old login token is still alive
create or replace function public.nook_block_banned() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and exists (select 1 from public.bans b where b.user_id = auth.uid()) then
    raise exception 'banned' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.nook_block_banned() from public, anon, authenticated;
create or replace trigger nook_block_banned before insert on public.posts for each row execute function public.nook_block_banned();
create or replace trigger nook_block_banned before insert on public.messages for each row execute function public.nook_block_banned();
create or replace trigger nook_block_banned before insert on public.follows for each row execute function public.nook_block_banned();
create or replace trigger nook_block_banned before insert on public.likes for each row execute function public.nook_block_banned();
create or replace trigger nook_block_banned before insert on public.reposts for each row execute function public.nook_block_banned();
create or replace trigger nook_block_banned before insert on public.blocks for each row execute function public.nook_block_banned();
create or replace trigger nook_block_banned before insert on public.accounts for each row execute function public.nook_block_banned();

-- remove one photo from one of your own dm messages (deletes the message if nothing is left)
create or replace function public.remove_dm_media(p_msg bigint, p_idx int) returns jsonb
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
revoke all on function public.remove_dm_media(bigint, int) from public, anon;
grant execute on function public.remove_dm_media(bigint, int) to authenticated;

-- blocking removes follows both ways
create or replace function public.nook_drop_follows_on_block() returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.follows
  where (follower_id = new.blocker_id and followee_id = new.blocked_id)
     or (follower_id = new.blocked_id and followee_id = new.blocker_id);
  return new;
end $$;
revoke all on function public.nook_drop_follows_on_block() from public, anon, authenticated;
create or replace trigger nook_drop_follows_on_block after insert on public.blocks for each row execute function public.nook_drop_follows_on_block();

-- storage cleanup: when a row goes away its files go away too (through the purge-media edge function)
create or replace function public.nook_media_paths(v text, p_bucket text) returns text[] language plpgsql immutable set search_path = public as $$
declare arr text[]; res text[] := '{}'; u text; p text;
begin
  if v is null or v = '' then return res; end if;
  begin
    if left(v, 1) = '[' then select array_agg(x) into arr from jsonb_array_elements_text(v::jsonb) x; else arr := array[v]; end if;
  exception when others then arr := array[v];
  end;
  foreach u in array coalesce(arr, '{}') loop
    p := substring(u from '/object/public/' || p_bucket || '/([^?#]+)');
    if p is not null then res := res || p; end if;
  end loop;
  return res;
end $$;
create or replace function public.nook_dm_paths(m jsonb) returns text[] language sql immutable set search_path = public as $$
  select coalesce(array_agg(p), '{}'::text[]) from (
    select substring(e->>'url' from '/object/public/dm-media/([^?#]+)') as p
    from jsonb_array_elements(case when jsonb_typeof(coalesce(m, '[]'::jsonb)) = 'array' then coalesce(m, '[]'::jsonb) else '[]'::jsonb end) e
  ) s where p is not null
$$;
create or replace function public.nook_purge_storage(p_bucket text, p_paths text[], p_user uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_secret text;
begin
  if (p_paths is null or coalesce(array_length(p_paths, 1), 0) = 0) and p_user is null then return; end if;
  v_secret := public.nook_purge_secret();
  if v_secret is null then return; end if;
  perform net.http_post(
    url := 'https://cimyolsipjdpibzaebmx.supabase.co/functions/v1/purge-media',
    body := jsonb_build_object('bucket', p_bucket, 'paths', to_jsonb(coalesce(p_paths, '{}'::text[])), 'user_id', p_user),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-purge-secret', v_secret),
    timeout_milliseconds := 10000);
exception when others then
  raise warning 'nook_purge_storage failed: %', sqlerrm;
end $$;
revoke all on function public.nook_purge_storage(text, text[], uuid) from public, anon, authenticated;

create or replace function public.nook_purge_post_media() returns trigger language plpgsql security definer set search_path = public as $$
declare gone text[];
begin
  if tg_op = 'DELETE' then gone := public.nook_media_paths(old.media_url, 'media');
  else
    if new.media_url is not distinct from old.media_url then return new; end if;
    gone := array(select unnest(public.nook_media_paths(old.media_url, 'media')) except select unnest(public.nook_media_paths(new.media_url, 'media')));
  end if;
  if coalesce(array_length(gone, 1), 0) > 0 then perform public.nook_purge_storage('media', gone); end if;
  return coalesce(new, old);
end $$;
create or replace function public.nook_purge_dm_media() returns trigger language plpgsql security definer set search_path = public as $$
declare gone text[];
begin
  if tg_op = 'DELETE' then gone := public.nook_dm_paths(old.media);
  else
    if new.media is not distinct from old.media then return new; end if;
    gone := array(select unnest(public.nook_dm_paths(old.media)) except select unnest(public.nook_dm_paths(new.media)));
  end if;
  if coalesce(array_length(gone, 1), 0) > 0 then perform public.nook_purge_storage('dm-media', gone); end if;
  return coalesce(new, old);
end $$;
create or replace function public.nook_purge_banner() returns trigger language plpgsql security definer set search_path = public as $$
declare gone text;
begin
  if tg_op = 'UPDATE' and new.banner is not distinct from old.banner then return new; end if;
  gone := substring(old.banner from '/object/public/media/([^?#]+)');
  if gone is not null then perform public.nook_purge_storage('media', array[gone]); end if;
  return coalesce(new, old);
end $$;
revoke all on function public.nook_purge_post_media(), public.nook_purge_dm_media(), public.nook_purge_banner() from public, anon, authenticated;
create or replace trigger nook_purge_post_media_del after delete on public.posts for each row execute function public.nook_purge_post_media();
create or replace trigger nook_purge_post_media_upd after update of media_url on public.posts for each row execute function public.nook_purge_post_media();
create or replace trigger nook_purge_dm_media_del after delete on public.messages for each row execute function public.nook_purge_dm_media();
create or replace trigger nook_purge_dm_media_upd after update of media on public.messages for each row execute function public.nook_purge_dm_media();
create or replace trigger nook_purge_banner_del after delete on public.accounts for each row execute function public.nook_purge_banner();
create or replace trigger nook_purge_banner_upd after update of banner on public.accounts for each row execute function public.nook_purge_banner();

-- the other direction: a file deleted in the supabase storage page disappears from posts and chats
create or replace function public.nook_storage_gone_media() returns trigger language plpgsql security definer set search_path = public as $$
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
  return old;
end $$;
create or replace function public.nook_storage_gone_dm() returns trigger language plpgsql security definer set search_path = public as $$
declare r record; kept jsonb; suffix text;
begin
  if old.bucket_id <> 'dm-media' then return old; end if;
  suffix := '/object/public/dm-media/' || old.name;
  for r in select id, body, media from public.messages where media::text like '%' || old.name || '%' loop
    select coalesce(jsonb_agg(e), '[]'::jsonb) into kept from jsonb_array_elements(r.media) e where right(e ->> 'url', length(suffix)) <> suffix;
    if jsonb_array_length(kept) = jsonb_array_length(r.media) then continue; end if;
    if jsonb_array_length(kept) = 0 and btrim(r.body) = '' then
      delete from public.messages where id = r.id;
    else
      perform set_config('nook.msg_edit', '1', true);
      update public.messages set media = kept where id = r.id;
    end if;
  end loop;
  return old;
end $$;
revoke all on function public.nook_storage_gone_media(), public.nook_storage_gone_dm() from public, anon, authenticated;
create or replace trigger nook_storage_gone_media after delete on storage.objects for each row execute function public.nook_storage_gone_media();
create or replace trigger nook_storage_gone_dm after delete on storage.objects for each row execute function public.nook_storage_gone_dm();

-- deleting your account and banning a user both run through nook_purge_user
create or replace function public.nook_purge_user(p_user uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.accounts where id = p_user;
  perform public.nook_purge_storage('media', null, p_user);
  perform public.nook_purge_storage('dm-media', null, p_user);
end $$;
revoke all on function public.nook_purge_user(uuid) from public, anon, authenticated;
grant execute on function public.nook_purge_user(uuid) to service_role;

-- wipes the caller's data. the login itself is removed by the delete-account edge function
create or replace function public.delete_my_account() returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
  perform public.nook_purge_user(me);
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ban a user from the supabase dashboard (Authentication > Users > Ban user): their data is deleted
-- and the app shows a "you're banned" page. unbanning removes the ban marker.
create or replace function public.nook_on_user_banned() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.banned_until is not null and new.banned_until > now() and (old.banned_until is null or old.banned_until <= now()) then
    insert into public.bans (user_id, email) values (new.id, new.email)
      on conflict (user_id) do update set banned_at = now(), email = excluded.email;
    perform public.nook_purge_user(new.id);
  elsif (new.banned_until is null or new.banned_until <= now()) and old.banned_until is not null and old.banned_until > now() then
    delete from public.bans where user_id = new.id;
  end if;
  return new;
end $$;
revoke all on function public.nook_on_user_banned() from public, anon, authenticated;
create or replace trigger nook_on_user_banned after update of banned_until on auth.users for each row execute function public.nook_on_user_banned();

-- authenticator recovery helper (used by the totp edge function)
create or replace function public.nook_find_user(ident text) returns uuid language sql security definer set search_path = public, auth as $$
  select id from (
    select u.id, 1 as pri from auth.users u where lower(u.email) = lower(btrim(ident))
    union all
    select a.id, 2 as pri from public.accounts a where a.username = lower(btrim(ident))
  ) s order by pri limit 1
$$;
revoke all on function public.nook_find_user(text) from public, anon, authenticated;
grant execute on function public.nook_find_user(text) to service_role;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

notify pgrst, 'reload schema';


-- =====================================================================
-- v2.11.0 changes (already applied on the live project)
-- =====================================================================

-- 30 day backup for banned accounts -----------------------------------
create table if not exists public.ban_archive (
  user_id uuid primary key, email text, username text,
  banned_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  data jsonb not null default '{}'::jsonb);
alter table public.ban_archive enable row level security;
revoke all on public.ban_archive from anon, authenticated;
grant all on public.ban_archive to service_role;
create table if not exists public.ban_attempts (key text primary key, fails int not null default 0, locked_until timestamptz);
alter table public.ban_attempts enable row level security;
revoke all on public.ban_attempts from anon, authenticated;
grant all on public.ban_attempts to service_role;
insert into storage.buckets (id, name, public) values ('ban-archive', 'ban-archive', false) on conflict (id) do nothing;
-- functions: nook_archive_user(uuid) snapshots posts/likes/follows/chats into ban_archive,
-- nook_archive_storage(uuid, drop boolean) asks the purge-media edge function to copy the user's files into ban-archive
-- (or remove them), nook_ban_login(email, password) checks the password for the export with a lock after 5 fails,
-- nook_sweep_archives() removes backups older than 30 days. nook_on_user_banned() calls them (see the function bodies in the project).
-- nightly sweep:
create extension if not exists pg_cron;
select cron.schedule('nook-sweep-ban-archives', '17 3 * * *', $$select public.nook_sweep_archives()$$);
-- edge functions: supabase/functions/ban-export (public, checks email + password) and supabase/functions/purge-media (new archive / drop_archive actions)

-- zenith lives in a table only the owner can touch --------------------
create table if not exists public.app_owner (user_id uuid primary key references public.accounts(id) on delete cascade);
alter table public.app_owner enable row level security;
revoke all on public.app_owner from anon, authenticated;
grant all on public.app_owner to service_role;
create or replace function public.nook_is_owner() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_owner where user_id = auth.uid()) $$;
revoke all on function public.nook_is_owner() from public, anon;
grant execute on function public.nook_is_owner() to authenticated, service_role;
create table if not exists public.zenith_docs (
  owner_id uuid not null references public.accounts(id) on delete cascade,
  kind text not null check (kind in ('state','post','flag','chat')),
  doc_id text not null check (length(doc_id) <= 64),
  data jsonb not null default '{}'::jsonb check (pg_column_size(data) <= 400000),
  updated_at timestamptz not null default now(),
  primary key (owner_id, kind, doc_id));
alter table public.zenith_docs enable row level security;
revoke all on public.zenith_docs from anon;
grant select, insert, update, delete on public.zenith_docs to authenticated;
grant all on public.zenith_docs to service_role;
create policy "zenith owner select" on public.zenith_docs for select to authenticated using (owner_id = (select auth.uid()) and public.nook_is_owner());
create policy "zenith owner insert" on public.zenith_docs for insert to authenticated with check (owner_id = (select auth.uid()) and public.nook_is_owner());
create policy "zenith owner update" on public.zenith_docs for update to authenticated using (owner_id = (select auth.uid()) and public.nook_is_owner()) with check (owner_id = (select auth.uid()) and public.nook_is_owner());
create policy "zenith owner delete" on public.zenith_docs for delete to authenticated using (owner_id = (select auth.uid()) and public.nook_is_owner());
-- add yourself as the owner once:  insert into public.app_owner (user_id) values ('<your account id>');

-- hardening from the pentest ------------------------------------------
update storage.buckets set file_size_limit = 26214400, allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime'] where id = 'media';
update storage.buckets set file_size_limit = 26214400, allowed_mime_types = array['application/octet-stream'] where id = 'dm-media';
update storage.buckets set file_size_limit = 26214400 where id = 'ban-archive';
alter policy "media read" on storage.objects to authenticated using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;
create index if not exists messages_sender_created on public.messages (sender_id, created_at desc);
create index if not exists posts_user_created on public.posts (user_id, created_at desc);
-- nook_media_ok(url, bucket, owner): only files the person uploaded themselves are allowed as media, avatar or banner
-- nook_posts_guard: body <= 5000, media urls checked, 40 posts / 10 min, no replies to people who blocked you
-- nook_messages_insert_guard: body <= 20000, up to 4 media with iv, 60 messages / minute
-- nook_accounts_guard: bio <= 500, display name <= 30, avatar and banner checked (plus the handle rules from 2.10.0)
-- nook_interact_guard: blocked people can not follow, like or repost
alter policy "anyone can read posts" on public.posts to authenticated using ((user_id = (select auth.uid())) or (not exists (select 1 from public.accounts a where a.id = posts.user_id and a.deactivated) and not exists (select 1 from public.blocks b where b.blocker_id = posts.user_id and b.blocked_id = (select auth.uid()))));
alter policy "Enable read access for all users" on public.accounts to authenticated using ((id = (select auth.uid())) or not deactivated);
revoke execute on function public.nook_interact_guard(), public.nook_messages_insert_guard(), public.nook_posts_guard(), public.nook_accounts_guard(), public.nook_messages_guard() from public, anon, authenticated;
notify pgrst, 'reload schema';

-- ---- function bodies for v2.11.0 ----
create or replace function public.nook_media_ok(p_url text, p_bucket text, p_owner uuid) returns boolean
language sql immutable set search_path = public as $$
  select p_url is not null
     and p_url like 'https://cimyolsipjdpibzaebmx.supabase.co/storage/v1/object/public/' || p_bucket || '/' || p_owner::text || '/%'
     and length(p_url) <= 400
     and p_url !~ '[[:space:]"''<>\\]'
     and position('..' in p_url) = 0
$$;

create or replace function public.nook_purge_storage(p_bucket text, p_paths text[], p_user uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_secret text;
begin
  if (p_paths is null or coalesce(array_length(p_paths, 1), 0) = 0) and p_user is null then return; end if;
  -- while an account is being archived (ban) its files are copied first, never deleted one by one
  if p_user is null and current_setting('nook.keep_media', true) = '1' then return; end if;
  v_secret := public.nook_purge_secret();
  if v_secret is null then return; end if;
  perform net.http_post(
    url := 'https://cimyolsipjdpibzaebmx.supabase.co/functions/v1/purge-media',
    body := jsonb_build_object('bucket', p_bucket, 'paths', to_jsonb(coalesce(p_paths, '{}'::text[])), 'user_id', p_user),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-purge-secret', v_secret),
    timeout_milliseconds := 10000);
exception when others then
  raise warning 'nook_purge_storage failed: %', sqlerrm;
end $$;

create or replace function public.nook_archive_storage(p_user uuid, p_drop boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare v_secret text;
begin
  v_secret := public.nook_purge_secret();
  if v_secret is null then return; end if;
  perform net.http_post(
    url := 'https://cimyolsipjdpibzaebmx.supabase.co/functions/v1/purge-media',
    body := jsonb_build_object('action', case when p_drop then 'drop_archive' else 'archive' end, 'user_id', p_user),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-purge-secret', v_secret),
    timeout_milliseconds := 10000);
exception when others then
  raise warning 'nook_archive_storage failed: %', sqlerrm;
end $$;

create or replace function public.nook_archive_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_data jsonb; v_email text; v_name text;
begin
  select email into v_email from auth.users where id = p_user;
  select username into v_name from public.accounts where id = p_user;
  v_data := jsonb_build_object(
    'app', 'nook', 'archived_at', now(),
    'account', (select to_jsonb(a) - 'pinned_post_id' from public.accounts a where a.id = p_user),
    'email', v_email,
    'posts', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'text', p.body, 'media_url', p.media_url, 'media_type', p.media_type, 'reply_to', p.parent_id, 'created_at', p.created_at) order by p.created_at) from public.posts p where p.user_id = p_user), '[]'::jsonb),
    'likes', coalesce((select jsonb_agg(l.post_id) from public.likes l where l.user_id = p_user), '[]'::jsonb),
    'reposts', coalesce((select jsonb_agg(r.post_id) from public.reposts r where r.user_id = p_user), '[]'::jsonb),
    'following', coalesce((select jsonb_agg(a.username) from public.follows f join public.accounts a on a.id = f.followee_id where f.follower_id = p_user), '[]'::jsonb),
    'followers', coalesce((select jsonb_agg(a.username) from public.follows f join public.accounts a on a.id = f.follower_id where f.followee_id = p_user), '[]'::jsonb),
    'nicknames', coalesce((select jsonb_agg(jsonb_build_object('person', a.username, 'nickname', n.nickname)) from public.nicknames n join public.accounts a on a.id = n.target_id where n.owner_id = p_user), '[]'::jsonb),
    'chats', coalesce((
      select jsonb_agg(jsonb_build_object(
        'person', a.username, 'display_name', a.display_name, 'peer_public_key', a.public_key,
        'messages', (select jsonb_agg(jsonb_build_object('id', m.id, 'from_me', m.sender_id = p_user, 'text', m.body, 'media', m.media, 'created_at', m.created_at) order by m.created_at)
                     from public.messages m
                     where ((m.sender_id = p_user and m.recipient_id = a.id) or (m.sender_id = a.id and m.recipient_id = p_user))
                       and m.created_at > coalesce((select c.cleared_at from public.chat_clears c where c.user_id = p_user and c.other_id = a.id), '-infinity'::timestamptz))))
      from public.accounts a
      where a.id in (select case when sender_id = p_user then recipient_id else sender_id end from public.messages where sender_id = p_user or recipient_id = p_user)), '[]'::jsonb));
  insert into public.ban_archive (user_id, email, username, banned_at, expires_at, data)
  values (p_user, v_email, v_name, now(), now() + interval '30 days', v_data)
  on conflict (user_id) do update set email = excluded.email, username = excluded.username, banned_at = excluded.banned_at, expires_at = excluded.expires_at, data = excluded.data;
end $$;

create or replace function public.nook_drop_ban_row(p_user uuid) returns void language sql security definer set search_path = public as $$ delete from public.bans where user_id = p_user $$;
create or replace function public.nook_purge_user_rows(p_user uuid) returns void language sql security definer set search_path = public as $$ delete from public.accounts where id = p_user $$;
create or replace function public.nook_drop_expired_archives() returns void language sql security definer set search_path = public as $$ delete from public.ban_archive where expires_at <= now() $$;
create or replace function public.nook_sweep_archives() returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select user_id from public.ban_archive where expires_at <= now() loop
    perform public.nook_archive_storage(r.user_id, true);
    n := n + 1;
  end loop;
  perform public.nook_drop_expired_archives();
  return n;
end $$;

create or replace function public.nook_on_user_banned() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.banned_until is not null and new.banned_until > now() and (old.banned_until is null or old.banned_until <= now()) then
    insert into public.bans (user_id, email) values (new.id, new.email)
      on conflict (user_id) do update set banned_at = now(), email = excluded.email;
    perform public.nook_archive_user(new.id);
    perform set_config('nook.keep_media', '1', true);
    perform public.nook_archive_storage(new.id);
    perform public.nook_purge_user_rows(new.id);
  elsif (new.banned_until is null or new.banned_until <= now()) and old.banned_until is not null and old.banned_until > now() then
    perform public.nook_drop_ban_row(new.id);
  end if;
  return new;
end $$;

create or replace function public.nook_ban_login(p_email text, p_password text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare v_key text := lower(btrim(coalesce(p_email, ''))); v_id uuid; v_hash text; v_locked timestamptz; v_good boolean;
begin
  if v_key = '' or p_password is null or p_password = '' or length(p_password) > 200 then return null; end if;
  select locked_until into v_locked from public.ban_attempts where key = v_key;
  if v_locked is not null and v_locked > now() then raise exception 'locked'; end if;
  select u.id, u.encrypted_password into v_id, v_hash
    from auth.users u join public.ban_archive a on a.user_id = u.id
   where lower(u.email) = v_key and a.expires_at > now() limit 1;
  if v_hash is null then v_hash := crypt('nook-dummy', gen_salt('bf', 10)); v_id := null; end if;
  v_good := (crypt(p_password, v_hash) = v_hash) and v_id is not null;
  if v_good then
    update public.ban_attempts set fails = 0, locked_until = null where key = v_key;
    return v_id;
  end if;
  insert into public.ban_attempts as t (key, fails) values (v_key, 1)
    on conflict (key) do update set
      fails = case when t.locked_until is not null and t.locked_until <= now() then 1 else t.fails + 1 end,
      locked_until = case when (case when t.locked_until is not null and t.locked_until <= now() then 1 else t.fails + 1 end) >= 5 then now() + interval '15 minutes' else null end;
  return null;
end $$;
revoke all on function public.nook_ban_login(text, text), public.nook_archive_user(uuid), public.nook_archive_storage(uuid, boolean), public.nook_sweep_archives(), public.nook_drop_expired_archives(), public.nook_drop_ban_row(uuid), public.nook_purge_user_rows(uuid) from public, anon, authenticated;
grant execute on function public.nook_ban_login(text, text), public.nook_sweep_archives() to service_role;

create or replace function public.nook_posts_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare v_url text; arr jsonb; v_author uuid;
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
create or replace trigger nook_posts_guard before insert or update on public.posts for each row execute function public.nook_posts_guard();

create or replace function public.nook_messages_insert_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare e jsonb;
begin
  if auth.uid() is null then return new; end if;
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
end $$;
create or replace trigger nook_messages_insert_guard before insert on public.messages for each row execute function public.nook_messages_insert_guard();

create or replace function public.nook_interact_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare v_target uuid;
begin
  if auth.uid() is null then return new; end if;
  if tg_table_name = 'follows' then v_target := new.followee_id;
  else select user_id into v_target from public.posts where id = new.post_id; end if;
  if v_target is not null and exists (select 1 from public.blocks b where b.blocker_id = v_target and b.blocked_id = auth.uid()) then
    raise exception 'blocked' using errcode = '42501';
  end if;
  return new;
end $$;
create or replace trigger nook_interact_guard before insert on public.follows for each row execute function public.nook_interact_guard();
create or replace trigger nook_interact_guard before insert on public.likes for each row execute function public.nook_interact_guard();
create or replace trigger nook_interact_guard before insert on public.reposts for each row execute function public.nook_interact_guard();
-- nook_accounts_guard: same as 2.10.0 plus these checks at the top:
--   bio <= 500, display_name <= 30, banner_theme <= 20,
--   avatar must be a small data:image (<= 200000 chars) or the person's own file in the media bucket,
--   banner must be the person's own file in the media bucket


-- v2.13.0: AI check for posts, reports, warnings
-- posts.mod_status: 'pending' until the moderate edge function says it is safe (only the owner sees pending posts)
alter table public.posts add column if not exists mod_status text not null default 'safe';
alter table public.posts add constraint posts_mod_status_chk check (mod_status in ('pending','safe'));
-- mod_notices: a warning shown to the owner when a post was removed (realtime)
-- reports: one row per reporter and post; two reports send a post back to the AI check
-- functions nook_posts_guard (forces pending on media posts), nook_moderate_kick, nook_moderate_sweep (cron every minute),
-- nook_report_guard, nook_report_after; policy "anyone can read posts" only shows mod_status = 'safe' to other people
-- edge function: supabase/functions/moderate (needs the secret ZENITH_PASSWORD, the same password as in Settings > Zenith)
-- edge function: supabase/functions/zenith (owner only, adds ZENITH_PASSWORD on the server so the password never sits on a device)

-- v2.13.2: delete a chat for both people
-- create function public.delete_chat(p_other uuid): deletes every message between the caller and p_other (media is purged by trigger); execute granted to authenticated only

-- v2.13.3: AI check for profile photos and banners
-- accounts.avatar_mod / banner_mod ('pending' until the moderate function says safe), trigger nook_accounts_mod (forces pending on change),
-- nook_accounts_kick (calls moderate with account_id), nook_moderate_sweep also looks at pending profile pictures

-- v2.13.5: sexual reports only on posts with media; every report after the second on a media post sends it back to the AI check

-- v2.13.6: looser AI rules (only exposed genitals or anus), faster checks (files checked in parallel, lazy gif code, cron every 20 seconds, keep-warm ping when nothing is pending)

-- v2.13.7: owner reports page: functions owner_reports(), owner_dismiss_reports(uuid), owner_delete_post(uuid) (security definer, owner only, execute for authenticated)

-- v2.13.8: view public.reports_readable (security invoker, no api access) to read reports with the post text in the dashboard

-- v2.13.11: mod_notices.note (why the AI removed something), one warning even when two checks run at once

-- v2.15.0: text posts are read by the AI too. posts.text_pending is set by nook_posts_guard when the text is new or changed,
-- the moderate function clears it or deletes the post with a mod_notices row of kind 'rules'. Text posts stay visible meanwhile.
-- alter table public.posts add column text_pending boolean not null default false;
-- nook_posts_guard, nook_report_after and nook_moderate_sweep were updated, and nook_moderate_kick_ins/_upd also fire when new.text_pending.

-- v2.15.2: username, display name and bio are read by the AI too. accounts.text_pending is set by nook_accounts_mod when one changes,
-- the moderate function clears a bad one (bio and name become empty, a username becomes user + random letters) and adds a mod_notices row of kind bio, name or username.
-- alter table public.accounts add column text_pending boolean not null default false;

-- v2.17.0: age gate. accounts.age_hold / age_verified (clients cannot change them, nook_accounts_mod resets them).
-- The moderate function answers MINOR when someone says they are under 18, deletes the post and sets age_hold; nook_block_banned then refuses every write with 'age_hold'.
-- The age function takes a date of birth: 18 or older clears the hold, anything else bans the account (data stays 30 days for download).
-- alter table public.accounts add column age_hold boolean not null default false, add column age_verified boolean not null default false;
-- age_session and age_fails columns exist from an earlier try and are unused. nook_archive_user leaves the internal moderation columns out of the download.

-- v2.17.3: reports_reason_check now allows every reason the report sheet offers (sexual, harassment, hate, threats, selfharm, illegal, private, impersonation, spam, other).
-- Pictures and videos can now also be judged MINOR (an age below 18 written or said in them). Birth dates sent to the age function are never stored, only age_hold and age_verified.

-- v3.0.0: videos are gone. storage bucket media only allows image/jpeg, image/png, image/webp and image/gif.
-- nook_report_after sends a post to the AI after 2 reports, or after 1 report for threats and selfharm.

-- v3.0.3: nook_clean_logs (cron job nook-clean-logs, daily 03:43 UTC) deletes cron run details, pg_net responses, seen mod_notices, old ban_attempts locks and auth audit entries older than 7 days.
-- nook_purge_avatar (trigger on accounts.avatar) removes the old gif avatar file from storage when the avatar changes.

-- v3.0.4 security hardening (from a review round):
-- nook_totp_attempt / nook_totp_claim: every authenticator try is counted in one atomic step and a code can be used by one request only (service_role only).
-- nook_posts_guard: clients cannot set created_at, user_id or parent_id on update; created_at is always now() on insert.
-- moderate function: file type is read from the bytes, gif checks up to six frames, picture text is marked untrusted, edits made while the AI reads keep the post pending,
-- a text the AI service refuses to read counts as a rule break.

-- v3.0.6 (second review round):
-- age_holds(email_hash): the age lock follows a hashed email, set and cleared by trigger nook_age_hold_sync_t on accounts.age_hold; nook_accounts_mod copies it onto a new account with the same email.
-- nook_block_banned also runs before update on posts and accounts, so held and banned accounts cannot edit.
-- accounts: unique index accounts_username_norm (lowercase, no dots or underscores); nook_accounts_guard refuses reserved handles (zenith, nook, admin, owner, ...).
-- accounts select is limited to public columns for signed-in users (id, username, display_name, bio, avatar, banner, banner_theme, public_key, deactivated, handle_changed_at, pinned_post_id, created_at);
-- the client reads its own lock with the my_age_hold() function. Moderation columns (avatar_mod, banner_mod, text_pending, age_*) are only visible to the service role.

-- v3.1.0: discover_accounts(p_seed, p_n) gives a repeatable random mix of people (same seed = same people, up to 24), search_accounts(p_q) finds people by username start or display name (2 to 30 characters, up to 20).
-- Both skip yourself, blocked people either way, deactivated, locked and banned accounts; discover also skips people you already follow. Only signed-in users can call them.

-- v3.2.0: no database change. Links lose their query part in the client (cleanUrl), sharing a post makes a picture (Post, Message or another app), there are no post links.
