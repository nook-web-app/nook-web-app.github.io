-- a profile photo is a data address of tens of kilobytes and cannot be compared inside the address of a request:
-- the moderation function sends the checksum of what it checked and this function applies the verdict only if the photo is still that one
create or replace function public.nook_mod_profile(p_id uuid, p_field text, p_md5 text, p_clear boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  if p_field = 'avatar' then
    update public.accounts set avatar_mod = 'safe', avatar = case when p_clear then null else avatar end
      where id = p_id and avatar_mod = 'pending' and coalesce(md5(avatar), '') = coalesce(p_md5, '');
  elsif p_field = 'banner' then
    update public.accounts set banner_mod = 'safe', banner = case when p_clear then null else banner end
      where id = p_id and banner_mod = 'pending' and coalesce(md5(banner), '') = coalesce(p_md5, '');
  else
    return false;
  end if;
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function public.nook_mod_profile(uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.nook_mod_profile(uuid, text, text, boolean) to service_role;
