-- audit fixes 8 (idempotent)

-- phone push: an account with only an Android token (no web push subscription) now gets its push too
create or replace function public.nook_push_on_notification() returns trigger language plpgsql security definer set search_path = public as $$
declare v_secret text;
begin
  if not exists (select 1 from public.push_subs s where s.user_id = new.user_id)
     and not exists (select 1 from public.fcm_tokens t where t.user_id = new.user_id) then return new; end if;
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

-- 20261027005000_speed_indexes.sql drops this partial index and nothing else creates its twin, so make sure one exists
create index if not exists posts_mod_pending_idx on public.posts (created_at) where mod_status = 'pending';
