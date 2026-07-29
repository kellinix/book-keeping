-- VoiceLedger database schema (Postgres / Supabase)
-- Run this in Supabase SQL editor. Adjust for your environment.

-- Enable pgcrypto for gen_random_uuid()
create extension if not exists pgcrypto;

-- Profiles table (mirror of auth.users)
create table if not exists profiles (
  id uuid primary key,
  full_name text,
  email text,
  avatar_url text,
  created_at timestamptz default now()
);

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Businesses (one business per user by default, supports multi-business later)
create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references profiles(id) on delete cascade,
  name text,
  business_type text default 'limited_company',
  base_currency text default 'GBP',
  tax_year_start date,
  tax_year_end date,
  corporation_tax_rate numeric default 25,
  export_preferences jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- Business members
create table if not exists business_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  role text default 'member',
  created_at timestamptz default now()
);

-- Categories
create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  name text not null,
  is_default boolean default false,
  created_at timestamptz default now()
);

-- Transactions
create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  business_id uuid references businesses(id),
  transaction_date date,
  description text,
  merchant text,
  amount numeric,
  currency text default 'GBP',
  type text check (type in ('income','expense')) default 'expense',
  category text,
  payment_method text,
  source text check (source in ('manual','bank_upload','bank_connection','voice','receipt')) default 'manual',
  notes text,
  tags text[] not null default '{}',
  is_business boolean not null default true,
  tax_deductible boolean default false,
  confidence_score numeric,
  ai_explanation text,
  -- Payment source tracking
  payment_source text check (payment_source in ('business_account','personal_account','business_credit_card','personal_credit_card','cash','other')) default 'business_account',
  paid_by text check (paid_by in ('company','director','owner','employee','contractor','other')) default 'company',
  -- Director reimbursement tracking
  director_reimbursable boolean default false,
  reimbursement_status text check (reimbursement_status in ('not_applicable','owed_to_director','reimbursed','partially_reimbursed')) default 'not_applicable',
  reimbursed_amount numeric,
  reimbursed_date date,
  reimbursement_notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Uploads / stored files metadata
create table if not exists uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  business_id uuid references businesses(id),
  key text, -- path in storage
  name text,
  size bigint,
  content_type text,
  created_at timestamptz default now()
);

-- Receipts (images / pdfs)
create table if not exists receipts (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid references uploads(id) on delete cascade,
  transaction_id uuid references transactions(id) on delete set null,
  created_at timestamptz default now()
);

-- Open Banking connections. Tokens are application-encrypted before storage.
create table if not exists bank_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  provider text not null default 'truelayer',
  provider_name text,
  access_token_encrypted text not null,
  refresh_token_encrypted text,
  expires_at timestamptz not null,
  consent_expires_at timestamptz not null default (now() + interval '90 days'),
  status text check (status in ('active','error','disconnected')) default 'active',
  last_synced_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Auditable history for scheduled/manual bank synchronisation.
create table if not exists sync_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  connection_id uuid references bank_connections(id) on delete cascade,
  status text not null check (status in ('running','success','failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  imported_count integer not null default 0,
  duplicate_count integer not null default 0,
  error_message text
);

create table if not exists bank_accounts (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid references bank_connections(id) on delete cascade not null,
  user_id uuid references profiles(id) on delete cascade not null,
  provider_account_id text not null,
  display_name text,
  account_type text,
  currency text default 'GBP',
  account_number_masked text,
  is_business boolean not null default false,
  created_at timestamptz default now(),
  unique(connection_id, provider_account_id)
);

alter table bank_connections add column if not exists consent_expires_at timestamptz not null default (now() + interval '90 days');
alter table bank_accounts add column if not exists is_business boolean not null default false;

alter table transactions add column if not exists external_transaction_id text;
alter table transactions add column if not exists bank_account_id uuid references bank_accounts(id) on delete set null;
alter table transactions add column if not exists provider_account_ref text;
alter table transactions add column if not exists excluded_from_reports boolean not null default false;
alter table transactions add column if not exists duplicate_of_id uuid references transactions(id) on delete set null;
alter table transactions add column if not exists excluded_reason text;
alter table transactions add column if not exists tags text[] not null default '{}';
alter table transactions add column if not exists is_business boolean not null default true;
alter table transactions add column if not exists reconciliation_key text;
drop index if exists transactions_bank_external_unique;
create unique index if not exists transactions_bank_account_external_unique on transactions(user_id, bank_account_id, external_transaction_id) where external_transaction_id is not null;
create unique index if not exists transactions_reconciliation_unique on transactions(user_id, reconciliation_key) where reconciliation_key is not null;
create index if not exists transactions_provider_external_idx on transactions(user_id, provider_account_ref, external_transaction_id) where external_transaction_id is not null;
create index if not exists transactions_reporting_idx on transactions(user_id, excluded_from_reports, transaction_date desc);

-- Give existing Open Banking rows a stable account identity across OAuth reconnects.
update transactions t
set provider_account_ref = 'truelayer:' || ba.provider_account_id
from bank_accounts ba
where t.bank_account_id = ba.id
  and t.provider_account_ref is null;

-- AI logs for categorisation / transcription
create table if not exists ai_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  business_id uuid references businesses(id),
  kind text,
  input jsonb,
  output jsonb,
  created_at timestamptz default now()
);

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  business_id uuid references businesses(id),
  kind text not null,
  parameters jsonb default '{}'::jsonb,
  result jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists transactions_set_updated_at on transactions;
