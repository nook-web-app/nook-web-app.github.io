-- Finds the account that belongs to an email address (same person rules as the strikes: no +tag, no dots for gmail).
-- Used by the moderation function to warn someone when their email was written in a post that was removed.
create or replace function public.nook_user_by_email(p_email text) returns uuid language sql security definer set search_path = public, auth as $$
  select id from auth.users where public.nook_email_key(email) = public.nook_email_key(p_email) limit 1
$$;
revoke all on function public.nook_user_by_email(text) from public, anon, authenticated;
grant execute on function public.nook_user_by_email(text) to service_role;
