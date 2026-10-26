-- bug fixes (idempotent, guarded)
-- 1. posts read policy only shows other people's posts once the AI check said safe
-- 2. storage cleanup no longer trips the edit-gap triggers of the user's own delete
-- 3. old zenith_deleted tombstones are cleaned every night, also for accounts that are gone

-- 1.
do $$ begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'posts' and policyname = 'anyone can read posts')
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'posts' and column_name = 'mod_status') then
    alter policy "anyone can read posts" on public.posts to authenticated using (
      (user_id = (select auth.uid()))
      or (mod_status = 'safe'
          and not exists (select 1 from public.accounts a where a.id = posts.user_id and a.deactivated)
          and not exists (select 1 from public.blocks b where b.blocker_id = posts.user_id and b.blocked_id = (select auth.uid())))
    );
  end if;
exception when others then
  raise notice 'posts read policy not changed: %', sqlerrm;
end $$;

-- 2. patch the live function bodies in place; skipped when already patched or when the body is not the expected one
do $$
declare def text; f text;
begin
  foreach f in array array['nook_posts_edit_gap', 'nook_accounts_edit_gap'] loop
    if to_regprocedure('public.' || f || '()') is not null then
      def := pg_get_functiondef(('public.' || f || '()')::regprocedure);
      if position('nook.mod' in def) = 0 and position('if auth.uid() is null then return new;' in def) > 0 then
        execute replace(def, 'if auth.uid() is null then return new;', 'if auth.uid() is null or coalesce(current_setting(''nook.mod'', true), '''') = ''1'' then return new;');
      end if;
    end if;
  end loop;
  if to_regprocedure('public.nook_storage_gone_media()') is not null then
    def := pg_get_functiondef('public.nook_storage_gone_media()'::regprocedure);
    if position('nook.mod' in def) = 0
       and position('  suffix := ' in def) > 0
       and position('  return old;' || chr(10) || 'end $function$' in def) > 0 then
      def := replace(def, '  suffix := ', '  perform set_config(''nook.mod'', ''1'', true);' || chr(10) || '  suffix := ');
      def := replace(def, '  return old;' || chr(10) || 'end $function$', '  perform set_config(''nook.mod'', '''', true);' || chr(10) || '  return old;' || chr(10) || 'end $function$');
      execute def;
    end if;
  end if;
exception when others then
  raise notice 'edit-gap patch skipped: %', sqlerrm;
end $$;

-- 3.
do $$ begin
  if to_regnamespace('cron') is not null and to_regclass('public.zenith_deleted') is not null then
    perform cron.schedule('nook-zenith-deleted-clean', '37 4 * * *', 'delete from public.zenith_deleted where deleted_at < now() - interval ''30 days''');
  end if;
exception when others then
  raise notice 'tombstone cron not scheduled: %', sqlerrm;
end $$;
