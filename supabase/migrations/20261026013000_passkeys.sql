-- sign in with Face ID or a fingerprint (passkeys): the public half of each key lives here, the private half never leaves the phone
create table if not exists public.passkeys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  credential_id text not null unique,
  public_key text not null,
  counter bigint not null default 0,
  transports text[],
  name text,
  created_at timestamptz not null default now()
);
create index if not exists passkeys_user on public.passkeys (user_id);
alter table public.passkeys enable row level security;
-- the owner can see and remove their own keys; only the server adds or changes them
grant select, delete on public.passkeys to authenticated;
grant all on public.passkeys to service_role;
drop policy if exists passkeys_read on public.passkeys;
create policy passkeys_read on public.passkeys for select to authenticated using (user_id = auth.uid());
drop policy if exists passkeys_remove on public.passkeys;
create policy passkeys_remove on public.passkeys for delete to authenticated using (user_id = auth.uid());

-- one use challenges, only the server touches them
create table if not exists public.passkey_challenges (
  challenge text primary key,
  user_id uuid,
  purpose text not null,
  created_at timestamptz not null default now()
);
alter table public.passkey_challenges enable row level security;
grant all on public.passkey_challenges to service_role;
