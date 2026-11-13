-- How many requests each Gemini model was asked for today, kept in the database so the limit holds however many copies of the
-- edge functions run at once. A day is a day in Pacific time: that is when Google starts its daily count again.
create table if not exists public.ai_usage (
  model text not null,
  day date not null,
  n int not null default 0,
  primary key (model, day)
);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;

-- gives out up to p_want requests of today's limit and returns how many were granted (0 when the model is used up for today)
create or replace function public.nook_ai_use(p_model text, p_limit int, p_want int default 1) returns int
language plpgsql security definer set search_path = public as $$
declare
  d date := (now() at time zone 'America/Los_Angeles')::date;
  cur int;
  got int;
begin
  insert into public.ai_usage (model, day, n) values (p_model, d, 0) on conflict do nothing;
  select n into cur from public.ai_usage where model = p_model and day = d for update;
  got := greatest(0, least(coalesce(p_want, 1), p_limit - cur));
  if got > 0 then update public.ai_usage set n = n + got where model = p_model and day = d; end if;
  delete from public.ai_usage where day < d - 7;
  return got;
end $$;

-- Google itself said the day's limit is reached (another user of the same key may have used some): the model counts as used up until the reset
create or replace function public.nook_ai_full(p_model text, p_limit int) returns void
language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'America/Los_Angeles')::date;
begin
  insert into public.ai_usage (model, day, n) values (p_model, d, p_limit)
  on conflict (model, day) do update set n = greatest(public.ai_usage.n, p_limit);
end $$;

revoke all on function public.nook_ai_use(text, int, int) from public, anon, authenticated;
revoke all on function public.nook_ai_full(text, int) from public, anon, authenticated;
grant execute on function public.nook_ai_use(text, int, int) to service_role;
grant execute on function public.nook_ai_full(text, int) to service_role;
