-- Deleting an account keeps it hidden for 30 days. Signing in again in that time brings it back; after that it is deleted for good.

alter table public.accounts add column if not exists delete_after timestamptz;

-- called by the delete-account edge function (service role only)
create or replace function public.nook_schedule_delete_user(p_user uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  update public.accounts set deactivated = true, delete_after = now() + interval '30 days' where id = p_user;
  delete from public.push_subs where user_id = p_user;
end $$;
revoke all on function public.nook_schedule_delete_user(uuid) from public, anon, authenticated;
grant execute on function public.nook_schedule_delete_user(uuid) to service_role;

-- signing in brings a deleted account back; true when there was a deletion to cancel
create or replace function public.nook_restore_account() returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.accounts set deactivated = false, delete_after = null where id = auth.uid() and delete_after is not null;
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function public.nook_restore_account() from public, anon;
grant execute on function public.nook_restore_account() to authenticated;

-- waking an account up by any route also cancels a pending deletion
create or replace function public.set_my_deactivated(flag boolean) returns void language sql security definer set search_path = public as $$
  update public.accounts set deactivated = flag, delete_after = case when flag then delete_after else null end where id = auth.uid();
$$;

-- every night the accounts whose 30 days are over are deleted for good
create or replace function public.nook_purge_deleted() returns int language plpgsql security definer set search_path = public, auth as $$
declare r record; n int := 0;
begin
  for r in select id from public.accounts where delete_after is not null and delete_after < now() limit 200 loop
    perform public.nook_purge_user(r.id);
    delete from auth.users where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.nook_purge_deleted() from public, anon, authenticated;
select cron.schedule('nook-purge-deleted', '23 3 * * *', $$select public.nook_purge_deleted()$$);
