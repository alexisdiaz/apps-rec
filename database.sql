create table if not exists public.accounts (
  id uuid primary key,
  service text not null,
  name text not null,
  country text,
  cost numeric(10, 2) not null default 0,
  created_at timestamptz not null default now()
);

alter table public.accounts
add column if not exists country text;

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

create table if not exists public.app_members (
  email text primary key,
  created_at timestamptz not null default now()
);

insert into public.app_members (email)
values
  ('alexiszeldiaz@gmail.com'),
  ('ppxnillermo@gmail.com')
on conflict (email) do nothing;

alter table public.accounts enable row level security;
alter table public.people enable row level security;
alter table public.app_members enable row level security;

drop policy if exists "Allow app access to accounts" on public.accounts;
drop policy if exists "Allow app access to people" on public.people;
drop policy if exists "Members can read themselves" on public.app_members;
drop policy if exists "Only members can manage accounts" on public.accounts;
drop policy if exists "Only members can manage people" on public.people;

create policy "Members can read themselves"
on public.app_members
for select
to authenticated
using (lower(email) = lower(auth.jwt() ->> 'email'));

create policy "Only members can manage accounts"
on public.accounts
for all
to authenticated
using (
  exists (
    select 1
    from public.app_members
    where lower(app_members.email) = lower(auth.jwt() ->> 'email')
  )
)
with check (
  exists (
    select 1
    from public.app_members
    where lower(app_members.email) = lower(auth.jwt() ->> 'email')
  )
);

create policy "Only members can manage people"
on public.people
for all
to authenticated
using (
  exists (
    select 1
    from public.app_members
    where lower(app_members.email) = lower(auth.jwt() ->> 'email')
  )
)
with check (
  exists (
    select 1
    from public.app_members
    where lower(app_members.email) = lower(auth.jwt() ->> 'email')
  )
);
