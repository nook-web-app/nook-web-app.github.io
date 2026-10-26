-- audit fixes 7 (idempotent, guarded)
-- 1. feed list view without inline photos  2. email hashes become HMAC with the pepper  3. trigram indexes  4. notes row counter

-- 1. posts_feed: same rows and same row level security as posts (security_invoker), but a photo stored inline in the row is left out of the
--    list (media_inline says so); the app fetches the newest few inline ones by id. pg_column_size reads the stored size without detoasting.
do $$ begin
  if to_regclass('public.posts') is not null then
    begin
      execute $v$create or replace view public.posts_feed with (security_invoker = true) as
        select id, user_id, body, created_at, parent_id,
               case when pg_column_size(media_url) > 4000 then null else media_url end as media_url,
               (pg_column_size(media_url) > 4000) as media_inline
        from public.posts$v$;
      revoke all on public.posts_feed from public, anon;
      grant select on public.posts_feed to authenticated;
    exception when others then
      raise notice 'posts_feed not created: %', sqlerrm;
    end;
  end if;
end $$;

-- 2. email hashes: new value = hmac(pepper, old value). Lookups from an email compute the same chain, so they still match.
do $$
declare
  def text;
  fn text;
  ok boolean;
  oldA text := 'encode(digest(public.nook_email_norm(email), ''sha256''), ''hex'')';
  oldB text := 'encode(digest(lower(email), ''sha256''), ''hex'')';
begin
  if to_regclass('public.nook_pepper_store') is null or to_regprocedure('extensions.hmac(bytea,bytea,text)') is null then
    raise notice 'email rehash skipped: pepper store or pgcrypto missing';
    return;
  end if;
  execute $f$create or replace function public.nook_hmac_hex(p text) returns text
    language sql stable security definer set search_path = public, extensions as
    $b$ select encode(extensions.hmac(convert_to(p, 'utf8'), convert_to((select value from public.nook_pepper_store where id = 1) || ':email', 'utf8'), 'sha256'), 'hex') $b$ $f$;
  revoke all on function public.nook_hmac_hex(text) from public, anon, authenticated;
  grant execute on function public.nook_hmac_hex(text) to service_role;

  -- nook_email_key: keep the old body as nook_email_key_old, then the key is the hmac of it
  if to_regprocedure('public.nook_email_key(text)') is not null and to_regprocedure('public.nook_email_key_old(text)') is null then
    select pg_get_functiondef('public.nook_email_key(text)'::regprocedure) into def;
    def := replace(def, 'public.nook_email_key(', 'public.nook_email_key_old(');
    execute def;
    revoke all on function public.nook_email_key_old(text) from public, anon, authenticated;
    execute $f$create or replace function public.nook_email_key(p_email text) returns text
      language sql stable security definer set search_path = public, extensions as
      $b$ select public.nook_hmac_hex(public.nook_email_key_old(p_email)) $b$ $f$;
    revoke all on function public.nook_email_key(text) from public, anon;
    grant execute on function public.nook_email_key(text) to authenticated, service_role;
  end if;

  -- the age lock functions hash the same way: patch the live bodies so nothing else in them changes
  -- (both functions or neither, so a lookup and a write can never use different hashes)
  ok := true;
  foreach fn in array array['public.nook_age_hold_sync()', 'public.nook_accounts_mod()'] loop
    if to_regprocedure(fn) is null then ok := false;
    else
      select pg_get_functiondef(to_regprocedure(fn)) into def;
      if position('nook_hmac_hex' in def) = 0 and position(oldA in def) = 0 and position(oldB in def) = 0 then ok := false; end if;
    end if;
  end loop;
  foreach fn in array array['public.nook_age_hold_sync()', 'public.nook_accounts_mod()'] loop
    if ok then
      select pg_get_functiondef(to_regprocedure(fn)) into def;
      if position('nook_hmac_hex' in def) = 0 and (position(oldA in def) > 0 or position(oldB in def) > 0) then
        def := replace(replace(def, oldA, 'public.nook_hmac_hex(' || oldA || ')'), oldB, 'public.nook_hmac_hex(' || oldB || ')');
        execute def;
      end if;
    end if;
  end loop;

  -- existing rows are rehashed once from their old value
  create table if not exists public.nook_email_rehash_done (name text primary key, at timestamptz not null default now());
  alter table public.nook_email_rehash_done enable row level security;
  revoke all on public.nook_email_rehash_done from public, anon, authenticated;
  -- each table is rehashed only when the code that looks it up already uses the hmac chain, and only once
  if to_regclass('public.post_strikes') is not null and to_regprocedure('public.nook_email_key_old(text)') is not null
     and not exists (select 1 from public.nook_email_rehash_done where name = 'post_strikes') then
    lock table public.post_strikes in share row exclusive mode;
    update public.post_strikes set email_key = public.nook_hmac_hex(email_key);
    insert into public.nook_email_rehash_done (name) values ('post_strikes');
  end if;
  if to_regclass('public.age_holds') is not null and to_regprocedure('public.nook_age_hold_sync()') is not null
     and to_regprocedure('public.nook_accounts_mod()') is not null
     and position('nook_hmac_hex' in pg_get_functiondef(to_regprocedure('public.nook_age_hold_sync()'))) > 0
     and position('nook_hmac_hex' in pg_get_functiondef(to_regprocedure('public.nook_accounts_mod()'))) > 0
     and not exists (select 1 from public.nook_email_rehash_done where name = 'age_holds') then
    lock table public.age_holds in share row exclusive mode;
    update public.age_holds set email_hash = public.nook_hmac_hex(email_hash);
    insert into public.nook_email_rehash_done (name) values ('age_holds');
  end if;
