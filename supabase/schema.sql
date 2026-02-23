create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key,
  full_name text,
  phone text,
  classe text check (classe in ('CM2', '3ème', '1ère', 'Terminale')),
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

alter table public.profiles
  drop constraint if exists profiles_classe_check;
alter table public.profiles
  drop constraint if exists profiles_classe_allowed;
alter table public.profiles
  add constraint profiles_classe_allowed
  check (classe in ('CM2', '3ème', '1ère', 'Terminale'));

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

drop function if exists public.activate_manual_premium(uuid, integer, integer, text);
drop function if exists public.activate_manual_premium_by_phone(text, integer, integer, text);

create function public.activate_manual_premium(
  p_user_id uuid,
  p_days integer default 30,
  p_amount integer default 500,
  p_note text default null
)
returns table (
  user_id uuid,
  premium_until timestamptz,
  payment_transaction_id uuid
)
language plpgsql
as $$
declare
  v_profile record;
  v_now timestamptz := now();
  v_base_date timestamptz;
  v_new_premium_until timestamptz;
  v_tx_id uuid;
  v_plan_id text;
  v_fedapay_tx_id bigint;
begin
  if p_user_id is null then
    raise exception 'user_id requis';
  end if;

  if p_days is null or p_days <= 0 then
    raise exception 'days doit etre > 0';
  end if;

  if p_amount is null or p_amount < 0 then
    raise exception 'amount doit etre >= 0';
  end if;

  select
    p.id,
    p.full_name,
    p.phone,
    p.classe,
    p.preferred_tutor_gender,
    p.premium_until
  into v_profile
  from public.profiles p
  where p.id = p_user_id
  for update;

  if not found then
    raise exception 'Profil introuvable pour user_id=%', p_user_id;
  end if;

  v_base_date := greatest(coalesce(v_profile.premium_until, v_now), v_now);
  v_new_premium_until := v_base_date + make_interval(days => p_days);
  v_plan_id := case when p_days >= 365 then 'pass_yearly' else 'pass_monthly' end;

  update public.profiles
  set
    is_premium = true,
    premium_until = v_new_premium_until
  where id = p_user_id;

  -- Identifiant négatif pour distinguer les activations manuelles des transactions FedaPay.
  v_fedapay_tx_id := -((extract(epoch from clock_timestamp()) * 1000)::bigint + floor(random() * 1000)::bigint);

  insert into public.payment_transactions (
    user_id,
    fedapay_transaction_id,
    fedapay_reference,
    status,
    plan_id,
    plan_amount,
    full_name,
    phone,
    classe,
    tutor_gender,
    recommender_phone,
    premium_until,
    approved_at,
    raw_payload
  )
  values (
    p_user_id,
    v_fedapay_tx_id,
    'manual_sql_' || extract(epoch from clock_timestamp())::bigint,
    'approved',
    v_plan_id,
    p_amount,
    coalesce(v_profile.full_name, 'Activation manuelle'),
    coalesce(v_profile.phone, 'N/A'),
    v_profile.classe,
    coalesce(v_profile.preferred_tutor_gender, 'female'),
    null,
    v_new_premium_until,
    now(),
    jsonb_build_object(
      'source', 'manual-sql-function',
      'note', p_note,
      'granted_days', p_days
    )
  )
  returning id into v_tx_id;

  insert into public.notifications (
    user_id,
    title,
    message,
    metadata
  )
  values (
    p_user_id,
    'Premium activé manuellement',
    'Ton premium est actif jusqu''au ' || to_char(v_new_premium_until at time zone 'UTC', 'DD/MM/YYYY') || '.',
    jsonb_build_object(
      'source', 'manual-sql-function',
      'days', p_days,
      'amount', p_amount,
      'payment_transaction_id', v_tx_id,
      'note', p_note
    )
  );

  return query
  select p_user_id, v_new_premium_until, v_tx_id;
end;
$$;

create function public.activate_manual_premium_by_phone(
  p_phone text,
  p_days integer default 30,
  p_amount integer default 500,
  p_note text default null
)
returns table (
  user_id uuid,
  phone text,
  premium_until timestamptz,
  payment_transaction_id uuid
)
language plpgsql
as $$
declare
  v_user_id uuid;
  v_result record;
begin
  if p_phone is null or btrim(p_phone) = '' then
    raise exception 'phone requis';
  end if;

  if p_phone !~ '^\+228 [0-9]{8}$' then
    raise exception 'Numéro invalide. Format requis: +228 XXXXXXXX';
  end if;

  select p.id
  into v_user_id
  from public.profiles p
  where p.phone = btrim(p_phone)
  order by p.created_at desc
  limit 1;

  if v_user_id is null then
    insert into public.profiles (
      id,
      phone,
      full_name,
      classe,
      preferred_tutor_gender,
      is_premium,
      premium_until
    )
    values (
      gen_random_uuid(),
      btrim(p_phone),
      null,
      null,
      'female',
      false,
      null
    )
    returning id into v_user_id;
  end if;

  select *
  into v_result
  from public.activate_manual_premium(v_user_id, p_days, p_amount, p_note);

  return query
  select
    v_result.user_id,
    btrim(p_phone),
    v_result.premium_until,
    v_result.payment_transaction_id;
end;
$$;
