-- a chat can be muted for a while; no end time means until it is switched back on
alter table public.dm_mutes add column if not exists until_at timestamptz;
