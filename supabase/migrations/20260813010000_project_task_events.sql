-- Activity log for the project kanban board: card creation + stage moves
create table if not exists project_task_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references project_tasks(id) on delete set null,
  proposal_id text not null,
  task_title text not null,
  event_type text not null check (event_type in ('created', 'moved')),
  from_status text,
  to_status text,
  actor text not null,
  created_at timestamptz not null default now()
);

create index if not exists project_task_events_proposal_idx
  on project_task_events (proposal_id, created_at desc);

-- Locked down: no anon/authenticated policies, service_role only via Edge Function
alter table project_task_events enable row level security;
