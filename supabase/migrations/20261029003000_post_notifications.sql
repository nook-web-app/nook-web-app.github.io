-- a new post of somebody gives each person who follows them a notification that opens the post
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in ('follow', 'reply', 'message', 'like', 'repost', 'post'));

create or replace function public.nook_notify_post()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  -- replies already notify the author of the post they answer
  if new.parent_id is not null then return new; end if;
  -- a post is only announced once everybody can see it, and once only: not for a post that is still being checked, and
  -- not again when a changed post is checked again
  if new.mod_status <> 'safe' or coalesce(new.text_pending, false) or new.edited_at is not null then return new; end if;
  if tg_op = 'UPDATE' and not (old.mod_status <> 'safe' or coalesce(old.text_pending, false)) then return new; end if;
  insert into public.notifications (user_id, actor_id, kind, post_id)
  select f.follower_id, new.user_id, 'post', new.id
    from public.follows f
   where f.followee_id = new.user_id
     and f.follower_id <> new.user_id
     and not exists (select 1 from public.blocks b where (b.blocker_id = f.follower_id and b.blocked_id = new.user_id) or (b.blocker_id = new.user_id and b.blocked_id = f.follower_id))
     and not exists (select 1 from public.mutes m where m.muter_id = f.follower_id and m.muted_id = new.user_id);
  return new;
end $$;

drop trigger if exists nook_notify_post_ins on public.posts;
create trigger nook_notify_post_ins after insert on public.posts for each row execute function public.nook_notify_post();
drop trigger if exists nook_notify_post_upd on public.posts;
create trigger nook_notify_post_upd after update of mod_status, text_pending on public.posts for each row execute function public.nook_notify_post();
