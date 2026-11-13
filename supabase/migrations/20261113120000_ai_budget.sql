-- A spending limit for the AI checks: nook_ai_take hands out calls from a budget that starts again every 12 hours
-- (the windows are 00:00-12:00 and 12:00-24:00 UTC). The moderate function asks for a few calls at a time and stops asking the
-- AI when the budget is used up, so a retry loop can never again use thousands of requests in a day.
create table if not exists public.ai_budget (
  name text not null,
  bucket timestamptz not null,
  n int not null default 0,
  primary key (name, bucket)
);
alter table public.ai_budget enable row level security;
revoke all on public.ai_budget from anon, authenticated;

-- returns how many of the wanted calls were granted (0 when the budget of this 12 hours is used up)
create or replace function public.nook_ai_take(p_name text, p_max int, p_want int default 1) returns int
language plpgsql security definer set search_path = public as $$
declare
  b timestamptz := to_timestamp(floor(extract(epoch from now()) / 43200) * 43200);
  cur int;
  got int;
begin
  insert into public.ai_budget (name, bucket, n) values (p_name, b, 0) on conflict do nothing;
  select n into cur from public.ai_budget where name = p_name and bucket = b for update;
  got := greatest(0, least(coalesce(p_want, 1), p_max - cur));
  if got > 0 then update public.ai_budget set n = n + got where name = p_name and bucket = b; end if;
  delete from public.ai_budget where bucket < b - interval '3 days';
  return got;
end $$;
revoke all on function public.nook_ai_take(text, int, int) from public, anon, authenticated;
grant execute on function public.nook_ai_take(text, int, int) to service_role;
