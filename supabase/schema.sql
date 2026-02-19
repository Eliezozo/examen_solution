create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key,
  full_name text,
  phone text,
  classe text check (classe in ('CM2', '3ème', '1ère')),
  is_premium boolean not null default false,
  premium_until timestamptz,
  created_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists full_name text;

-- Nettoyage des anciennes données avant contrainte:
-- tout numéro qui ne respecte pas +228 XXXXXXXX passe à NULL.
update public.profiles
set phone = null
where phone is not null
  and phone !~ '^\+228 [0-9]{8}$';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_phone_togo_format'
  ) then
    alter table public.profiles
      add constraint profiles_phone_togo_format
      check (phone is null or phone ~ '^\+228 [0-9]{8}$');
  end if;
end $$;

create table if not exists public.history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  message text not null,
  response text not null,
  image_url text,
  created_at timestamptz not null default now()
);

create index if not exists idx_history_user_id on public.history(user_id);
create index if not exists idx_history_created_at on public.history(created_at desc);

alter table public.profiles enable row level security;
alter table public.history enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "history_select_own" on public.history;
drop policy if exists "history_insert_own" on public.history;

-- MVP sans Supabase Auth:
-- on autorise la lecture/écriture via l'API backend (service role) et clients anonymes.
-- A durcir dès que l'auth téléphone est activée.
create policy "profiles_select_all"
on public.profiles for select
using (true);

create policy "profiles_insert_all"
on public.profiles for insert
with check (true);

create policy "profiles_update_all"
on public.profiles for update
using (true)
with check (true);

create policy "history_select_all"
on public.history for select
using (true);

create policy "history_insert_all"
on public.history for insert
with check (true);
