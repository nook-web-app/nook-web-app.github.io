-- phone push for the Android app: one row per phone (Firebase Cloud Messaging token), sent by the send-push function
create table if not exists public.fcm_tokens (
  token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists fcm_tokens_user on public.fcm_tokens (user_id);
alter table public.fcm_tokens enable row level security;

drop policy if exists fcm_own_select on public.fcm_tokens;
drop policy if exists fcm_own_insert on public.fcm_tokens;
drop policy if exists fcm_own_delete on public.fcm_tokens;
create policy fcm_own_select on public.fcm_tokens for select to authenticated using (user_id = (select auth.uid()));
create policy fcm_own_insert on public.fcm_tokens for insert to authenticated with check (user_id = (select auth.uid()));
create policy fcm_own_delete on public.fcm_tokens for delete to authenticated using (user_id = (select auth.uid()));

-- a phone moves to the account that is signed in on it now
create or replace function public.nook_register_fcm(p_token text)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null or coalesce(length(p_token), 0) < 20 or length(p_token) > 400 then return; end if;
  insert into public.fcm_tokens (token, user_id) values (p_token, auth.uid())
  on conflict (token) do update set user_id = excluded.user_id, created_at = now();
  -- no more than 5 phones per account
  delete from public.fcm_tokens where user_id = auth.uid() and token not in (
    select token from public.fcm_tokens where user_id = auth.uid() order by created_at desc limit 5);
end $$;
revoke all on function public.nook_register_fcm(text) from public, anon;
grant execute on function public.nook_register_fcm(text) to authenticated;
