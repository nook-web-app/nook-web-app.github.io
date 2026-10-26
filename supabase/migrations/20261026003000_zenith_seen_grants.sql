-- the server writes this table, and new tables here start without any access, so it has to be granted
grant select, insert, update, delete on public.zenith_seen to service_role;