create trigger transactions_set_updated_at
before update on transactions
for each row execute function set_updated_at();

-- Enable Row Level Security and policies
alter table profiles enable row level security;
drop policy if exists "profiles_self_select" on profiles;
drop policy if exists "profiles_self_insert" on profiles;
create policy "profiles_self_select" on profiles for select using (id = auth.uid());
create policy "profiles_self_insert" on profiles for insert with check (id = auth.uid());

alter table businesses enable row level security;
drop policy if exists "business_owner_or_member_select" on businesses;
drop policy if exists "business_owner_insert" on businesses;
drop policy if exists "business_owner_update" on businesses;
create policy "business_owner_or_member_select" on businesses for select using (
  owner_id = auth.uid() or exists (select 1 from business_members bm where bm.business_id = businesses.id and bm.user_id = auth.uid())
);
create policy "business_owner_insert" on businesses for insert with check (owner_id = auth.uid());
create policy "business_owner_update" on businesses for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

alter table categories enable row level security;
drop policy if exists "categories_access" on categories;
create policy "categories_access" on categories for all using (
  exists (select 1 from businesses b where b.id = categories.business_id and (b.owner_id = auth.uid() or exists (select 1 from business_members bm where bm.business_id = b.id and bm.user_id = auth.uid())))
) with check (
  exists (select 1 from businesses b where b.id = categories.business_id and (b.owner_id = auth.uid() or exists (select 1 from business_members bm where bm.business_id = b.id and bm.user_id = auth.uid())))
);

alter table transactions enable row level security;
drop policy if exists "transactions_owner_select" on transactions;
drop policy if exists "transactions_owner_insert" on transactions;
drop policy if exists "transactions_owner_update" on transactions;
drop policy if exists "transactions_owner_delete" on transactions;
create policy "transactions_owner_select" on transactions for select using (
  user_id = auth.uid() or exists (select 1 from business_members bm where bm.business_id = transactions.business_id and bm.user_id = auth.uid())
);
create policy "transactions_owner_insert" on transactions for insert with check (user_id = auth.uid());
create policy "transactions_owner_update" on transactions for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "transactions_owner_delete" on transactions for delete using (user_id = auth.uid());

alter table uploads enable row level security;
drop policy if exists "uploads_owner" on uploads;
create policy "uploads_owner" on uploads for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table receipts enable row level security;
drop policy if exists "receipts_owner" on receipts;
create policy "receipts_owner" on receipts for all using (
  exists (select 1 from uploads u where u.id = receipts.upload_id and u.user_id = auth.uid())
) with check (
  exists (select 1 from uploads u where u.id = receipts.upload_id and u.user_id = auth.uid())
);

alter table bank_connections enable row level security;
drop policy if exists "bank_connections_owner" on bank_connections;
create policy "bank_connections_owner" on bank_connections for select using (user_id = auth.uid());

alter table bank_accounts enable row level security;
drop policy if exists "bank_accounts_owner" on bank_accounts;
create policy "bank_accounts_owner" on bank_accounts for select using (user_id = auth.uid());

alter table sync_logs enable row level security;
drop policy if exists "sync_logs_owner" on sync_logs;
create policy "sync_logs_owner" on sync_logs for select using (user_id = auth.uid());

