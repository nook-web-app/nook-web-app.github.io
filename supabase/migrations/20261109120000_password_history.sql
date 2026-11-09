-- password history: a new password cannot be one used before, and a password can be changed once a week.
-- Only the signin function (service role) reads or writes it; what is kept is a salted hash of the server-mixed password.
create table if not exists public.password_history (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  h text not null,
  kind text not null default 'change',
  created_at timestamptz not null default now()
);
create index if not exists password_history_user on public.password_history (user_id, created_at desc);
alter table public.password_history enable row level security;
revoke all on public.password_history from anon, authenticated;

create or replace function public.nook_pw_check(p_user uuid, p_mixed text, p_week boolean)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare last_at timestamptz;
begin
  if exists (select 1 from public.password_history where user_id = p_user and crypt(p_mixed, h) = h) then return 'reused'; end if;
  if p_week then
    select max(created_at) into last_at from public.password_history where user_id = p_user and kind = 'change';
    if last_at is not null and last_at > now() - interval '7 days' then return 'week:' || to_char(last_at + interval '7 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'); end if;
  end if;
  return 'ok';
end $$;

create or replace function public.nook_pw_add(p_user uuid, p_mixed text, p_kind text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if exists (select 1 from public.password_history where user_id = p_user and crypt(p_mixed, h) = h) then return; end if;
  insert into public.password_history (user_id, h, kind) values (p_user, crypt(p_mixed, gen_salt('bf')), p_kind);
end $$;

revoke all on function public.nook_pw_check(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.nook_pw_add(uuid, text, text) from public, anon, authenticated;
grant execute on function public.nook_pw_check(uuid, text, boolean) to service_role;
grant execute on function public.nook_pw_add(uuid, text, text) to service_role;
