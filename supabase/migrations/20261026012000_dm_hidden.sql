-- a hidden chat leaves the chat list and sends no alerts
alter table public.dm_mutes add column if not exists hidden boolean not null default false;
