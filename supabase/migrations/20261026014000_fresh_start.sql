-- one time fresh start, on the owner's request: every account and everything that belongs to them is removed.
-- The tables, functions, schedules and secrets (including the password pepper) stay as they are.
delete from auth.users;
do $$
declare t text;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'nook_pepper_store'
  loop
    execute format('delete from public.%I', t);
  end loop;
end $$;