alter table ai_logs enable row level security;
drop policy if exists "ai_logs_owner" on ai_logs;
create policy "ai_logs_owner" on ai_logs for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table reports enable row level security;
drop policy if exists "reports_owner" on reports;
create policy "reports_owner" on reports for all using (
  user_id = auth.uid() or exists (select 1 from business_members bm where bm.business_id = reports.business_id and bm.user_id = auth.uid())
) with check (
  user_id = auth.uid() or exists (select 1 from business_members bm where bm.business_id = reports.business_id and bm.user_id = auth.uid())
);

-- Migration: add payment source and reimbursement columns to existing transactions tables
alter table transactions add column if not exists payment_source text default 'business_account';
alter table transactions add column if not exists paid_by text default 'company';
alter table transactions add column if not exists director_reimbursable boolean default false;
alter table transactions add column if not exists reimbursement_status text default 'not_applicable';
alter table transactions add column if not exists reimbursed_amount numeric;
alter table transactions add column if not exists reimbursed_date date;
alter table transactions add column if not exists reimbursement_notes text;
alter table transactions drop constraint if exists transactions_source_check;
alter table transactions add constraint transactions_source_check check (source in ('manual','bank_upload','bank_connection','voice','receipt'));

-- Add check constraints if they don't already exist (safe to run multiple times via DO block)
do $$ begin
  if not exists (select 1 from information_schema.constraint_column_usage where table_name = 'transactions' and constraint_name = 'transactions_payment_source_check') then
    alter table transactions add constraint transactions_payment_source_check check (payment_source in ('business_account','personal_account','business_credit_card','personal_credit_card','cash','other'));
  end if;
  if not exists (select 1 from information_schema.constraint_column_usage where table_name = 'transactions' and constraint_name = 'transactions_paid_by_check') then
    alter table transactions add constraint transactions_paid_by_check check (paid_by in ('company','director','owner','employee','contractor','other'));
  end if;
  if not exists (select 1 from information_schema.constraint_column_usage where table_name = 'transactions' and constraint_name = 'transactions_reimbursement_status_check') then
    alter table transactions add constraint transactions_reimbursement_status_check check (reimbursement_status in ('not_applicable','owed_to_director','reimbursed','partially_reimbursed'));
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- MTD ITSA MIGRATION — appended per project convention (idempotent / IF NOT EXISTS)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── New table: income_sources ─────────────────────────────────────────────────
-- One row per income stream. MTD ITSA requires separate quarterly submissions
-- per source (self_employment vs uk_property). Limited companies are outside
-- ITSA scope and should NOT have rows here.
create table if not exists income_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  business_id uuid references businesses(id) on delete cascade,
  name text not null,
  source_type text not null check (source_type in ('self_employment', 'uk_property')),
  trading_name text,
  commencement_date date,
  cessation_date date,
  quarter_election text not null default 'calendar' check (quarter_election in ('calendar', 'tax_year')),
  -- Simplified reporting (income/expenses only) is business-level, not per-category.
  -- Available when turnover is below the VAT registration threshold.
  reporting_basis text not null default 'detailed' check (reporting_basis in ('detailed', 'simplified')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table income_sources enable row level security;
drop policy if exists "income_sources_owner" on income_sources;
create policy "income_sources_owner" on income_sources for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── New table: mtd_category_map ───────────────────────────────────────────────
-- Lookup table mapping VoiceLedger categories to HMRC quarterly-update field names.
-- Unique key is (vl_category, source_type): self_employment and uk_property have
-- DIFFERENT HMRC taxonomies and need separate rows.
-- NOTE: exact mtd_income_box / mtd_expense_box field names must be verified against
-- the live HMRC Self-Employment Business and UK Property Business APIs before any
-- real submission is attempted.
create table if not exists mtd_category_map (
  id uuid primary key default gen_random_uuid(),
  vl_category text not null,
  source_type text not null check (source_type in ('self_employment', 'uk_property')),
  mtd_income_box text,    -- HMRC field name for income direction (null if not applicable)
  mtd_expense_box text,   -- HMRC field name for expense direction (null if not applicable)
  created_at timestamptz default now(),
  unique (vl_category, source_type)
);

alter table mtd_category_map enable row level security;
drop policy if exists "mtd_category_map_select" on mtd_category_map;
create policy "mtd_category_map_select" on mtd_category_map for select to authenticated using (true);

-- Seed self_employment and uk_property category mappings
insert into mtd_category_map (vl_category, source_type, mtd_income_box, mtd_expense_box) values
  -- Self-employment income source
  ('Revenue',               'self_employment', 'turnover',                null),
  ('Software',              'self_employment', null,                      'adminCosts'),
  ('Marketing',             'self_employment', null,                      'advertisingCosts'),
  ('Contractor/Freelancer', 'self_employment', null,                      'costOfGoods'),
  ('Office/Admin',          'self_employment', null,                      'adminCosts'),
  ('Travel',                'self_employment', null,                      'travelCosts'),
  ('Equipment',             'self_employment', null,                      'depreciation'),
  ('Professional Services', 'self_employment', null,                      'professionalFees'),
  ('Bank Fees',             'self_employment', null,                      'financeCharges'),
  ('Tax',                   'self_employment', null,                      'otherAllowableCharges'),
  ('Refund/Reversal',       'self_employment', 'other',                   'other'),
  ('Other',                 'self_employment', 'other',                   'otherAllowableCharges'),
  -- UK property income source
  ('Revenue',               'uk_property',     'totalRentsReceived',      null),
  ('Office/Admin',          'uk_property',     null,                      'premisesRunningCosts'),
  ('Professional Services', 'uk_property',     null,                      'professionalFees'),
  ('Bank Fees',             'uk_property',     null,                      'financialCosts'),
  ('Refund/Reversal',       'uk_property',     'other',                   'other'),
  ('Other',                 'uk_property',     'other',                   'other')
on conflict (vl_category, source_type) do nothing;

-- ── New table: tax_periods ────────────────────────────────────────────────────
-- One row per quarter per income source. Period boundaries and due dates are derived
-- from the source's quarter_election. requires_bsas_gap flags the 2026/27 first-year
-- calendar Q1 exception (1–5 Apr 2026 is not covered by quarterly updates).
create table if not exists tax_periods (
  id uuid primary key default gen_random_uuid(),
  income_source_id uuid references income_sources(id) on delete cascade,
  tax_year text not null,
  quarter int not null check (quarter between 1 and 4),
  period_start date not null,
  period_end date not null,
  due_date date not null,
  requires_bsas_gap boolean not null default false,
  status text not null default 'open' check (status in ('open', 'submitted', 'locked')),
  submitted_at timestamptz,
  created_at timestamptz default now(),
  unique (income_source_id, tax_year, quarter)
);

alter table tax_periods enable row level security;
drop policy if exists "tax_periods_owner" on tax_periods;
create policy "tax_periods_owner" on tax_periods for all
  using (exists (select 1 from income_sources s where s.id = tax_periods.income_source_id and s.user_id = auth.uid()))
  with check (exists (select 1 from income_sources s where s.id = tax_periods.income_source_id and s.user_id = auth.uid()));

-- ── New table: transaction_audit_log ─────────────────────────────────────────
-- Append-only. The log_transaction_changes() trigger writes here on every UPDATE
-- to category, amount_pence, tax status, tax_deductible, or user_confirmed. No user-facing
-- INSERT/UPDATE/DELETE is allowed (RLS blocks it; trigger uses SECURITY DEFINER).
create table if not exists transaction_audit_log (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid references transactions(id) on delete cascade,
  user_id uuid references profiles(id),
  changed_at timestamptz default now(),
  field_name text not null,
  old_value text,
  new_value text,
  change_source text default 'user' check (change_source in ('user', 'ai', 'import', 'system'))
);

alter table transaction_audit_log enable row level security;
drop policy if exists "audit_log_select" on transaction_audit_log;
create policy "audit_log_select" on transaction_audit_log for select
  using (exists (
    select 1 from transactions t
    where t.id = transaction_audit_log.transaction_id and t.user_id = auth.uid()
  ));

-- ── Alter: businesses ────────────────────────────────────────────────────────
-- Change default business_type from limited_company to sole_trader (existing rows unaffected).
alter table businesses alter column business_type set default 'sole_trader';
-- MTD enrolment flag. NINO/UTR are deferred to the OAuth/enrolment stage and
-- MUST be encrypted at rest before being stored.
alter table businesses add column if not exists mtd_enrolled boolean default false;

-- Every code path assumes one business per owner (.maybeSingle() queries).
-- Without this constraint, a client-side race can silently create duplicates:
-- once >1 row exists, maybeSingle() errors, callers see data=null, and treat
-- "no business" as license to insert yet another one, compounding forever.
create unique index if not exists businesses_owner_id_unique on businesses(owner_id);

-- ── Alter: transactions ───────────────────────────────────────────────────────
-- DEPRECATED: amount (numeric/float). All new writes must use amount_pence instead.
-- amount will be dropped in a future migration once all reads are migrated.
alter table transactions add column if not exists amount_pence bigint;
alter table transactions add column if not exists income_source_id uuid references income_sources(id);
alter table transactions add column if not exists period_id uuid references tax_periods(id);
alter table transactions add column if not exists suggested_by_ai boolean default false;
alter table transactions add column if not exists user_confirmed boolean default false;
alter table transactions add column if not exists is_locked boolean default false;

-- NOT VALID: skip scan of existing nullable rows, but enforce for all new inserts/updates.
do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where table_name = 'transactions' and constraint_name = 'transactions_amount_pence_required'
  ) then
    alter table transactions add constraint transactions_amount_pence_required
      check (amount_pence is not null) not valid;
  end if;
  if not exists (
    select 1 from information_schema.table_constraints
    where table_name = 'transactions' and constraint_name = 'transactions_date_required'
  ) then
    alter table transactions add constraint transactions_date_required
      check (transaction_date is not null) not valid;
  end if;
