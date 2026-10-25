-- Test accounts made by the automatic checks use the reserved .test domain, so no real person can have one.
-- They are removed now, and every half hour once they are an hour old.
delete from auth.users where email like '%@nook.test';
select cron.schedule('nook-clean-test-bots', '*/30 * * * *', $$delete from auth.users where email like '%@nook.test' and created_at < now() - interval '1 hour'$$);
