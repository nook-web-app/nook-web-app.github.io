-- one or two posts taken down by Aegis only give a warning; the 6 hour pause starts with the third one
-- (3rd: 6 hours, 4th: 24 hours, 5th: 72 hours, 6th: 7 days, 7th: 14 days, 8th: ban)
-- text-only takedowns are flagged text_only and never count as a strike
alter table public.mod_notices add column if not exists text_only boolean not null default false;

create or replace function public.nook_strike_on_notice() returns trigger language plpgsql security definer set search_path = public, auth as $$
declare mail text; k text; n int; hrs int[] := array[6, 24, 72, 168, 336];
begin
  select email into mail from auth.users where id = new.user_id;
  if mail is null then return new; end if;
  k := public.nook_email_key(mail);
  insert into public.post_strikes (email_key, strikes) values (k, 1)
    on conflict (email_key) do update set strikes = public.post_strikes.strikes + 1, updated_at = now()
    returning strikes into n;
  if n >= 8 then
    update auth.users set banned_until = now() + interval '100 years' where id = new.user_id;
  elsif n >= 3 then
    update public.post_strikes set locked_until = now() + make_interval(hours => hrs[n - 2]) where email_key = k;
  end if;
  return new;
end $$;
revoke all on function public.nook_strike_on_notice() from public, anon, authenticated;
drop trigger if exists nook_strike_on_notice_t on public.mod_notices;
create trigger nook_strike_on_notice_t after insert on public.mod_notices
  for each row when (new.post_id is not null and new.kind in ('rules', 'sexual') and not new.text_only)
  execute function public.nook_strike_on_notice();

-- people holding only one or two strikes lose the pause they got under the old rules
update public.post_strikes set locked_until = null where strikes < 3 and locked_until is not null;
