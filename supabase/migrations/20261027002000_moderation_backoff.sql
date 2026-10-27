-- a post the AI cannot read is retried less and less often instead of every 20 seconds, so one stuck post cannot use up the whole AI quota
create table if not exists public.mod_retry (
  post_id uuid primary key,
  tries int not null default 0,
  next_at timestamptz not null default now()
);
alter table public.mod_retry enable row level security;
revoke all on public.mod_retry from anon, authenticated;
select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'nook-moderate-sweep'), schedule := '* * * * *');
