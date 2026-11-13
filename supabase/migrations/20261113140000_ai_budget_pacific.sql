-- The 12 hours of the AI budget are now the two halves of a Pacific time day (00:00-12:00 and 12:00-24:00), so the second half ends exactly when
-- Google's own daily count starts again. Before, they were the halves of a UTC day.
create or replace function public.nook_ai_take(p_name text, p_max int, p_want int default 1) returns int
language plpgsql security definer set search_path = public as $$
declare
  pt timestamp := now() at time zone 'America/Los_Angeles';
  b timestamptz := (date_trunc('day', pt) + ((extract(hour from pt)::int / 12) * 12) * interval '1 hour') at time zone 'America/Los_Angeles';
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
