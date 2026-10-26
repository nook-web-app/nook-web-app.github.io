-- delete events: needs the matching app.js (ships together)
-- 1. DM deletes reach only the two people in the chat, over a private realtime topic dmdel-<user id>
-- 2. zenith_deleted keeps a short-lived record of removed zenith_docs rows so another device can drop its copy

create or replace function public.nook_msg_deleted_notify() returns trigger
language plpgsql security definer set search_path = public, realtime
as $$
begin
  begin
    perform realtime.send(jsonb_build_object('id', old.id), 'del', 'dmdel-' || old.sender_id::text, true);
    if old.recipient_id is distinct from old.sender_id then
      perform realtime.send(jsonb_build_object('id', old.id), 'del', 'dmdel-' || old.recipient_id::text, true);
    end if;
  exception when others then
    raise warning 'nook_msg_deleted_notify: %', sqlerrm;
  end;
  return old;
end $$;
revoke all on function public.nook_msg_deleted_notify() from public, anon, authenticated;

do $$ begin
  if to_regclass('public.messages') is not null and to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    drop trigger if exists nook_msg_deleted_notify on public.messages;
    create trigger nook_msg_deleted_notify after delete on public.messages
      for each row execute function public.nook_msg_deleted_notify();
  else
    raise notice 'dm delete notify trigger not created (messages or realtime.send missing)';
  end if;
end $$;

do $$ begin
  drop policy if exists "dmdel receive own" on realtime.messages;
  create policy "dmdel receive own" on realtime.messages for select to authenticated
    using (extension = 'broadcast' and realtime.topic() = 'dmdel-' || (select auth.uid())::text);
exception when insufficient_privilege or undefined_table or undefined_function then
  raise notice 'dmdel realtime policy not changed';
end $$;

-- zenith tombstones (no foreign key, so removing an account can still write them)
create table if not exists public.zenith_deleted (
  owner_id uuid not null,
  kind text not null,
  doc_id text not null,
  deleted_at timestamptz not null default clock_timestamp(),
  primary key (owner_id, kind, doc_id)
);
create index if not exists zenith_deleted_owner_at on public.zenith_deleted (owner_id, deleted_at);
alter table public.zenith_deleted enable row level security;
revoke all on public.zenith_deleted from anon, authenticated;
grant select on public.zenith_deleted to authenticated;
grant all on public.zenith_deleted to service_role;

do $$ begin
  if to_regprocedure('public.nook_is_owner()') is not null then
    drop policy if exists "zenith deleted owner select" on public.zenith_deleted;
    create policy "zenith deleted owner select" on public.zenith_deleted for select to authenticated
      using (owner_id = (select auth.uid()) and (select public.nook_is_owner()));
  end if;
end $$;

create or replace function public.nook_zenith_docs_tomb() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    insert into public.zenith_deleted (owner_id, kind, doc_id, deleted_at)
    values (old.owner_id, old.kind, old.doc_id, clock_timestamp())
    on conflict (owner_id, kind, doc_id) do update set deleted_at = excluded.deleted_at;
    delete from public.zenith_deleted where owner_id = old.owner_id and deleted_at < now() - interval '30 days';
    return old;
  end if;
  -- a row written again is no longer deleted
  delete from public.zenith_deleted where owner_id = new.owner_id and kind = new.kind and doc_id = new.doc_id;
  return new;
end $$;
revoke all on function public.nook_zenith_docs_tomb() from public, anon, authenticated;

do $$ begin
  if to_regclass('public.zenith_docs') is not null then
    drop trigger if exists nook_zenith_docs_tomb_del on public.zenith_docs;
    create trigger nook_zenith_docs_tomb_del after delete on public.zenith_docs
      for each row execute function public.nook_zenith_docs_tomb();
    drop trigger if exists nook_zenith_docs_tomb_ins on public.zenith_docs;
    create trigger nook_zenith_docs_tomb_ins after insert on public.zenith_docs
      for each row execute function public.nook_zenith_docs_tomb();
  end if;
end $$;
