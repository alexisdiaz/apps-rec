create table if not exists public.accounts (
  id uuid primary key,
  service text not null,
  name text not null,
  cost numeric(10, 2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.people (
  id uuid primary key,
  name text not null,
  phone text,
  account_id uuid not null references public.accounts(id) on delete restrict,
  recommended_by text,
  pay_day integer not null check (pay_day between 1 and 31),
  amount numeric(10, 2) not null default 0,
  paid_until date,
  last_payment_at date,
  note text,
  created_at timestamptz not null default now()
);

alter table public.accounts enable row level security;
alter table public.people enable row level security;

create policy "Allow app access to accounts"
on public.accounts
for all
using (true)
with check (true);

create policy "Allow app access to people"
on public.people
for all
using (true)
with check (true);
