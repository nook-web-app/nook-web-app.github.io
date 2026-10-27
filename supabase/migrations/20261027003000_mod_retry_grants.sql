-- the moderation function runs as service_role, which has no automatic rights on tables made here
grant select, insert, update, delete on public.mod_retry to service_role;
