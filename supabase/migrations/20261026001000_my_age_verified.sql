-- Lets the app know once that this account passed the age check, so it never has to ask about an age hold again.
create or replace function public.my_age_verified() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select age_verified from public.accounts where id = auth.uid()), false)
$$;
revoke all on function public.my_age_verified() from public, anon;
grant execute on function public.my_age_verified() to authenticated;