end $$;

-- ── Audit trigger ─────────────────────────────────────────────────────────────
create or replace function log_transaction_changes()
returns trigger as $$
begin
  if old.category is distinct from new.category then
    insert into transaction_audit_log (transaction_id, user_id, field_name, old_value, new_value)
    values (old.id, auth.uid(), 'category', old.category, new.category);
  end if;
  if old.amount_pence is distinct from new.amount_pence then
    insert into transaction_audit_log (transaction_id, user_id, field_name, old_value, new_value)
    values (old.id, auth.uid(), 'amount_pence', old.amount_pence::text, new.amount_pence::text);
  end if;
  if old.tax_deductible is distinct from new.tax_deductible then
    insert into transaction_audit_log (transaction_id, user_id, field_name, old_value, new_value)
    values (old.id, auth.uid(), 'tax_deductible', old.tax_deductible::text, new.tax_deductible::text);
  end if;
  if old.is_business is distinct from new.is_business then
    insert into transaction_audit_log (transaction_id, user_id, field_name, old_value, new_value)
    values (old.id, auth.uid(), 'is_business', old.is_business::text, new.is_business::text);
  end if;
  if old.user_confirmed is distinct from new.user_confirmed then
    insert into transaction_audit_log (transaction_id, user_id, field_name, old_value, new_value)
    values (old.id, auth.uid(), 'user_confirmed', old.user_confirmed::text, new.user_confirmed::text);
  end if;
  if old.excluded_from_reports is distinct from new.excluded_from_reports then
    insert into transaction_audit_log (transaction_id, user_id, field_name, old_value, new_value)
    values (old.id, auth.uid(), 'excluded_from_reports', old.excluded_from_reports::text, new.excluded_from_reports::text);
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists transactions_audit_log on transactions;
create trigger transactions_audit_log
before update on transactions
for each row execute function log_transaction_changes();

