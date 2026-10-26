-- second pass (idempotent, guarded)
-- 1. nook_post_chain: a post and its ancestors in one query (zenith-tick used one request per ancestor)
-- 2. email rehash made deterministic: each table is rehashed exactly once, after the functions that look it up use the hmac chain
-- 3. media_url / banner trigram indexes: documented, not created

-- 1. recursive ancestor walk, service role only; posts.id type is read from the catalog so a uuid or bigint id both work
do $$
declare t text;
begin
  select format_type(a.atttypid, null) into t from pg_attribute a
   where a.attrelid = to_regclass('public.posts') and a.attname = 'id' and not a.attisdropped;
  if t is null then raise notice 'nook_post_chain skipped: posts.id not found'; return; end if;
  execute format($f$create or replace function public.nook_post_chain(p_id %1$s, p_max int default 10)
    returns table (id %1$s, user_id uuid, body text, parent_id %1$s, depth int)
    language sql stable security definer set search_path = public as
    $b$ with recursive c as (
          select p.id, p.user_id, p.body, p.parent_id, 0 as depth from public.posts p where p.id = p_id
          union all
          select p.id, p.user_id, p.body, p.parent_id, c.depth + 1 from public.posts p join c on p.id = c.parent_id where c.depth + 1 < least(coalesce(p_max, 10), 20)
        ) select c.id, c.user_id, c.body, c.parent_id, c.depth from c $b$ $f$, t);
  execute format('revoke all on function public.nook_post_chain(%s, int) from public, anon, authenticated', t);
  execute format('grant execute on function public.nook_post_chain(%s, int) to service_role', t);
exception when others then
  raise notice 'nook_post_chain not created: %', sqlerrm;
end $$;

-- 2. email rehash: migration 20261026019000 rehashed a table only when its guards held at that moment, so a table could be skipped for good.
--    Here the rule is simple: a table is rehashed once (marker row in nook_email_rehash_done) when its lookup code already uses nook_hmac_hex.
--    A value that already looks like an hmac chain output cannot be told apart from an old hash (both are 64 hex), so the marker is the only guard.
--    Where the lookup functions do not use the hmac yet, nothing is touched and the notice says so; running this file again later is safe.
do $$
declare
  hs boolean := false;
  hm boolean := false;
  hk boolean := false;
begin
  if to_regclass('public.nook_email_rehash_done') is null or to_regprocedure('public.nook_hmac_hex(text)') is null then
    raise notice 'email rehash not set up (migration 19000 skipped), nothing to do';
    return;
  end if;
  if to_regprocedure('public.nook_email_key_old(text)') is not null and to_regprocedure('public.nook_email_key(text)') is not null then
    hk := position('nook_hmac_hex' in pg_get_functiondef('public.nook_email_key(text)'::regprocedure)) > 0;
  end if;
  if to_regprocedure('public.nook_age_hold_sync()') is not null and to_regprocedure('public.nook_accounts_mod()') is not null then
    hs := position('nook_hmac_hex' in pg_get_functiondef('public.nook_age_hold_sync()'::regprocedure)) > 0
      and position('nook_hmac_hex' in pg_get_functiondef('public.nook_accounts_mod()'::regprocedure)) > 0;
  end if;
  hm := hs;
  if hk and to_regclass('public.post_strikes') is not null
     and not exists (select 1 from public.nook_email_rehash_done where name = 'post_strikes') then
    lock table public.post_strikes in share row exclusive mode;
    update public.post_strikes set email_key = public.nook_hmac_hex(email_key);
    insert into public.nook_email_rehash_done (name) values ('post_strikes') on conflict do nothing;
  end if;
  if hm and to_regclass('public.age_holds') is not null
     and not exists (select 1 from public.nook_email_rehash_done where name = 'age_holds') then
    lock table public.age_holds in share row exclusive mode;
    update public.age_holds set email_hash = public.nook_hmac_hex(email_hash);
    insert into public.nook_email_rehash_done (name) values ('age_holds') on conflict do nothing;
  end if;
  if not hk then raise notice 'post_strikes not rehashed: nook_email_key is not the hmac chain'; end if;
  if not hm then raise notice 'age_holds not rehashed: age lock functions are not the hmac chain'; end if;
end $$;

-- 3. posts.media_url and accounts.banner trigram indexes are NOT created, on purpose:
--    app.js never searches these columns (no ilike / like on them; account search uses username and display_name, which have trigram indexes),
--    the only scans are inside the purge-on-delete function (like '%name%' on one deleted file, rare, server side),
--    and both columns can hold inline data: URLs of hundreds of KB, so a full gin index would be huge and slow every write.
--    If a media search is ever added, index a bounded expression such as left(media_url, 64) where media_url not like 'data:%' and query that same expression.
