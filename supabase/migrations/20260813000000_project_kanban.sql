-- Migration: client-facing project kanban board (project_tasks + project_task_comments)
-- Run this in the Supabase SQL editor for project awccquoyscijmtqtibgr
-- Access model mirrors proposal_codes/proposal_comments: RLS enabled, zero
-- anon/authenticated policies — all reads/writes go through the
-- `project-tasks` Edge Function using the service_role key.

create table if not exists project_tasks (
  id           uuid        primary key default gen_random_uuid(),
  proposal_id  text        not null,                 -- matches proposal_codes.proposal_path
  title        text        not null,
  description  text,
  status       text        not null default 'todo'   check (status in ('todo', 'doing', 'done')),
  assignee     text        not null default 'mcg'     check (assignee in ('mcg', 'client')),
  sort_order   int         not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_project_tasks_proposal on project_tasks (proposal_id, status, sort_order);

alter table project_tasks enable row level security;

create table if not exists project_task_comments (
  id          uuid        primary key default gen_random_uuid(),
  task_id     uuid        not null references project_tasks(id) on delete cascade,
  proposal_id text        not null,                  -- denormalized for quick access checks
  author_name text        not null,
  is_mcg      boolean     not null default false,
  content     text        not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_project_task_comments_task on project_task_comments (task_id, created_at);

alter table project_task_comments enable row level security;
