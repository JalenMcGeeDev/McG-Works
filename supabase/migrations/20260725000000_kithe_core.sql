-- Kithe v1 core schema: profiles, goals, checkins, moments
-- AI insights + push notifications are out of scope for this migration (added later).

create extension if not exists "pgcrypto";

create table if not exists public.kithe_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  timezone text not null default 'America/New_York',
  reminder_time time,
  created_at timestamptz not null default now()
);

create table if not exists public.kithe_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.kithe_profiles(id) on delete cascade,
  title text not null,
  why text,
  color text not null default '#6366f1',
  icon text not null default 'sparkles',
  cadence text not null check (cadence in ('daily','weekly','custom')),
  custom_days int[] default null,
  is_archived boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.kithe_checkins (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.kithe_goals(id) on delete cascade,
  user_id uuid not null references public.kithe_profiles(id) on delete cascade,
  checkin_date date not null,
  rating smallint check (rating between 1 and 10),
  reflection text,
  prompt_used text,
  created_at timestamptz not null default now(),
  unique (goal_id, checkin_date)
);

create table if not exists public.kithe_moments (
  id uuid primary key default gen_random_uuid(),
  checkin_id uuid not null references public.kithe_checkins(id) on delete cascade,
  user_id uuid not null references public.kithe_profiles(id) on delete cascade,
  kind text not null check (kind in ('win','struggle')),
  description text not null,
  created_at timestamptz not null default now()
);

-- Row Level Security: every row is only visible/editable by its owner
alter table public.kithe_profiles enable row level security;
alter table public.kithe_goals enable row level security;
alter table public.kithe_checkins enable row level security;
alter table public.kithe_moments enable row level security;

create policy "kithe_profiles_own" on public.kithe_profiles
  for all to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "kithe_goals_own" on public.kithe_goals
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "kithe_checkins_own" on public.kithe_checkins
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "kithe_moments_own" on public.kithe_moments
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
