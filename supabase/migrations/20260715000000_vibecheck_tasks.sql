-- Migration: create vibecheck_tasks table
-- Run this in the Supabase SQL editor for project awccquoyscijmtqtibgr

create table if not exists vibecheck_tasks (
  id       uuid     primary key default gen_random_uuid(),
  title    text     not null,
  level    smallint not null default 2 check (level in (1, 2, 3)),
  size     text     not null default 'M' check (size in ('S', 'M', 'L')),
  cat      text     not null default 'personal' check (cat in ('work', 'personal')),
  priority boolean  not null default false,
  due      date,
  done     boolean  not null default false,
  created  bigint   not null
);

-- RLS: allow anonymous full access (single-user personal tool, no auth required)
alter table vibecheck_tasks enable row level security;

create policy "vibecheck_anon_all"
  on vibecheck_tasks
  for all
  to anon
  using (true)
  with check (true);
