-- Notes to self, kept on every phone. Each chat and each message is one row that is sealed on the phone
-- with the person's own chat key, so the server only ever holds text it cannot read.
create table if not exists public.notes_self (
  owner_id uuid not null references public.accounts(id) on delete cascade,
  id text not null check (char_length(id) <= 80),
  body text not null default '' check (char_length(body) <= 400000),
  media jsonb not null default '[]'::jsonb,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);
create index if not exists notes_self_since on public.notes_self (owner_id, updated_at);

alter table public.notes_self enable row level security;
drop policy if exists "notes own" on public.notes_self;
create policy "notes own" on public.notes_self for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
grant select, insert, update, delete on public.notes_self to authenticated;

-- the server writes the time, so every phone orders changes the same way
create or replace function public.nook_notes_stamp() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists nook_notes_stamp_t on public.notes_self;
create trigger nook_notes_stamp_t before insert or update on public.notes_self for each row execute function public.nook_notes_stamp();

-- one person can keep up to 20000 rows (chats, messages and removals)
create or replace function public.nook_notes_cap() returns trigger language plpgsql set search_path = public as $$
begin
  if (select count(*) from public.notes_self where owner_id = new.owner_id) >= 20000 then raise exception 'notes_full'; end if;
  return new;
end $$;
drop trigger if exists nook_notes_cap_t on public.notes_self;
create trigger nook_notes_cap_t before insert on public.notes_self for each row execute function public.nook_notes_cap();

-- removals are kept for 30 days so every phone hears about them, then forgotten
select cron.schedule('nook-notes-clean', '41 3 * * *', $$delete from public.notes_self where deleted and updated_at < now() - interval '30 days'$$);
