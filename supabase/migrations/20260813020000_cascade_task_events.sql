-- Deleting a task should also remove its activity log entries
alter table project_task_events drop constraint project_task_events_task_id_fkey;
alter table project_task_events
  add constraint project_task_events_task_id_fkey
  foreign key (task_id) references project_tasks(id) on delete cascade;
