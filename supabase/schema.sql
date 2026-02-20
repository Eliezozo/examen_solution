create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key,
  full_name text,
  phone text,
  classe text check (classe in ('CM2', '3ème', '1ère')),
  theme_color text not null default 'green',
  preferred_tutor_gender text not null default 'female',
  referral_balance integer not null default 0,
  total_referral_earnings integer not null default 0,
  is_premium boolean not null default false,
  premium_until timestamptz,
  created_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists full_name text;
alter table public.profiles
  add column if not exists theme_color text not null default 'green';
alter table public.profiles
  add column if not exists preferred_tutor_gender text not null default 'female';
alter table public.profiles
  add column if not exists referral_balance integer not null default 0;
alter table public.profiles
  add column if not exists total_referral_earnings integer not null default 0;

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

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_theme_color_allowed'
  ) then
    alter table public.profiles
      add constraint profiles_theme_color_allowed
      check (theme_color in ('green', 'blue', 'orange', 'red', 'black'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_tutor_gender_allowed'
  ) then
    alter table public.profiles
      add constraint profiles_tutor_gender_allowed
      check (preferred_tutor_gender in ('female', 'male'));
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

create table if not exists public.referral_commissions (
  id uuid primary key default gen_random_uuid(),
  payment_transaction_id uuid unique,
  referrer_user_id uuid not null references public.profiles(id) on delete cascade,
  payer_user_id uuid not null references public.profiles(id) on delete cascade,
  payer_phone text not null,
  plan_id text not null,
  plan_amount integer not null,
  commission_amount integer not null,
  payout_phone text not null,
  payout_status text not null default 'paid',
  created_at timestamptz not null default now()
);

create index if not exists idx_referral_commissions_referrer_user_id on public.referral_commissions(referrer_user_id);
create index if not exists idx_referral_commissions_created_at on public.referral_commissions(created_at desc);

alter table public.referral_commissions
  add column if not exists payment_transaction_id uuid;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_user_id on public.notifications(user_id);
create index if not exists idx_notifications_created_at on public.notifications(created_at desc);

create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  fedapay_transaction_id bigint not null unique,
  fedapay_reference text,
  status text not null default 'pending',
  plan_id text not null,
  plan_amount integer not null,
  full_name text not null,
  phone text not null,
  classe text,
  tutor_gender text not null default 'female',
  recommender_phone text,
  premium_until timestamptz,
  approved_at timestamptz,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_payment_transactions_user_id on public.payment_transactions(user_id);
create index if not exists idx_payment_transactions_status on public.payment_transactions(status);
create index if not exists idx_payment_transactions_created_at on public.payment_transactions(created_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'referral_commissions_payment_transaction_id_fkey'
  ) then
    alter table public.referral_commissions
      add constraint referral_commissions_payment_transaction_id_fkey
      foreign key (payment_transaction_id)
      references public.payment_transactions(id)
      on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'referral_commissions_payment_transaction_id_key'
  ) then
    alter table public.referral_commissions
      add constraint referral_commissions_payment_transaction_id_key
      unique (payment_transaction_id);
  end if;
end $$;

alter table public.profiles enable row level security;
alter table public.history enable row level security;
alter table public.referral_commissions enable row level security;
alter table public.notifications enable row level security;
alter table public.payment_transactions enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "history_select_own" on public.history;
drop policy if exists "history_insert_own" on public.history;
drop policy if exists "referral_commissions_select_own" on public.referral_commissions;
drop policy if exists "referral_commissions_insert_own" on public.referral_commissions;
drop policy if exists "notifications_select_own" on public.notifications;
drop policy if exists "notifications_insert_own" on public.notifications;
drop policy if exists "profiles_select_all" on public.profiles;
drop policy if exists "profiles_insert_all" on public.profiles;
drop policy if exists "profiles_update_all" on public.profiles;
drop policy if exists "history_select_all" on public.history;
drop policy if exists "history_insert_all" on public.history;
drop policy if exists "referral_commissions_select_all" on public.referral_commissions;
drop policy if exists "referral_commissions_insert_all" on public.referral_commissions;
drop policy if exists "notifications_select_all" on public.notifications;
drop policy if exists "notifications_insert_all" on public.notifications;
drop policy if exists "payment_transactions_select_all" on public.payment_transactions;
drop policy if exists "payment_transactions_insert_all" on public.payment_transactions;
drop policy if exists "payment_transactions_update_all" on public.payment_transactions;

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

create policy "referral_commissions_select_all"
on public.referral_commissions for select
using (true);

create policy "referral_commissions_insert_all"
on public.referral_commissions for insert
with check (true);

create policy "notifications_select_all"
on public.notifications for select
using (true);

create policy "notifications_insert_all"
on public.notifications for insert
with check (true);

create policy "payment_transactions_select_all"
on public.payment_transactions for select
using (true);

create policy "payment_transactions_insert_all"
on public.payment_transactions for insert
with check (true);

create policy "payment_transactions_update_all"
on public.payment_transactions for update
using (true)
with check (true);
