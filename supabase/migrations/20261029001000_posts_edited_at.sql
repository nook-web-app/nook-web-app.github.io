-- when the words of a post were last changed by its author (removing or adding photos does not count): shown as "Edited"
alter table public.posts add column if not exists edited_at timestamptz;

create or replace function public.nook_posts_edited()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  -- only the server decides it: an author can never set or clear it by hand
  if tg_op = 'INSERT' then
    new.edited_at := null;
  elsif coalesce(current_setting('nook.mod', true), '') = '1' or auth.uid() is null then
    new.edited_at := old.edited_at;
  elsif new.body is distinct from old.body then
    new.edited_at := now();
  else
    new.edited_at := old.edited_at;
  end if;
  return new;
end $$;

drop trigger if exists nook_posts_edited_t on public.posts;
create trigger nook_posts_edited_t before insert or update on public.posts for each row execute function public.nook_posts_edited();

create or replace view public.posts_feed with (security_invoker = true) as
 select id, user_id, body, created_at, parent_id,
    case when pg_column_size(media_url) > 4000 then null::text else media_url end as media_url,
    pg_column_size(media_url) > 4000 as media_inline,
    edited_at
   from public.posts;

grant select (edited_at) on public.posts to authenticated;
grant select on public.posts_feed to authenticated;
