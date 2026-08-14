-- Client-configurable email notification preferences for the project kanban board
create table if not exists project_notification_subscriptions (
  id uuid primary key default gen_random_uuid(),
  proposal_id text not null unique,
  email text not null,
  notify_new_task boolean not null default false,
  notify_task_moved boolean not null default false,
  notify_comment boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Locked down: no anon/authenticated policies, service_role only via Edge Function
alter table project_notification_subscriptions enable row level security;
