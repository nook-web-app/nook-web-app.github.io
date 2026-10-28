-- the owner of the app can take down anything Zenith posts in public (his replies and the replies under them go with it);
-- nobody else can call this, and it only ever touches posts written by the zenith account
create or replace function public.nook_owner_delete_zenith_post(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  if not exists (select 1 from public.app_owner where user_id = (select auth.uid())) then return false; end if;
  delete from public.posts p
    where p.id = p_id
      and exists (select 1 from public.accounts a where a.id = p.user_id and a.username = 'zenith');
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function public.nook_owner_delete_zenith_post(uuid) from public, anon;
grant execute on function public.nook_owner_delete_zenith_post(uuid) to authenticated;