-- ── Backfills (idempotent) ────────────────────────────────────────────────────

-- 1. Backfill amount_pence from existing float amounts
update transactions
set amount_pence = round(amount * 100)::bigint
where amount_pence is null and amount is not null;

-- 2. All existing transactions were reviewed before user_confirmed existed — mark confirmed
update transactions set user_confirmed = true where user_confirmed = false;

-- 3. Create default self_employment income_source for sole_trader/landlord businesses only.
--    Limited companies are outside ITSA scope and must NOT receive an income_source.
insert into income_sources (user_id, business_id, name, source_type, quarter_election)
select b.owner_id, b.id, coalesce(b.name, 'My Business'), 'self_employment', 'calendar'
from businesses b
where b.business_type in ('sole_trader', 'landlord')
  and not exists (select 1 from income_sources s where s.business_id = b.id);

-- 4. Backfill income_source_id for sole_trader/landlord transactions
update transactions t
set income_source_id = (
  select s.id from income_sources s
  where s.business_id = t.business_id
  order by s.created_at
  limit 1
)
where t.income_source_id is null
  and exists (
    select 1 from businesses b
    where b.id = t.business_id
      and b.business_type in ('sole_trader', 'landlord')
  );

-- Dashboard totals update immediately when transactions change.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'transactions'
     ) then
    alter publication supabase_realtime add table public.transactions;
  end if;
end;
$$;

-- End of schema
