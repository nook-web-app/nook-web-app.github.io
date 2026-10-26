-- Zenith is a public account now: this remembers which posts he has already looked at, so he never reacts twice.
create table if not exists public.zenith_seen (
  post_id uuid primary key,
  acted text not null default '',
  created_at timestamptz not null default now()
);
alter table public.zenith_seen enable row level security;
-- nobody but the server reads or writes it
create index if not exists zenith_seen_created on public.zenith_seen (created_at);
-- old entries are forgotten after two weeks
select cron.schedule('nook-zenith-seen-clean', '29 4 * * *', $$delete from public.zenith_seen where created_at < now() - interval '14 days'$$);
