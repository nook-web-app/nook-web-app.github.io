-- performance: indexes for the moderation sweep, notification dedupe and nightly jobs; skip the reply cleanup when a post has no replies
do $$ begin
  if exists (select 1 from pg_attribute where attrelid = to_regclass('public.posts') and attname = 'mod_status' and not attisdropped) then
    create index if not exists posts_mod_pending_idx on public.posts (created_at) where mod_status = 'pending';
  end if;
  if exists (select 1 from pg_attribute where attrelid = to_regclass('public.posts') and attname = 'text_pending' and not attisdropped) then
    create index if not exists posts_text_pending_idx on public.posts (created_at) where text_pending;
  end if;
  if exists (select 1 from pg_attribute where attrelid = to_regclass('public.accounts') and attname = 'text_pending' and not attisdropped) then
    create index if not exists accounts_text_pending_idx on public.accounts (id) where text_pending;
  end if;
  if exists (select 1 from pg_attribute where attrelid = to_regclass('public.accounts') and attname = 'avatar_mod' and not attisdropped) then
    create index if not exists accounts_avatar_pending_idx on public.accounts (id) where avatar_mod = 'pending';
  end if;
  if exists (select 1 from pg_attribute where attrelid = to_regclass('public.accounts') and attname = 'banner_mod' and not attisdropped) then
    create index if not exists accounts_banner_pending_idx on public.accounts (id) where banner_mod = 'pending';
  end if;
  if exists (select 1 from pg_attribute where attrelid = to_regclass('public.accounts') and attname = 'delete_after' and not attisdropped) then
    create index if not exists accounts_delete_after_idx on public.accounts (delete_after) where delete_after is not null;
  end if;
  if to_regclass('public.notifications') is not null then
    create index if not exists notifications_dedupe_idx on public.notifications (user_id, actor_id, kind) where read_at is null;
  end if;
  if to_regclass('public.notes_self') is not null then
    create index if not exists notes_self_deleted_idx on public.notes_self (updated_at) where deleted;
  end if;
end $$;

create or replace function public.nook_drop_replies()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.posts where parent_id = old.id) then return old; end if;
  delete from public.likes where post_id in (select id from public.posts where parent_id = old.id);
  delete from public.reposts where post_id in (select id from public.posts where parent_id = old.id);
  delete from public.posts where parent_id = old.id;
  return old;
end $$;