end $$;

-- 3. trigram indexes for the account search (username, display name); only if pg_trgm is there or can be installed
--    posts.media_url and accounts.banner are left out on purpose: they can hold inline data URLs and the index would be huge
do $$ declare ns text; begin
  if not exists (select 1 from pg_extension where extname = 'pg_trgm') and exists (select 1 from pg_available_extensions where name = 'pg_trgm') then
    begin create extension if not exists pg_trgm with schema extensions; exception when others then null; end;
  end if;
  select n.nspname into ns from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  if ns is not null and to_regclass('public.accounts') is not null then
    execute format('create index if not exists accounts_username_trgm on public.accounts using gin (username %I.gin_trgm_ops)', ns);
    execute format('create index if not exists accounts_display_name_trgm on public.accounts using gin (display_name %I.gin_trgm_ops)', ns);
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'accounts' and column_name = 'bio') then
      execute format('create index if not exists accounts_bio_trgm on public.accounts using gin (bio %I.gin_trgm_ops)', ns);
    end if;
  end if;
end $$;

-- 4. notes cap reads a per-owner counter instead of counting up to 20000 rows on every insert
do $$ begin
  if to_regclass('public.notes_self') is null then return; end if;
  create table if not exists public.notes_counts (owner_id uuid primary key, n integer not null default 0);
  alter table public.notes_counts enable row level security;
  revoke all on public.notes_counts from public, anon, authenticated;

  create or replace function public.nook_notes_count() returns trigger language plpgsql security definer set search_path = public as $f$
  begin
    if tg_op = 'INSERT' then
      insert into public.notes_counts (owner_id, n) values (new.owner_id, 1) on conflict (owner_id) do update set n = public.notes_counts.n + 1;
    elsif tg_op = 'DELETE' then
      update public.notes_counts set n = greatest(n - 1, 0) where owner_id = old.owner_id;
    elsif new.owner_id is distinct from old.owner_id then
      update public.notes_counts set n = greatest(n - 1, 0) where owner_id = old.owner_id;
      insert into public.notes_counts (owner_id, n) values (new.owner_id, 1) on conflict (owner_id) do update set n = public.notes_counts.n + 1;
    end if;
    return null;
  end $f$;
  create or replace function public.nook_notes_count_reset() returns trigger language plpgsql security definer set search_path = public as $f$
  begin delete from public.notes_counts; return null; end $f$;
  revoke all on function public.nook_notes_count(), public.nook_notes_count_reset() from public, anon, authenticated;

  create or replace function public.nook_notes_cap() returns trigger language plpgsql security definer set search_path = public as $f$
  begin
    if coalesce((select n from public.notes_counts where owner_id = new.owner_id), 0) >= 20000
       and not exists (select 1 from public.notes_self x where x.owner_id = new.owner_id and x.id = new.id) then
      raise exception 'notes_full';
    end if;
    return new;
  end $f$;

  -- backfill while inserts wait, then the triggers keep it right
  lock table public.notes_self in share row exclusive mode;
  delete from public.notes_counts;
  insert into public.notes_counts (owner_id, n) select owner_id, count(*) from public.notes_self group by owner_id;
  drop trigger if exists nook_notes_count_t on public.notes_self;
  create trigger nook_notes_count_t after insert or delete or update of owner_id on public.notes_self for each row execute function public.nook_notes_count();
  drop trigger if exists nook_notes_count_trunc on public.notes_self;
  create trigger nook_notes_count_trunc after truncate on public.notes_self for each statement execute function public.nook_notes_count_reset();
end $$;
