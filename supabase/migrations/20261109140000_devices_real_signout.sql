-- Signing a device out now ends its login on the server, instead of only asking that device to leave.
-- Each device row remembers the login session that last wrote it (taken from the caller's token, never from what the
-- caller sends). Marking a row revoked, or deleting it, deletes that session: its refresh stops working at once and its
-- access token runs out by itself (an hour at most). A revoked row cannot be set back by an app.
alter table public.devices add column if not exists session_id uuid;

create or replace function public.nook_devices_guard() returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare v_sid uuid;
begin
  -- the server's own work (the cascade of a deleted account, maintenance) passes untouched
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  begin
    v_sid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when others then v_sid := null;
  end;
  if tg_op = 'INSERT' then
    new.session_id := v_sid;
    new.revoked := false;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.session_id is not null then delete from auth.sessions where id = old.session_id and user_id = old.user_id; end if;
    return old;
  end if;
  new.user_id := old.user_id;
  new.device_id := old.device_id;
  new.created_at := old.created_at;
  if old.revoked then
    -- stays revoked, and keeps pointing at nothing
    new.revoked := true;
    new.session_id := old.session_id;
  elsif new.revoked then
    if old.session_id is not null then delete from auth.sessions where id = old.session_id and user_id = old.user_id; end if;
    new.session_id := old.session_id;
  else
    -- the device checking in: the row follows the login that wrote it
    new.session_id := v_sid;
  end if;
  return new;
end $$;
revoke all on function public.nook_devices_guard() from public, anon, authenticated;

drop trigger if exists nook_devices_guard_t on public.devices;
create trigger nook_devices_guard_t before insert or update or delete on public.devices
  for each row execute function public.nook_devices_guard();

-- trigger functions and the upload counter are not for callers without a login
revoke execute on function public.nook_drop_replies() from public, anon, authenticated;
revoke execute on function public.nook_notes_cap() from public, anon, authenticated;
revoke execute on function public.nook_notify_post() from public, anon, authenticated;
revoke execute on function public.nook_posts_edited() from public, anon, authenticated;
revoke execute on function public.nook_upload_count(text) from public, anon;
grant execute on function public.nook_upload_count(text) to authenticated;
